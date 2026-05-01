import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { and, asc, desc, eq } from 'drizzle-orm';
import { getUserParam, withCurrentQueryParams } from '$lib/query-params';
import {
	createOpenRouterChatCompletion,
	type OpenRouterMessage,
	type OpenRouterTool
} from '$lib/server/ai/openrouter';
import {
	createAiRoutine,
	createListTasksTool,
	createRoutineTool,
	createUpdateTaskCodeTool,
	executeAiTask,
	isCreateRoutineToolCall,
	isListTasksToolCall,
	isUpdateTaskCodeToolCall,
	listAiTasksForUser,
	parseCreateRoutineArgs,
	parseUpdateTaskCodeArgs,
	updateAiTaskCodeForUser
} from '$lib/server/ai/routines';
import {
	createAiPage,
	createListPagesTool,
	createPageTool,
	createUpdatePageCodeTool,
	isCreatePageToolCall,
	isListPagesToolCall,
	isUpdatePageCodeToolCall,
	listAiPagesForUser,
	parseCreatePageArgs,
	parseUpdatePageCodeArgs,
	renderAiPage,
	updateAiPageCodeForUser
} from '$lib/server/ai/pages';
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
	parseTableCategories,
	parseTableIdsJson,
	parseTableRestrictionsJson,
	tableLabel
} from '$lib/server/table-groups';
import type { Actions, PageServerLoad } from './$types';

const now = () => new Date().toISOString();
const QUERY_DATABASE_TOOL_NAME = 'query_database';
const GET_TABLE_METADATA_TOOL_NAME = 'get_table_metadata';
const MAX_TOOL_ROWS = 100;
const MAX_TOOL_CALL_ROUNDS = 20;

type MetadataJson = {
	tableName: string;
	generalDescription: string;
	fields?: Array<{ name: string; description: string }>;
	[key: string]: unknown;
};

type MetadataTable = typeof metadataTables.$inferSelect;

type AnswerPageArtifact = {
	type: 'html';
	pageId: number;
	title: string;
	description: string;
	html: string;
	executedSql: string[];
	pageCode: string;
	createdAt: string;
};

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

function createTableMetadataTool(): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: GET_TABLE_METADATA_TOOL_NAME,
			description:
				'Return the full JSON metadata for selected table names in the current chat scope, including fields and any stored examples. Use this before writing SQL or generated page code when column names or detailed table structure are needed.',
			parameters: {
				type: 'object',
				properties: {
					tableNames: {
						type: 'array',
						description:
							'Physical table names or friendly table/group labels from the initial metadata list.',
						items: { type: 'string' }
					}
				},
				required: ['tableNames'],
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

function parseTableMetadataArgs(value: string) {
	const parsed = JSON.parse(value) as { tableNames?: unknown };
	if (!Array.isArray(parsed.tableNames)) {
		throw new Error('The metadata tool call did not include tableNames.');
	}

	const tableNames = parsed.tableNames
		.filter((tableName): tableName is string => typeof tableName === 'string')
		.map((tableName) => tableName.trim())
		.filter((tableName, index, tableNames) => tableName && tableNames.indexOf(tableName) === index);
	if (tableNames.length === 0) {
		throw new Error('The metadata tool call did not include any valid table names.');
	}

	return { tableNames };
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

function normalizeTableLookupName(value: string) {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseMetadataJson(row: typeof tableMetadata.$inferSelect) {
	return JSON.parse(row.json) as MetadataJson;
}

function createMetadataEntry(
	row: typeof tableMetadata.$inferSelect,
	tablesById: Map<number, MetadataTable>,
	tableRestrictions: Map<number, string>
) {
	const metadata = parseMetadataJson(row);
	const table = tablesById.get(row.tableId);
	const tableName = table?.name ?? metadata.tableName;
	const umbrellaName = table ? tableLabel(table) : metadata.tableName;
	const restriction = tableRestrictions.get(row.tableId);

	return { metadata, table, tableName, umbrellaName, restriction };
}

function createSlimMetadataContext(
	rows: Array<typeof tableMetadata.$inferSelect>,
	tablesById: Map<number, MetadataTable>,
	tableRestrictions: Map<number, string>
) {
	return JSON.stringify(
		{
			createdAt: now(),
			tables: rows.map((row) => {
				const { metadata, tableName, umbrellaName, restriction } = createMetadataEntry(
					row,
					tablesById,
					tableRestrictions
				);

				return {
					tableName,
					description: metadata.generalDescription,
					...(umbrellaName !== tableName ? { umbrellaName } : {}),
					...(restriction ? { restriction } : {})
				};
			})
		},
		null,
		2
	);
}

function createFullMetadataEntry(
	row: typeof tableMetadata.$inferSelect,
	tablesById: Map<number, MetadataTable>,
	tableRestrictions: Map<number, string>
) {
	const { metadata, tableName, umbrellaName, restriction } = createMetadataEntry(
		row,
		tablesById,
		tableRestrictions
	);

	return {
		...metadata,
		tableName,
		umbrellaName,
		...(restriction ? { restriction } : {})
	};
}

function metadataLookupNames(
	row: typeof tableMetadata.$inferSelect,
	tablesById: Map<number, MetadataTable>
) {
	const metadata = parseMetadataJson(row);
	const table = tablesById.get(row.tableId);
	const values = [metadata.tableName, table?.name, table ? tableLabel(table) : null];
	if (table) values.push(...parseTableCategories(table));

	return values
		.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
		.map(normalizeTableLookupName);
}

function createFullMetadataResult(
	tableNames: string[],
	rows: Array<typeof tableMetadata.$inferSelect>,
	tablesById: Map<number, MetadataTable>,
	tableRestrictions: Map<number, string>
) {
	const requestedNames = new Set(tableNames.map(normalizeTableLookupName));
	const matchedTableIds = new Set<number>();
	const matchedRequestNames = new Set<string>();

	for (const row of rows) {
		const lookupNames = metadataLookupNames(row, tablesById);
		for (const requestedName of requestedNames) {
			if (!lookupNames.includes(requestedName)) continue;

			matchedTableIds.add(row.tableId);
			matchedRequestNames.add(requestedName);
		}
	}

	return {
		tables: rows
			.filter((row) => matchedTableIds.has(row.tableId))
			.map((row) => createFullMetadataEntry(row, tablesById, tableRestrictions)),
		unavailableTableNames: tableNames.filter(
			(tableName) => !matchedRequestNames.has(normalizeTableLookupName(tableName))
		)
	};
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

			const tableRestrictions = parseTableRestrictionsJson(registeredUser.tableRestrictionsJson);
			const metadataContext = createSlimMetadataContext(
				rowsForContext,
				tablesById,
				tableRestrictions
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
					content: `You are a read-only database assistant for ${dialect}. Answer in Spanish from database metadata and prior chat when that is enough. The initial Database metadata intentionally contains only table names, descriptions, friendly labels, and restrictions; it omits fields and examples to save tokens. Before writing SQL or generated page code that depends on column names, call ${GET_TABLE_METADATA_TOOL_NAME} with the needed table names. You may call ${QUERY_DATABASE_TOOL_NAME} when live database values are needed, but the tool is optional. If the user asks for a table, graph, chart, dashboard, visual app, page, or large result, call create_page. That single page tool stores AI-written JavaScript page code in Páginas, runs every time the page is opened, may call await query(sql), and its first render is shown directly in this chat as the final answer. If the user asks for a recurring task, periodic check, alert, notification, dashboard, or scheduled report, call create_routine. That tool stores AI-written JavaScript routine code that may call await query(sql), then returns a fixed static HTML report per run. If the user asks to change, iterate, recolor, redesign, or fix an existing task/page by name, first call list_tasks or list_pages to find its id and current code, then call update_task_code or update_page_code with the full replacement code. Every SQL inside query() must be one SELECT or WITH statement only; limit broad result sets to ${MAX_TOOL_ROWS} rows unless a rendering tool applies its own limit. After any non-final tool result, give a concise human answer and do not invent facts outside the result.`
				},
				{
					role: 'user',
					content: `Database metadata:\n${metadataContext}\n\nPrior chat:\n${chatContext || 'No prior messages.'}\n\nQuestion: ${question}`
				}
			];
			let answer = '';
			let sql: string | null = null;
			let rows: Array<Record<string, unknown>> | null = null;
			let createdRoutineId: number | null = null;
			let createdPageId: number | null = null;
			let updatedRoutineId: number | null = null;
			let updatedPageId: number | null = null;
			let answerPage: AnswerPageArtifact | null = null;

			toolLoop: for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
				const assistantMessage = await createOpenRouterChatCompletion(modelMessages, {
					tools: [
						createTableMetadataTool(),
						createQueryDatabaseTool(dialect),
						createRoutineTool(dialect),
						createPageTool(dialect),
						createListTasksTool(),
						createListPagesTool(),
						createUpdateTaskCodeTool(),
						createUpdatePageCodeTool()
					]
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
					if (toolCall.function.name === GET_TABLE_METADATA_TOOL_NAME) {
						try {
							const args = parseTableMetadataArgs(toolCall.function.arguments);
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify(
									createFullMetadataResult(
										args.tableNames,
										rowsForContext,
										tablesById,
										tableRestrictions
									)
								)
							});
						} catch (error) {
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									error:
										error instanceof Error ? error.message : 'Could not retrieve table metadata.'
								})
							});
						}
						continue;
					}

					if (isListTasksToolCall(toolCall.function.name)) {
						const tasks = await listAiTasksForUser(currentUser);
						modelMessages.push({
							role: 'tool',
							tool_call_id: toolCall.id,
							content: JSON.stringify({ tasks })
						});
						continue;
					}

					if (isListPagesToolCall(toolCall.function.name)) {
						const pages = await listAiPagesForUser(currentUser);
						modelMessages.push({
							role: 'tool',
							tool_call_id: toolCall.id,
							content: JSON.stringify({ pages })
						});
						continue;
					}

					if (isUpdateTaskCodeToolCall(toolCall.function.name)) {
						try {
							const args = parseUpdateTaskCodeArgs(toolCall.function.arguments);
							const result = await updateAiTaskCodeForUser(
								currentUser,
								args.taskId,
								args.routineCode
							);
							updatedRoutineId = result.id;
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									taskId: result.id,
									title: result.title,
									updated: true
								})
							});
						} catch (error) {
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									error: error instanceof Error ? error.message : 'Could not update the task code.'
								})
							});
						}
						continue;
					}

					if (isUpdatePageCodeToolCall(toolCall.function.name)) {
						try {
							const args = parseUpdatePageCodeArgs(toolCall.function.arguments);
							const result = await updateAiPageCodeForUser(currentUser, args.pageId, args.pageCode);
							updatedPageId = result.id;
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									pageId: result.id,
									title: result.title,
									updated: true
								})
							});
						} catch (error) {
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									error: error instanceof Error ? error.message : 'Could not update the page code.'
								})
							});
						}
						continue;
					}

					if (isCreatePageToolCall(toolCall.function.name)) {
						try {
							const args = parseCreatePageArgs(toolCall.function.arguments);
							const page = await createAiPage({
								userKey: currentUser,
								title: args.title,
								description: args.description,
								pageCode: args.pageCode,
								visualPrompt: args.visualPrompt,
								selectedTableIds
							});
							const rendered = await renderAiPage(page);
							createdPageId = page.id;
							answerPage = {
								type: 'html',
								pageId: page.id,
								title: rendered.title,
								description: page.description,
								html: rendered.html,
								executedSql: rendered.executedSql,
								pageCode: page.pageCode,
								createdAt: now()
							};
							answer = `${page.description}\n\nPágina creada: también queda guardada en Páginas.`;
							const renderedSql = rendered.executedSql.join('\n--- ---\n');
							if (renderedSql) {
								sql = sql ? `${sql}\n--- ---\n${renderedSql}` : renderedSql;
							}
							break toolLoop;
						} catch (error) {
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									error:
										error instanceof Error ? error.message : 'Could not create the dynamic page.'
								})
							});
						}
						continue;
					}

					if (isCreateRoutineToolCall(toolCall.function.name)) {
						try {
							const args = parseCreateRoutineArgs(toolCall.function.arguments);
							const task = await createAiRoutine({
								userKey: currentUser,
								title: args.title,
								description: args.description,
								intervalMinutes: args.intervalMinutes,
								routineCode: args.routineCode,
								visualPrompt: args.visualPrompt,
								selectedTableIds
							});
							const firstRun = await executeAiTask(task);
							createdRoutineId = task.id;
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									taskId: task.id,
									title: task.title,
									intervalMinutes: task.intervalMinutes,
									firstRunOk: firstRun.ok,
									message:
										'Routine created. The first execution has been attempted and a notification was created.'
								})
							});
						} catch (error) {
							modelMessages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									error:
										error instanceof Error
											? error.message
											: 'Could not create the scheduled routine.'
								})
							});
						}
						continue;
					}

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
				content:
					!answerPage && (createdRoutineId || createdPageId || updatedRoutineId || updatedPageId)
						? `${answer}\n\n${[
								createdRoutineId
									? 'Rutina creada: ve a Tareas para verla y a Notificaciones para abrir el reporte generado.'
									: '',
								createdPageId ? 'Página creada: ve a Páginas para abrirla.' : '',
								updatedRoutineId ? `Rutina actualizada: id ${updatedRoutineId}.` : '',
								updatedPageId ? `Página actualizada: id ${updatedPageId}.` : ''
							]
								.filter(Boolean)
								.join('\n')}`
						: answer,
				sql,
				rowsJson: rows ? JSON.stringify(rows.slice(0, MAX_TOOL_ROWS)) : null,
				answerPageJson: answerPage ? JSON.stringify(answerPage) : null,
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
