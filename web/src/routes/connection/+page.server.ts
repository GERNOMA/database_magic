import { fail } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { isDatabaseType, testDatabaseConnection } from '$lib/server/db/query-runner';
import { databaseConnections } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const now = () => new Date().toISOString();

export const load: PageServerLoad = async () => {
	const [connection] = await db
		.select()
		.from(databaseConnections)
		.orderBy(desc(databaseConnections.updatedAt))
		.limit(1);

	return { connection };
};

export const actions: Actions = {
	saveConnection: async ({ request }) => {
		const form = await request.formData();
		const type = String(form.get('type') ?? '').trim();
		const connectionString = String(form.get('connectionString') ?? '').trim();

		if (!isDatabaseType(type))
			return fail(400, { error: 'Elige un tipo de base de datos compatible.' });
		if (!connectionString) return fail(400, { error: 'La cadena de conexión es obligatoria.' });

		try {
			await testDatabaseConnection(type, connectionString);
		} catch (error) {
			return fail(400, {
				error: `La prueba de conexión falló: ${error instanceof Error ? error.message : 'Error desconocido'}`
			});
		}

		const timestamp = now();
		await db.delete(databaseConnections);
		await db.insert(databaseConnections).values({
			name: 'Base de datos principal',
			type,
			connectionString,
			createdAt: timestamp,
			updatedAt: timestamp
		});

		return { savedConnection: true };
	}
};
