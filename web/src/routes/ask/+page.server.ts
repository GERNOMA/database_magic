import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
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
import { askChats, askMessages, databaseConnections, tableMetadata } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const now = () => new Date().toISOString();
const QUERY_DATABASE_TOOL_NAME = 'query_database';
const MAX_TOOL_ROWS = 100;
const MAX_TOOL_CALL_ROUNDS = 3;

function createTitle(question: string) {
	const compact = question.replace(/\s+/g, ' ').trim();
	return compact.length > 52 ? `${compact.slice(0, 49)}...` : compact || 'New chat';
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

export const load: PageServerLoad = async ({ url }) => {
	const chats = await db.select().from(askChats).orderBy(desc(askChats.updatedAt));
	const selectedChatId = Number(url.searchParams.get('chat') ?? 0);
	const selectedChat = chats.find((chat) => chat.id === selectedChatId);
	const messages = selectedChat
		? await db
				.select()
				.from(askMessages)
				.where(eq(askMessages.chatId, selectedChat.id))
				.orderBy(asc(askMessages.createdAt), asc(askMessages.id))
		: [];

	return { chats, selectedChat, messages };
};

export const actions: Actions = {
	ask: async ({ request }) => {
		const form = await request.formData();
		const question = String(form.get('question') ?? '').trim();
		const chatId = Number(form.get('chatId') ?? 0);
		if (!question) return fail(400, { error: 'Ask a question first.' });

		const [connection] = await db
			.select()
			.from(databaseConnections)
			.orderBy(desc(databaseConnections.updatedAt))
			.limit(1);
		if (!connection) return fail(400, { error: 'Connect a database before asking questions.' });
		if (!isDatabaseType(connection.type))
			return fail(400, { error: 'Choose a supported database type before asking questions.' });

		const metadataRows = await db.select().from(tableMetadata).orderBy(asc(tableMetadata.fileName));
		if (metadataRows.length === 0)
			return fail(400, { error: 'Generate metadata before asking questions.' });

		try {
			const timestamp = now();
			let activeChatId = chatId || undefined;
			let previousMessages: Array<typeof askMessages.$inferSelect> = [];

			if (activeChatId) {
				const [chat] = await db
					.select()
					.from(askChats)
					.where(eq(askChats.id, activeChatId))
					.limit(1);
				if (!chat) return fail(404, { error: 'Chat not found.' });
				previousMessages = await db
					.select()
					.from(askMessages)
					.where(eq(askMessages.chatId, activeChatId))
					.orderBy(asc(askMessages.createdAt), asc(askMessages.id));
			}

			const metadataContext = metadataRows.map((row) => row.json).join('\n\n');
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
					content: `You are a read-only database assistant for ${dialect}. Answer from database metadata and prior chat when that is enough. You may call ${QUERY_DATABASE_TOOL_NAME} when live database values are needed, but the tool is optional. If you call it, use one SELECT or WITH statement only and limit broad result sets to ${MAX_TOOL_ROWS} rows. After any tool result, give a concise human answer and do not invent facts outside the result.`
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
							content: JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` })
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
						if(sql != null) sql += `\n--- ---\n${args.sql}`;
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

			if (!answer) throw new Error('OpenRouter did not return an answer.');

			if (!activeChatId) {
				const [created] = await db
					.insert(askChats)
					.values({ title: createTitle(question), createdAt: timestamp, updatedAt: timestamp })
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
			await db.update(askChats).set({ updatedAt: now() }).where(eq(askChats.id, activeChatId));

			throw redirect(303, `/ask?chat=${activeChatId}`);
		} catch (error) {
			if (isRedirect(error)) throw error;
			return fail(500, {
				error: error instanceof Error ? error.message : 'Could not answer the question.'
			});
		}
	},

	deleteChat: async ({ request }) => {
		const form = await request.formData();
		const chatId = Number(form.get('chatId'));
		if (!chatId) return fail(400, { error: 'Could not delete that chat.' });

		await db.delete(askChats).where(eq(askChats.id, chatId));

		throw redirect(303, '/ask');
	}
};
