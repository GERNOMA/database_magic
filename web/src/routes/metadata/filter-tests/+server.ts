import { json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { isDatabaseType, listDatabaseTableRows } from '$lib/server/db/query-runner';
import { db } from '$lib/server/db';
import { databaseConnections, metadataTables } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

const TEST_LIMIT = 100;
const now = () => new Date().toISOString();

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		tableId?: unknown;
		index?: unknown;
		total?: unknown;
	} | null;
	const tableId = Number(body?.tableId);
	const index = Number(body?.index);
	const total = Number(body?.total);

	if (!tableId) {
		return json({ error: 'Selecciona una tabla para filtrar pruebas.' }, { status: 400 });
	}

	const [table] = await db
		.select()
		.from(metadataTables)
		.where(eq(metadataTables.id, tableId))
		.limit(1);
	if (!table) return json({ error: 'No se encontró la tabla.' }, { status: 404 });

	const [connection] = await db
		.select()
		.from(databaseConnections)
		.orderBy(desc(databaseConnections.updatedAt))
		.limit(1);
	if (!connection) {
		return json({ error: 'Conecta una base de datos antes de filtrar pruebas.' }, { status: 400 });
	}
	if (!isDatabaseType(connection.type)) {
		return json(
			{ error: 'Elige un tipo de base de datos compatible antes de filtrar pruebas.' },
			{ status: 400 }
		);
	}

	try {
		const rows = await listDatabaseTableRows(
			connection.type,
			connection.connectionString,
			table.name,
			TEST_LIMIT
		);
		const hasLessThanLimit = rows.length < TEST_LIMIT;

		await db
			.update(metadataTables)
			.set({
				filterTestRowCount: rows.length,
				filterTestLimit: TEST_LIMIT,
				filterTestHasLessThanLimit: hasLessThanLimit ? 1 : 0,
				filterTestCheckedAt: now()
			})
			.where(eq(metadataTables.id, table.id));

		console.info(
			`Filtrar pruebas ${Number.isFinite(index) ? index : '?'} / ${Number.isFinite(total) ? total : '?'} - ${table.name}: ${rows.length}/${TEST_LIMIT}`
		);

		return json({
			tableId: table.id,
			tableName: table.name,
			rowCount: rows.length,
			limit: TEST_LIMIT,
			hasLessThanLimit
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'No se pudo filtrar esa tabla.';
		console.info(
			`Filtrar pruebas ${Number.isFinite(index) ? index : '?'} / ${Number.isFinite(total) ? total : '?'} - ${table.name}: error`
		);

		return json({ tableId: table.id, tableName: table.name, error: message }, { status: 500 });
	}
};
