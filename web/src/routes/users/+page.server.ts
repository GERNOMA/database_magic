import { fail, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { withCurrentQueryParams } from '$lib/query-params';
import { db } from '$lib/server/db';
import { appUsers, metadataTables, tableMetadata } from '$lib/server/db/schema';
import {
	createTableGroups,
	expandSelectedTableIds,
	getSelectedTableIds,
	parseTableIdsJson,
	parseTableRestrictionsJson,
	serializeTableRestrictions
} from '$lib/server/table-groups';
import type { Actions, PageServerLoad } from './$types';

const now = () => new Date().toISOString();

function cleanUserKey(value: string) {
	return value.trim();
}

const usersRedirect = (url: URL, href: string) => redirect(303, withCurrentQueryParams(url, href));

export const load: PageServerLoad = async ({ url }) => {
	const users = await db.select().from(appUsers).orderBy(asc(appUsers.userKey));
	const tables = await db.select().from(metadataTables).orderBy(asc(metadataTables.name));
	const metadataRows = await db.select().from(tableMetadata).orderBy(asc(tableMetadata.fileName));
	const tableGroups = createTableGroups(tables, new Set(metadataRows.map((row) => row.tableId)));
	const selectedUserId = Number(url.searchParams.get('account') ?? users[0]?.id ?? 0);
	const selectedUser = users.find((user) => user.id === selectedUserId) ?? users[0] ?? null;

	return {
		users,
		selectedUserId: selectedUser?.id ?? 0,
		tableGroups,
		selectedTableIds: parseTableIdsJson(selectedUser?.allowedTableIdsJson ?? null),
		tableRestrictions: Object.fromEntries(
			parseTableRestrictionsJson(selectedUser?.tableRestrictionsJson ?? null)
		),
		saved: url.searchParams.get('saved') === '1'
	};
};

export const actions: Actions = {
	addUser: async ({ request, url }) => {
		const form = await request.formData();
		const userKey = cleanUserKey(String(form.get('userKey') ?? ''));
		if (!userKey) return fail(400, { error: 'El usuario es obligatorio.' });

		const timestamp = now();
		let createdId: number;
		try {
			const [created] = await db
				.insert(appUsers)
				.values({
					userKey,
					allowedTableIdsJson: '[]',
					tableRestrictionsJson: '{}',
					createdAt: timestamp,
					updatedAt: timestamp
				})
				.returning();
			createdId = created.id;
		} catch {
			return fail(400, { error: 'Ya existe un usuario con ese nombre.' });
		}

		throw usersRedirect(url, `/users?account=${createdId}`);
	},

	deleteUser: async ({ request, url }) => {
		const form = await request.formData();
		const userId = Number(form.get('userId'));
		if (!userId) return fail(400, { error: 'No se pudo eliminar ese usuario.' });

		await db.delete(appUsers).where(eq(appUsers.id, userId));

		throw usersRedirect(url, '/users');
	},

	savePermissions: async ({ request, url }) => {
		const form = await request.formData();
		const userId = Number(form.get('userId'));
		if (!userId) return fail(400, { error: 'Selecciona un usuario antes de guardar.' });

		const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
		if (!user) return fail(404, { error: 'No se encontró el usuario.' });

		const tables = await db.select().from(metadataTables).orderBy(asc(metadataTables.name));
		const metadataRows = await db.select().from(tableMetadata).orderBy(asc(tableMetadata.fileName));
		const tableGroups = createTableGroups(tables, new Set(metadataRows.map((row) => row.tableId)));
		const selectedTableIds = expandSelectedTableIds(getSelectedTableIds(form), tableGroups);
		const tableRestrictionsJson = serializeTableRestrictions(
			String(form.get('tableRestrictionsJson') ?? '{}'),
			selectedTableIds
		);

		await db
			.update(appUsers)
			.set({
				allowedTableIdsJson: JSON.stringify(selectedTableIds),
				tableRestrictionsJson,
				updatedAt: now()
			})
			.where(eq(appUsers.id, userId));

		throw usersRedirect(url, `/users?account=${userId}&saved=1`);
	}
};
