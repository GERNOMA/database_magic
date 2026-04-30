import { fail, redirect } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { hasAdminParam } from '$lib/admin';
import { getUserParam, withCurrentQueryParams } from '$lib/query-params';
import { db } from '$lib/server/db';
import { aiPages } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const pagesRedirect = (url: URL, href: string) => redirect(303, withCurrentQueryParams(url, href));

export const load: PageServerLoad = async ({ url }) => {
	const isAdmin = hasAdminParam(url);
	const currentUser = getUserParam(url);
	const pages = isAdmin
		? await db.select().from(aiPages).orderBy(desc(aiPages.updatedAt), desc(aiPages.id))
		: currentUser
			? await db
					.select()
					.from(aiPages)
					.where(eq(aiPages.userKey, currentUser))
					.orderBy(desc(aiPages.updatedAt), desc(aiPages.id))
			: [];

	return {
		isAdmin,
		currentUser,
		pages
	};
};

export const actions: Actions = {
	deletePage: async ({ request, url }) => {
		const isAdmin = hasAdminParam(url);
		const currentUser = getUserParam(url);
		if (!isAdmin && !currentUser) return fail(400, { error: 'Usuario no ingresado.' });

		const form = await request.formData();
		const pageId = Number(form.get('pageId'));
		if (!pageId) return fail(400, { error: 'No se pudo eliminar esa página.' });

		await db
			.delete(aiPages)
			.where(
				isAdmin
					? eq(aiPages.id, pageId)
					: and(eq(aiPages.id, pageId), eq(aiPages.userKey, currentUser!))
			);

		throw pagesRedirect(url, '/pages');
	}
};
