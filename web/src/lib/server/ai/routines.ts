import { and, asc, desc, eq, lte } from 'drizzle-orm';
import type { OpenRouterTool } from '$lib/server/ai/openrouter';
import { db } from '$lib/server/db';
import {
	extractReadOnlySql,
	isDatabaseType,
	runReadOnlyQuery,
	type DatabaseType
} from '$lib/server/db/query-runner';
import { aiTaskRuns, aiTasks, databaseConnections, notifications } from '$lib/server/db/schema';

const CREATE_ROUTINE_TOOL_NAME = 'create_routine';
const LIST_TASKS_TOOL_NAME = 'list_tasks';
const UPDATE_TASK_CODE_TOOL_NAME = 'update_task_code';
const MIN_INTERVAL_MINUTES = 1;
const SCHEDULER_TICK_MS = 30_000;
const MAX_QUERY_ROWS = 500;
const MAX_EXECUTED_QUERIES = 8;
const MAX_REPORT_HTML_LENGTH = 250_000_000;

type RoutineToolArgs = {
	title?: unknown;
	description?: unknown;
	intervalMinutes?: unknown;
	routineCode?: unknown;
	visualPrompt?: unknown;
};

type UpdateTaskCodeArgs = {
	taskId?: unknown;
	routineCode?: unknown;
};

type CreateRoutineInput = {
	userKey: string;
	title: string;
	description: string;
	intervalMinutes: number;
	routineCode: string;
	visualPrompt: string;
	selectedTableIds: number[];
};

type RoutineResult = {
	title?: unknown;
	summary?: unknown;
	html?: unknown;
};

declare global {
	var __databaseMagicAiTaskSchedulerTimer: NodeJS.Timeout | undefined;
	var __databaseMagicAiTaskSchedulerRunning: boolean | undefined;
	var __databaseMagicAiTaskSchedulerCurrentRunning: boolean | undefined;
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

function stripCodeFence(value: string) {
	const code = value
		.trim()
		.replace(/^```(?:js|javascript|ts|typescript)?\s*/i, '')
		.replace(/```\s*$/i, '')
		.trim();
	const functionBody = code.match(/^(?:async\s+)?function\s+\w*\s*\([^)]*\)\s*\{([\s\S]*)\}$/);
	if (functionBody?.[1]) return functionBody[1].trim();
	return code;
}

function escapeHtml(value: unknown) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function sanitizeReportHtml(value: string) {
	return value
		.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
		.replace(/\son\w+="[^"]*"/gi, '')
		.replace(/\son\w+='[^']*'/gi, '')
		.replace(/javascript:/gi, '');
}

function validateRoutineCode(code: string) {
	const forbidden = [
		/\bimport\b/,
		/\brequire\s*\(/,
		/\bprocess\b/,
		/\bchild_process\b/,
		/\bfs\b/,
		/\bfetch\s*\(/,
		/\beval\s*\(/,
		/\bFunction\b/,
		/\bconstructor\b/,
		/\bglobalThis\b/,
		/\bglobal\b/,
		/\bwindow\b/,
		/\bdocument\b/,
		/<script/i
	];

	if (forbidden.some((pattern) => pattern.test(code))) {
		throw new Error('El código de la rutina usa APIs no permitidas.');
	}
}

export function createRoutineTool(dialect: string): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: CREATE_ROUTINE_TOOL_NAME,
			description: `Create a recurring AI-coded ${dialect} mini website generator for the current user. Use it when the user asks to periodically run queries, monitor data, create dashboards, or notify them every N minutes/hours/days. The stored routine is JavaScript function-body code that may call query(sql) one or more times, then returns a fixed static HTML report for the notification page.`,
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
					routineCode: {
						type: 'string',
						description:
							'JavaScript async function body. Available helpers: await query(sql), escapeHtml(value), formatNumber(value), Date, Math, JSON. It must return { title, summary, html }. The html must be a complete static visual report fragment with inline CSS and no scripts. Every SQL passed to query() must be one read-only SELECT or WITH statement.'
					},
					visualPrompt: {
						type: 'string',
						description:
							'The visual report the user asked for, in Spanish. Include chart/table/card preferences and important context for the page builder.'
					}
				},
				required: ['title', 'description', 'intervalMinutes', 'routineCode', 'visualPrompt'],
				additionalProperties: false
			}
		}
	};
}

export function createListTasksTool(): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: LIST_TASKS_TOOL_NAME,
			description:
				'List every scheduled AI task owned by the current user, including ids, descriptions, intervals, current code, and scheduling values. Use this before changing a task by name or when the user asks what tasks exist.',
			parameters: {
				type: 'object',
				properties: {},
				additionalProperties: false
			}
		}
	};
}

export function createUpdateTaskCodeTool(): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: UPDATE_TASK_CODE_TOOL_NAME,
			description:
				'Update the JavaScript routine code of an existing scheduled task owned by the current user. Use list_tasks first if the user identifies the task by name instead of id.',
			parameters: {
				type: 'object',
				properties: {
					taskId: {
						type: 'number',
						description: 'The id of the task to update.'
					},
					routineCode: {
						type: 'string',
						description:
							'New JavaScript async function body. Available helpers: await query(sql), escapeHtml(value), formatNumber(value), Date, Math, JSON. It must return { title, summary, html }. The html must be static, with inline CSS and no scripts.'
					}
				},
				required: ['taskId', 'routineCode'],
				additionalProperties: false
			}
		}
	};
}

export function isCreateRoutineToolCall(name: string) {
	return name === CREATE_ROUTINE_TOOL_NAME;
}

export function isListTasksToolCall(name: string) {
	return name === LIST_TASKS_TOOL_NAME;
}

export function isUpdateTaskCodeToolCall(name: string) {
	return name === UPDATE_TASK_CODE_TOOL_NAME;
}

export function parseCreateRoutineArgs(value: string) {
	const parsed = JSON.parse(value) as RoutineToolArgs;
	const title = cleanString(parsed.title, 'Rutina programada');
	const description = cleanString(parsed.description);
	const visualPrompt = cleanString(parsed.visualPrompt, description || title);
	const routineCode = stripCodeFence(cleanString(parsed.routineCode));
	const intervalMinutes = parseInterval(parsed.intervalMinutes);

	if (!description) throw new Error('La rutina necesita una descripción.');
	if (!visualPrompt) throw new Error('La rutina necesita una descripción visual.');
	if (!routineCode) throw new Error('La rutina necesita código ejecutable.');
	validateRoutineCode(routineCode);

	return { title, description, visualPrompt, routineCode, intervalMinutes };
}

export function parseUpdateTaskCodeArgs(value: string) {
	const parsed = JSON.parse(value) as UpdateTaskCodeArgs;
	const taskId = Number(parsed.taskId);
	const routineCode = stripCodeFence(cleanString(parsed.routineCode));

	if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('La tarea necesita un id válido.');
	if (!routineCode) throw new Error('La tarea necesita nuevo código ejecutable.');
	validateRoutineCode(routineCode);

	return { taskId, routineCode };
}

export async function listAiTasksForUser(userKey: string) {
	const tasks = await db
		.select()
		.from(aiTasks)
		.where(eq(aiTasks.userKey, userKey))
		.orderBy(desc(aiTasks.updatedAt), desc(aiTasks.id));

	return tasks.map((task) => ({
		id: task.id,
		userKey: task.userKey,
		title: task.title,
		description: task.description,
		intervalMinutes: task.intervalMinutes,
		routineCode: task.routineCode,
		visualPrompt: task.visualPrompt,
		selectedTableIdsJson: task.selectedTableIdsJson,
		isActive: task.isActive,
		lastRunAt: task.lastRunAt,
		nextRunAt: task.nextRunAt,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt
	}));
}

export async function updateAiTaskCodeForUser(
	userKey: string,
	taskId: number,
	routineCode: string
) {
	const [task] = await db
		.select()
		.from(aiTasks)
		.where(and(eq(aiTasks.id, taskId), eq(aiTasks.userKey, userKey)))
		.limit(1);
	if (!task) throw new Error('No se encontró esa tarea.');

	await db
		.update(aiTasks)
		.set({
			routineCode,
			sql: '',
			updatedAt: now()
		})
		.where(and(eq(aiTasks.id, taskId), eq(aiTasks.userKey, userKey)));

	return { id: task.id, title: task.title, updated: true };
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
			sql: '',
			routineCode: input.routineCode,
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

async function executeRoutineCode(
	task: typeof aiTasks.$inferSelect,
	connection: Awaited<ReturnType<typeof latestConnection>>
) {
	const executedSql: string[] = [];
	const query = async (sqlValue: unknown) => {
		if (executedSql.length >= MAX_EXECUTED_QUERIES) {
			throw new Error(`La rutina superó el máximo de ${MAX_EXECUTED_QUERIES} consultas.`);
		}

		const sql = extractReadOnlySql(cleanString(sqlValue));
		const rows = await runReadOnlyQuery(connection.type, connection.connectionString, sql);
		executedSql.push(sql);
		return rows.slice(0, MAX_QUERY_ROWS);
	};

	if (!task.routineCode && task.sql) {
		const rows = await query(task.sql);
		const columns = Object.keys(rows[0] ?? {});
		const tableRows = rows
			.slice(0, 50)
			.map(
				(row) =>
					`<tr>${columns
						.map(
							(column) =>
								`<td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row[column])}</td>`
						)
						.join('')}</tr>`
			)
			.join('');

		return {
			title: task.title,
			summary: `La rutina heredada ejecutó 1 consulta y obtuvo ${rows.length} fila${
				rows.length === 1 ? '' : 's'
			}.`,
			html: `<section style="font-family:Inter,system-ui,sans-serif;padding:32px;color:#1c1917"><h1>${escapeHtml(
				task.title
			)}</h1><p>${escapeHtml(task.description)}</p><table style="width:100%;border-collapse:collapse;margin-top:24px"><thead><tr>${columns
				.map(
					(column) =>
						`<th style="text-align:left;border-bottom:1px solid #ddd;padding:8px">${escapeHtml(column)}</th>`
				)
				.join('')}</tr></thead><tbody>${tableRows}</tbody></table></section>`,
			executedSql
		};
	}

	const formatNumber = (value: unknown) =>
		new Intl.NumberFormat('es').format(Number.isFinite(Number(value)) ? Number(value) : 0);
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
		...args: string[]
	) => (...args: unknown[]) => Promise<RoutineResult>;
	const run = new AsyncFunction(
		'query',
		'escapeHtml',
		'formatNumber',
		'Date',
		'Math',
		'JSON',
		'Array',
		'Object',
		'String',
		'Number',
		'Boolean',
		'console',
		'process',
		'require',
		'globalThis',
		'global',
		'fetch',
		'eval',
		'Function',
		task.routineCode
	);

	const result = await run(
		query,
		escapeHtml,
		formatNumber,
		Date,
		Math,
		JSON,
		Array,
		Object,
		String,
		Number,
		Boolean,
		{ log: () => undefined },
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined
	);
	const title = cleanString(result?.title, task.title) || task.title;
	const summary =
		cleanString(result?.summary) ||
		`La rutina ejecutó ${executedSql.length} consulta${executedSql.length === 1 ? '' : 's'}.`;
	const html = sanitizeReportHtml(cleanString(result?.html));

	if (!html) throw new Error('La rutina no devolvió HTML para la página final.');
	if (html.length > MAX_REPORT_HTML_LENGTH)
		throw new Error('La página generada es demasiado grande.');

	return { title, summary, html, executedSql };
}

export async function executeAiTask(task: typeof aiTasks.$inferSelect) {
	const timestamp = now();
	const connection = await latestConnection();

	try {
		const report = await executeRoutineCode(task, connection);
		const [run] = await db
			.insert(aiTaskRuns)
			.values({
				taskId: task.id,
				status: 'success',
				sql: report.executedSql.join('\n--- ---\n'),
				executedSqlJson: JSON.stringify(report.executedSql),
				rowsJson: null,
				pageSpecJson: null,
				reportTitle: report.title,
				reportSummary: report.summary,
				reportHtml: report.html,
				error: null,
				createdAt: timestamp
			})
			.returning();

		await db.insert(notifications).values({
			userKey: task.userKey,
			taskId: task.id,
			runId: run.id,
			title: report.title,
			message: report.summary,
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
				sql: '',
				executedSqlJson: null,
				rowsJson: null,
				pageSpecJson: null,
				reportTitle: null,
				reportSummary: null,
				reportHtml: null,
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
	if (globalThis.__databaseMagicAiTaskSchedulerCurrentRunning) return;
	globalThis.__databaseMagicAiTaskSchedulerCurrentRunning = true;

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
		globalThis.__databaseMagicAiTaskSchedulerCurrentRunning = false;
	}
}

export function startAiTaskScheduler() {
	// Pre-upgrade dev HMR intervals used this legacy flag. Keep it true so stale intervals no-op.
	globalThis.__databaseMagicAiTaskSchedulerRunning = true;

	if (globalThis.__databaseMagicAiTaskSchedulerTimer) {
		clearInterval(globalThis.__databaseMagicAiTaskSchedulerTimer);
	}

	void runDueAiTasks();
	const timer = setInterval(() => {
		void runDueAiTasks();
	}, SCHEDULER_TICK_MS);
	timer.unref?.();
	globalThis.__databaseMagicAiTaskSchedulerTimer = timer;
}
