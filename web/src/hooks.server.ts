import { redirect, type Handle } from '@sveltejs/kit';
import { hasAdminParam } from '$lib/admin';

const PUBLIC_PATHS = new Set(['/ask']);

export const handle: Handle = async ({ event, resolve }) => {
	if (event.route.id && !PUBLIC_PATHS.has(event.url.pathname) && !hasAdminParam(event.url)) {
		throw redirect(303, '/ask');
	}

	return resolve(event);
};
