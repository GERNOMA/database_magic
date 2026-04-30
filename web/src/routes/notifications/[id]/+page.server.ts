import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { hasAdminParam } from '$lib/admin';
import { getUserParam } from '$lib/query-params';
import { db } from '$lib/server/db';
import { aiTaskRuns, aiTasks, notifications } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const id = Number(params.id);
	const isAdmin = hasAdminParam(url);
	const currentUser = getUserParam(url);
	if (!id) throw error(404, 'Notificación no encontrada');
	if (!isAdmin && !currentUser) throw error(404, 'Notificación no encontrada');

	const [notification] = await db
		.select()
		.from(notifications)
		.where(
			isAdmin
				? eq(notifications.id, id)
				: and(eq(notifications.id, id), eq(notifications.userKey, currentUser!))
		)
		.limit(1);
	if (!notification) throw error(404, 'Notificación no encontrada');

	const [run] = notification.runId
		? await db.select().from(aiTaskRuns).where(eq(aiTaskRuns.id, notification.runId)).limit(1)
		: [];
	const [task] = notification.taskId
		? await db.select().from(aiTasks).where(eq(aiTasks.id, notification.taskId)).limit(1)
		: [];

	if (!notification.readAt) {
		await db
			.update(notifications)
			.set({ readAt: new Date().toISOString() })
			.where(eq(notifications.id, notification.id));
	}

	return {
		isAdmin,
		currentUser,
		notification: {
			...notification,
			readAt: notification.readAt ?? new Date().toISOString()
		},
		run: run ?? null,
		task: task ?? null
	};
};
