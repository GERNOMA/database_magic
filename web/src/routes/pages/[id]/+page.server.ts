import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { hasAdminParam } from '$lib/admin';
import { getUserParam } from '$lib/query-params';
import { renderAiPage } from '$lib/server/ai/pages';
import { db } from '$lib/server/db';
import { aiPages } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const id = Number(params.id);
	const isAdmin = hasAdminParam(url);
	const currentUser = getUserParam(url);
	if (!id) throw error(404, 'Página no encontrada');
	if (!isAdmin && !currentUser) throw error(404, 'Página no encontrada');

	const [page] = await db
		.select()
		.from(aiPages)
		.where(
			isAdmin ? eq(aiPages.id, id) : and(eq(aiPages.id, id), eq(aiPages.userKey, currentUser!))
		)
		.limit(1);
	if (!page) throw error(404, 'Página no encontrada');

	try {
		const rendered = await renderAiPage(page);
		return {
			isAdmin,
			currentUser,
			page,
			rendered,
			error: null
		};
	} catch (renderError) {
		return {
			isAdmin,
			currentUser,
			page,
			rendered: null,
			error: renderError instanceof Error ? renderError.message : 'No se pudo renderizar la página.'
		};
	}
};
