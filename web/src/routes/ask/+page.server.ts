import { fail } from '@sveltejs/kit';
import { asc, desc } from 'drizzle-orm';
import { askOpenRouter } from '$lib/server/ai/openrouter';
import { db } from '$lib/server/db';
import { getDialectName, isDatabaseType, runReadOnlyQuery } from '$lib/server/db/query-runner';
import { databaseConnections, tableMetadata } from '$lib/server/db/schema';
import type { Actions } from './$types';

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

export const actions: Actions = {
	ask: async ({ request }) => {
		const form = await request.formData();
		const question = String(form.get('question') ?? '').trim();
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
			const metadataContext = metadataRows.map((row) => row.json).join('\n\n');
			const dialect = getDialectName(connection.type);
			const sqlResponse = await askOpenRouter([
				{
					role: 'system',
					content: `You write ${dialect} SQL for read-only analysis. Return only one SELECT statement or one WITH statement. Do not include markdown, comments, explanations, mutations, PRAGMAs, or multiple statements. Limit large result sets to 100 rows.`
				},
				{
					role: 'user',
					content: `Database metadata:\n${metadataContext}\n\nQuestion: ${question}`
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
					content: `Question: ${question}\nSQL: ${sql}\nRows: ${JSON.stringify(rows.slice(0, 100), null, 2)}`
				}
			]);

			return { question, sql, rows, answer };
		} catch (error) {
			return fail(500, {
				error: error instanceof Error ? error.message : 'Could not answer the question.'
			});
		}
	}
};
