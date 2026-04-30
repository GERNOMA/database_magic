import { and, asc, desc, eq, lte } from 'drizzle-orm';
import {
	askOpenRouter,
	type OpenRouterMessage,
	type OpenRouterTool
} from '$lib/server/ai/openrouter';
import { db } from '$lib/server/db';
import {
	extractReadOnlySql,
	isDatabaseType,
	runReadOnlyQuery,
	type DatabaseType
} from '$lib/server/db/query-runner';
import { aiTaskRuns, aiTasks, databaseConnections, notifications } from '$lib/server/db/schema';

const CREATE_ROUTINE_TOOL_NAME = 'create_routine';
const MAX_ROWS_FOR_REPORT = 200;
const MIN_INTERVAL_MINUTES = 1;
const SCHEDULER_TICK_MS = 30_000;

type RoutineToolArgs = {
	title?: unknown;
	description?: unknown;
	intervalMinutes?: unknown;
	sql?: unknown;
	visualPrompt?: unknown;
};

type CreateRoutineInput = {
	userKey: string;
	title: string;
	description: string;
	intervalMinutes: number;
	sql: string;
	visualPrompt: string;
	selectedTableIds: number[];
};

export type AiReportSection =
	| {
			type: 'metric';
			title: string;
			value: string;
			note?: string;
	  }
	| {
			type: 'table';
			title: string;
			columns: string[];
			rows: Array<Record<string, unknown>>;
	  }
	| {
			type: 'bars';
			title: string;
			labelKey: string;
			valueKey: string;
			rows: Array<Record<string, unknown>>;
	  }
	| {
			type: 'text';
			title: string;
			body: string;
	  };

export type AiReportSpec = {
	title: string;
	subtitle: string;
	summary: string;
	accent: string;
	sections: AiReportSection[];
};

declare global {
	var __databaseMagicAiTaskSchedulerStarted: boolean | undefined;
	var __databaseMagicAiTaskSchedulerRunning: boolean | undefined;
}

const now = () => new Date().toISOString();

function addMinutes(minutes: number, from = new Date()) {
	return new Date(from.getTime() + minutes * 60_000).toISOString();
}

function cleanString(value: unknown, fallback = '') {
	return typeof value === 'string' ? value.trim() : fallback;
}

function parseInterval(value: unknown) {
	const interval = Number(value);
	if (!Number.isFinite(interval)) return MIN_INTERVAL_MINUTES;
	return Math.max(MIN_INTERVAL_MINUTES, Math.round(interval));
}

function extractJsonObject(value: string) {
	const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
	return JSON.parse(fenced) as Partial<AiReportSpec>;
}

function normalizeReportSpec(
	value: Partial<AiReportSpec>,
	task: typeof aiTasks.$inferSelect,
	rows: Array<Record<string, unknown>>
): AiReportSpec {
	const columns = Object.keys(rows[0] ?? {});
	const fallbackSection: AiReportSection =
		rows.length > 0
			? {
					type: 'table',
					title: 'Datos obtenidos',
					columns,
					rows: rows.slice(0, 25)
				}
			: {
					type: 'text',
					title: 'Sin resultados',
					body: 'La consulta se ejecutó correctamente, pero no devolvió filas.'
				};

	return {
		title: cleanString(value.title, task.title) || task.title,
		subtitle: cleanString(value.subtitle, task.description) || task.description,
		summary:
			cleanString(value.summary) ||
			`La rutina ejecutó la consulta configurada y obtuvo ${rows.length} fila${
				rows.length === 1 ? '' : 's'
			}.`,
		accent: cleanString(value.accent, 'stone') || 'stone',
		sections:
			Array.isArray(value.sections) && value.sections.length > 0
				? value.sections
				: [fallbackSection]
	};
}

async function latestConnection() {
	const [connection] = await db
		.select()
		.from(databaseConnections)
		.orderBy(desc(databaseConnections.updatedAt))
		.limit(1);

	if (!connection) throw new Error('No hay una conexión de base de datos configurada.');
	if (!isDatabaseType(connection.type))
		throw new Error('La conexión configurada no es compatible.');

	return connection as typeof connection & { type: DatabaseType };
}

export function createRoutineTool(dialect: string): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: CREATE_ROUTINE_TOOL_NAME,
			description: `Create a recurring read-only ${dialect} SQL routine for the current user. Use it when the user asks to periodically run a query, monitor data, or notify them every N minutes/hours/days. The routine stores the SQL, executes it on schedule, creates a notification, and builds a visual report from the user's requested style.`,
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: 'Short Spanish name for the scheduled routine.'
					},
					description: {
						type: 'string',
						description: 'How the user described what should be checked or answered.'
					},
					intervalMinutes: {
						type: 'number',
						description:
							'How often the routine repeats, in minutes. Convert hours/days to minutes. Minimum is 1.'
					},
					sql: {
						type: 'string',
						description:
							'One read-only SELECT or WITH statement. Do not include comments, mutations, PRAGMAs, or multiple statements. Add a LIMIT for broad result sets.'
					},
					visualPrompt: {
						type: 'string',
						description:
							'The visual report the user asked for, in Spanish. Include chart/table/card preferences and important context for the page builder.'
					}
				},
				required: ['title', 'description', 'intervalMinutes', 'sql', 'visualPrompt'],
				additionalProperties: false
			}
		}
	};
}

export function isCreateRoutineToolCall(name: string) {
	return name === CREATE_ROUTINE_TOOL_NAME;
}

export function parseCreateRoutineArgs(value: string) {
	const parsed = JSON.parse(value) as RoutineToolArgs;
	const title = cleanString(parsed.title, 'Rutina programada');
	const description = cleanString(parsed.description);
	const visualPrompt = cleanString(parsed.visualPrompt, description || title);
	const sql = extractReadOnlySql(cleanString(parsed.sql));
	const intervalMinutes = parseInterval(parsed.intervalMinutes);

	if (!description) throw new Error('La rutina necesita una descripción.');
	if (!visualPrompt) throw new Error('La rutina necesita una descripción visual.');

	return { title, description, visualPrompt, sql, intervalMinutes };
}

export async function createAiRoutine(input: CreateRoutineInput) {
	const timestamp = now();
	const [task] = await db
		.insert(aiTasks)
		.values({
			userKey: input.userKey,
			title: input.title,
			description: input.description,
			intervalMinutes: input.intervalMinutes,
			sql: input.sql,
			visualPrompt: input.visualPrompt,
			selectedTableIdsJson: JSON.stringify(input.selectedTableIds),
			isActive: 1,
			nextRunAt: timestamp,
			createdAt: timestamp,
			updatedAt: timestamp
		})
		.returning();

	return task;
}

async function buildReportSpec(
	task: typeof aiTasks.$inferSelect,
	rows: Array<Record<string, unknown>>
) {
	const messages: OpenRouterMessage[] = [
		{
			role: 'system',
			content:
				'You design a beautiful SvelteKit report page as JSON only. Return a JSON object with title, subtitle, summary, accent, and sections. Sections can be metric, table, bars, or text. Use Spanish. Keep tables and bars compact, use values that exist in the rows, and make the visual structure match the user request.'
		},
		{
			role: 'user',
			content: JSON.stringify(
				{
					task: {
						title: task.title,
						description: task.description,
						visualPrompt: task.visualPrompt,
						sql: task.sql
					},
					rows: rows.slice(0, MAX_ROWS_FOR_REPORT)
				},
				null,
				2
			)
		}
	];

	const content = await askOpenRouter(messages, { json: true });
	return normalizeReportSpec(extractJsonObject(content), task, rows);
}

export async function executeAiTask(task: typeof aiTasks.$inferSelect) {
	const timestamp = now();
	const connection = await latestConnection();

	try {
		const rows = await runReadOnlyQuery(connection.type, connection.connectionString, task.sql);
		const pageSpec = await buildReportSpec(task, rows);
		const [run] = await db
			.insert(aiTaskRuns)
			.values({
				taskId: task.id,
				status: 'success',
				sql: task.sql,
				rowsJson: JSON.stringify(rows.slice(0, MAX_ROWS_FOR_REPORT)),
				pageSpecJson: JSON.stringify(pageSpec),
				error: null,
				createdAt: timestamp
			})
			.returning();

		await db.insert(notifications).values({
			userKey: task.userKey,
			taskId: task.id,
			runId: run.id,
			title: pageSpec.title,
			message: pageSpec.summary,
			readAt: null,
			createdAt: timestamp
		});

		await db
			.update(aiTasks)
			.set({
				lastRunAt: timestamp,
				nextRunAt: addMinutes(task.intervalMinutes),
				updatedAt: now()
			})
			.where(eq(aiTasks.id, task.id));

		return { ok: true, run };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'No se pudo ejecutar la rutina.';
		const [run] = await db
			.insert(aiTaskRuns)
			.values({
				taskId: task.id,
				status: 'error',
				sql: task.sql,
				rowsJson: null,
				pageSpecJson: null,
				error: message,
				createdAt: timestamp
			})
			.returning();

		await db.insert(notifications).values({
			userKey: task.userKey,
			taskId: task.id,
			runId: run.id,
			title: `Error en ${task.title}`,
			message,
			readAt: null,
			createdAt: timestamp
		});

		await db
			.update(aiTasks)
			.set({
				lastRunAt: timestamp,
				nextRunAt: addMinutes(task.intervalMinutes),
				updatedAt: now()
			})
			.where(eq(aiTasks.id, task.id));

		return { ok: false, run, error: message };
	}
}

export async function runDueAiTasks() {
	if (globalThis.__databaseMagicAiTaskSchedulerRunning) return;
	globalThis.__databaseMagicAiTaskSchedulerRunning = true;

	try {
		const dueTasks = await db
			.select()
			.from(aiTasks)
			.where(and(eq(aiTasks.isActive, 1), lte(aiTasks.nextRunAt, now())))
			.orderBy(asc(aiTasks.nextRunAt), asc(aiTasks.id));

		for (const task of dueTasks) {
			await executeAiTask(task);
		}
	} finally {
		globalThis.__databaseMagicAiTaskSchedulerRunning = false;
	}
}

export function startAiTaskScheduler() {
	if (globalThis.__databaseMagicAiTaskSchedulerStarted) return;
	globalThis.__databaseMagicAiTaskSchedulerStarted = true;

	void runDueAiTasks();
	const timer = setInterval(() => {
		void runDueAiTasks();
	}, SCHEDULER_TICK_MS);
	timer.unref?.();
}
