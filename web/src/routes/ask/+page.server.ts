import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
import { askOpenRouter } from '$lib/server/ai/openrouter';
import { db } from '$lib/server/db';
import { getDialectName, isDatabaseType, runReadOnlyQuery } from '$lib/server/db/query-runner';
import { askChats, askMessages, databaseConnections, tableMetadata } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const now = () => new Date().toISOString();

function extractSql(value: string) {
	const fenced = value.match(/```(?:sql)?\s*([\s\S]*?)```/i)?.[1] ?? value;
	const sql = fenced.trim().replace(/;+\s*$/, '');
	if (!/^(select|with)\b/i.test(sql)) {
		throw new Error('The AI did not return a read-only SELECT query.');
	}
	if (sql.includes(';')) {
		throw new Error('Only one SQL statement can be executed.');
	}
	return sql;
}

function createTitle(question: string) {
	const compact = question.replace(/\s+/g, ' ').trim();
	return compact.length > 52 ? `${compact.slice(0, 49)}...` : compact || 'New chat';
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
			const sqlResponse = await askOpenRouter([
				{
					role: 'system',
					content: `You write ${dialect} SQL for read-only analysis. Return only one SELECT statement or one WITH statement. Do not include markdown, comments, explanations, mutations, PRAGMAs, or multiple statements. Limit large result sets to 100 rows.`
				},
				{
					role: 'user',
					content: `Database metadata:\n${metadataContext}\n\nPrior chat:\n${chatContext || 'No prior messages.'}\n\nQuestion: ${question}`
				}
			]);
			const sql = extractSql(sqlResponse);
			const rows = await runReadOnlyQuery(connection.type, connection.connectionString, sql);

			const answer = await askOpenRouter([
				{
					role: 'system',
					content:
						'Turn SQL query results into a concise human answer. Do not invent facts outside the result.'
				},
				{
					role: 'user',
					content: `Prior chat:\n${chatContext || 'No prior messages.'}\n\nQuestion: ${question}\nSQL: ${sql}\nRows: ${JSON.stringify(rows.slice(0, 100), null, 2)}`
				}
			]);

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
				rowsJson: JSON.stringify(rows.slice(0, 100)),
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
