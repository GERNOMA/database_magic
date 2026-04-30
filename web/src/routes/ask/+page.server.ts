import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { and, asc, desc, eq } from 'drizzle-orm';
import { getUserParam, withCurrentQueryParams } from '$lib/query-params';
import {
	createOpenRouterChatCompletion,
	type OpenRouterMessage,
	type OpenRouterTool
} from '$lib/server/ai/openrouter';
import { db } from '$lib/server/db';
import {
	extractReadOnlySql,
	getDialectName,
	isDatabaseType,
	runReadOnlyQuery
} from '$lib/server/db/query-runner';
import {
	askChats,
	askMessages,
	appUsers,
	databaseConnections,
	metadataTables,
	tableMetadata
} from '$lib/server/db/schema';
import {
	createTableGroups,
	expandSelectedTableIds,
	getSelectedTableIds,
	parseTableIdsJson,
	parseTableRestrictionsJson,
	tableLabel
} from '$lib/server/table-groups';
import type { Actions, PageServerLoad } from './$types';

const now = () => new Date().toISOString();
const QUERY_DATABASE_TOOL_NAME = 'query_database';
const MAX_TOOL_ROWS = 100;
const MAX_TOOL_CALL_ROUNDS = 3;

type MetadataJson = {
	tableName: string;
	generalDescription: string;
	fields: Array<{ name: string; description: string }>;
};

type MetadataTable = typeof metadataTables.$inferSelect;

function createTitle(question: string) {
	const compact = question.replace(/\s+/g, ' ').trim();
	return compact.length > 52 ? `${compact.slice(0, 49)}...` : compact || 'Nuevo chat';
}

function createQueryDatabaseTool(dialect: string): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: QUERY_DATABASE_TOOL_NAME,
			description: `Run one read-only ${dialect} SQL query against the connected database and return rows as JSON. Use this only when live database values are needed to answer the user.`,
			parameters: {
				type: 'object',
				properties: {
					sql: {
						type: 'string',
						description:
							'One read-only SELECT or WITH statement. Do not include comments, mutations, PRAGMAs, or multiple statements. Add a LIMIT for broad result sets.'
					}
				},
				required: ['sql'],
				additionalProperties: false
			}
		}
	};
}

function parseQueryDatabaseArgs(value: string) {
	const parsed = JSON.parse(value) as { sql?: unknown };
	if (typeof parsed.sql !== 'string' || parsed.sql.trim().length === 0) {
		throw new Error('The SQL tool call did not include a query.');
	}
	return { sql: extractReadOnlySql(parsed.sql) };
}

function createToolResult(sql: string, rows: Array<Record<string, unknown>>) {
	const returnedRows = rows.slice(0, MAX_TOOL_ROWS);
	return {
		sql,
		rowCount: rows.length,
		returnedRowCount: returnedRows.length,
		truncated: rows.length > returnedRows.length,
		rows: returnedRows
	};
}

const askRedirect = (url: URL, href: string) => redirect(303, withCurrentQueryParams(url, href));

function createMetadataContext(
	rows: Array<typeof tableMetadata.$inferSelect>,
	tablesById: Map<number, MetadataTable>,
	tableRestrictions: Map<number, string>
) {
	return JSON.stringify(
		{
			createdAt: now(),
			tables: rows.map((row) => {
				const metadata = JSON.parse(row.json) as MetadataJson;
				const table = tablesById.get(row.tableId);
				const restriction = tableRestrictions.get(row.tableId);

				return {
					...metadata,
					tableName: table?.name ?? metadata.tableName,
					umbrellaName: table ? tableLabel(table) : metadata.tableName,
					...(restriction ? { restriction } : {})
				};
			})
		},
		null,
		2
	);
}

export const load: PageServerLoad = async ({ url }) => {
	const currentUser = getUserParam(url);
	if (!currentUser) {
		return {
			currentUser: null,
			chats: [],
			selectedChat: null,
			messages: [],
			tableGroups: [],
			selectedTableIds: []
		};
	}

	const [registeredUser] = await db
		.select()
		.from(appUsers)
		.where(eq(appUsers.userKey, currentUser))
		.limit(1);
	if (!registeredUser) {
		return {
			currentUser: null,
			chats: [],
			selectedChat: null,
			messages: [],
			tableGroups: [],
			selectedTableIds: []
		};
	}

	const chats = await db
		.select()
		.from(askChats)
		.where(eq(askChats.userKey, currentUser))
		.orderBy(desc(askChats.updatedAt));
	const tables = await db.select().from(metadataTables).orderBy(asc(metadataTables.name));
	const metadataRows = await db.select().from(tableMetadata).orderBy(asc(tableMetadata.fileName));
	const tablesWithMetadata = new Set(metadataRows.map((row) => row.tableId));
	const allowedTableIds = new Set(parseTableIdsJson(registeredUser.allowedTableIdsJson));
	const allowedTables = tables.filter((table) => allowedTableIds.has(table.id));
	const tableGroups = createTableGroups(allowedTables, tablesWithMetadata);
	const selectedChatId = Number(url.searchParams.get('chat') ?? 0);
	const selectedChat = chats.find((chat) => chat.id === selectedChatId);
	const selectedTableIds = parseTableIdsJson(selectedChat?.selectedTableIdsJson ?? null).filter(
		(tableId) => allowedTableIds.has(tableId)
	);
	const messages = selectedChat
		? await db
				.select()
				.from(askMessages)
				.where(eq(askMessages.chatId, selectedChat.id))
				.orderBy(asc(askMessages.createdAt), asc(askMessages.id))
		: [];

	return {
		currentUser,
		chats,
		selectedChat,
		messages,
		tableGroups,
		selectedTableIds
	};
};

export const actions: Actions = {
	ask: async ({ request, url }) => {
		const currentUser = getUserParam(url);
		if (!currentUser) return fail(400, { error: 'Usuario no ingresado.' });
		const [registeredUser] = await db
			.select()
			.from(appUsers)
			.where(eq(appUsers.userKey, currentUser))
			.limit(1);
		if (!registeredUser) return fail(400, { error: 'Usuario no ingresado.' });

		const form = await request.formData();
		const question = String(form.get('question') ?? '').trim();
		const chatId = Number(form.get('chatId') ?? 0);
		const submittedTableIds = getSelectedTableIds(form);
		if (!question) return fail(400, { error: 'Primero haz una pregunta.' });

		const [connection] = await db
			.select()
			.from(databaseConnections)
			.orderBy(desc(databaseConnections.updatedAt))
			.limit(1);
		if (!connection)
			return fail(400, { error: 'Conecta una base de datos antes de hacer preguntas.' });
		if (!isDatabaseType(connection.type))
			return fail(400, {
				error: 'Elige un tipo de base de datos compatible antes de hacer preguntas.'
			});

		const [metadataRows, tables] = await Promise.all([
			db.select().from(tableMetadata).orderBy(asc(tableMetadata.fileName)),
			db.select().from(metadataTables).orderBy(asc(metadataTables.name))
		]);
		if (metadataRows.length === 0)
			return fail(400, { error: 'Genera metadatos antes de hacer preguntas.' });

		try {
			const timestamp = now();
			let activeChatId = chatId || undefined;
			let previousMessages: Array<typeof askMessages.$inferSelect> = [];

			if (activeChatId) {
				const [chat] = await db
					.select()
					.from(askChats)
					.where(and(eq(askChats.id, activeChatId), eq(askChats.userKey, currentUser)))
					.limit(1);
				if (!chat) return fail(404, { error: 'No se encontró el chat.' });
				previousMessages = await db
					.select()
					.from(askMessages)
					.where(eq(askMessages.chatId, activeChatId))
					.orderBy(asc(askMessages.createdAt), asc(askMessages.id));
			}

			const tablesById = new Map(tables.map((table) => [table.id, table]));
			const allowedTableIds = new Set(parseTableIdsJson(registeredUser.allowedTableIdsJson));
			const allowedMetadataRows = metadataRows.filter((row) => allowedTableIds.has(row.tableId));
			if (allowedMetadataRows.length === 0)
				return fail(400, { error: 'No tienes tablas habilitadas para consultar.' });
			const tableGroups = createTableGroups(
				tables.filter((table) => allowedTableIds.has(table.id)),
				new Set(allowedMetadataRows.map((row) => row.tableId))
			);
			const selectedTableIds = expandSelectedTableIds(submittedTableIds, tableGroups);
			const selectedTableIdSet = new Set(selectedTableIds);
			const rowsForContext =
				selectedTableIds.length > 0
					? allowedMetadataRows.filter((row) => selectedTableIdSet.has(row.tableId))
					: allowedMetadataRows;
			if (rowsForContext.length === 0)
				return fail(400, { error: 'Selecciona tablas que ya tengan metadatos generados.' });

			const metadataContext = createMetadataContext(
				rowsForContext,
				tablesById,
				parseTableRestrictionsJson(registeredUser.tableRestrictionsJson)
			);
			const dialect = getDialectName(connection.type);
			const chatContext = previousMessages
				.slice(-10)
				.map((message) => {
					if (message.role === 'assistant') {
						return `Assistant: ${message.content}${message.sql ? `\nSQL: ${message.sql}` : ''}`;
					}
					return `User: ${message.content}`;
				})
				.join('\n\n');
			const modelMessages: OpenRouterMessage[] = [
				{
					role: 'system',
					content: `You are a read-only database assistant for ${dialect}. Answer in Spanish from database metadata and prior chat when that is enough. You may call ${QUERY_DATABASE_TOOL_NAME} when live database values are needed, but the tool is optional. If you call it, use one SELECT or WITH statement only and limit broad result sets to ${MAX_TOOL_ROWS} rows. After any tool result, give a concise human answer and do not invent facts outside the result.`
				},
				{
					role: 'user',
					content: `Database metadata:\n${metadataContext}\n\nPrior chat:\n${chatContext || 'No prior messages.'}\n\nQuestion: ${question}`
				}
			];
			let answer = '';
			let sql: string | null = null;
			let rows: Array<Record<string, unknown>> | null = null;

			for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
				const assistantMessage = await createOpenRouterChatCompletion(modelMessages, {
					tools: [createQueryDatabaseTool(dialect)]
				});
				const toolCalls = assistantMessage.tool_calls ?? [];

				if (toolCalls.length === 0) {
					answer = assistantMessage.content?.trim() ?? '';
					break;
				}

				modelMessages.push({
					role: 'assistant',
					content: assistantMessage.content ?? null,
					tool_calls: toolCalls
				});

				for (const toolCall of toolCalls) {
					if (toolCall.function.name !== QUERY_DATABASE_TOOL_NAME) {
						modelMessages.push({
							role: 'tool',
							tool_call_id: toolCall.id,
							content: JSON.stringify({
								error: `Unknown tool: ${toolCall.function.name}`
							})
						});
						continue;
					}

					try {
						const args = parseQueryDatabaseArgs(toolCall.function.arguments);
						const queryRows = await runReadOnlyQuery(
							connection.type,
							connection.connectionString,
							args.sql
						);
						if (sql != null) sql += `\n--- ---\n${args.sql}`;
						else sql = args.sql;
						rows = queryRows;
						modelMessages.push({
							role: 'tool',
							tool_call_id: toolCall.id,
							content: JSON.stringify(createToolResult(args.sql, queryRows))
						});
					} catch (error) {
						modelMessages.push({
							role: 'tool',
							tool_call_id: toolCall.id,
							content: JSON.stringify({
								error: error instanceof Error ? error.message : 'Could not run the SQL query.'
							})
						});
					}
				}
			}

			if (!answer) throw new Error('OpenRouter no devolvió una respuesta.');

			if (!activeChatId) {
				const [created] = await db
					.insert(askChats)
					.values({
						userKey: currentUser,
						title: createTitle(question),
						selectedTableIdsJson: JSON.stringify(selectedTableIds),
						createdAt: timestamp,
						updatedAt: timestamp
					})
					.returning();
				activeChatId = created.id;
			}

			await db.insert(askMessages).values({
				chatId: activeChatId,
				role: 'user',
				content: question,
				createdAt: timestamp
			});
			await db.insert(askMessages).values({
				chatId: activeChatId,
				role: 'assistant',
				content: answer,
				sql,
				rowsJson: rows ? JSON.stringify(rows.slice(0, MAX_TOOL_ROWS)) : null,
				createdAt: now()
			});
			await db
				.update(askChats)
				.set({
					selectedTableIdsJson: JSON.stringify(selectedTableIds),
					updatedAt: now()
				})
				.where(eq(askChats.id, activeChatId));

			throw askRedirect(url, `/ask?chat=${activeChatId}`);
		} catch (error) {
			if (isRedirect(error)) throw error;
			return fail(500, {
				error: error instanceof Error ? error.message : 'No se pudo responder la pregunta.'
			});
		}
	},

	deleteChat: async ({ request, url }) => {
		const currentUser = getUserParam(url);
		if (!currentUser) return fail(400, { error: 'Usuario no ingresado.' });
		const [registeredUser] = await db
			.select()
			.from(appUsers)
			.where(eq(appUsers.userKey, currentUser))
			.limit(1);
		if (!registeredUser) return fail(400, { error: 'Usuario no ingresado.' });

		const form = await request.formData();
		const chatId = Number(form.get('chatId'));
		if (!chatId) return fail(400, { error: 'No se pudo eliminar ese chat.' });

		await db
			.delete(askChats)
			.where(and(eq(askChats.id, chatId), eq(askChats.userKey, currentUser)));

		throw redirect(303, withCurrentQueryParams(url, '/ask', { chat: null }));
	}
};
