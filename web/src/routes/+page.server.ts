import { redirect } from '@sveltejs/kit';
import { hasAdminParam } from '$lib/admin';
import { withCurrentQueryParams } from '$lib/query-params';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const href = withCurrentQueryParams(url, hasAdminParam(url) ? '/metadata' : '/ask');

	throw redirect(303, href);
};
