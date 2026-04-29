import { fail } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
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
		const connectionString = String(form.get('connectionString') ?? '').trim();
		if (!connectionString) return fail(400, { error: 'Connection string is required.' });

		const timestamp = now();
		await db.delete(databaseConnections);
		await db.insert(databaseConnections).values({
			name: 'Primary database',
			type: 'sqlite',
			connectionString,
			createdAt: timestamp,
			updatedAt: timestamp
		});

		return { savedConnection: true };
	}
};
