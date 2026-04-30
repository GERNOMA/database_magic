import { redirect, type Handle } from '@sveltejs/kit';
import { hasAdminParam } from '$lib/admin';
import { startAiTaskScheduler } from '$lib/server/ai/routines';

const PUBLIC_PATHS = new Set(['/ask', '/notifications', '/tasks']);

startAiTaskScheduler();

export const handle: Handle = async ({ event, resolve }) => {
	const isPublicPath =
		PUBLIC_PATHS.has(event.url.pathname) || event.url.pathname.startsWith('/notifications/');

	if (event.route.id && !isPublicPath && !hasAdminParam(event.url)) {
		throw redirect(303, '/ask');
	}

	return resolve(event);
};
