import { redirect } from '@sveltejs/kit';
import { hasAdminParam, withAdminParam } from '$lib/admin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	throw redirect(303, hasAdminParam(url) ? withAdminParam('/metadata') : '/ask');
};
