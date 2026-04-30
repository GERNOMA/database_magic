import { fail, redirect } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { hasAdminParam } from '$lib/admin';
import { getUserParam, withCurrentQueryParams } from '$lib/query-params';
import { executeAiTask } from '$lib/server/ai/routines';
import { db } from '$lib/server/db';
import { aiTaskRuns, aiTasks } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const tasksRedirect = (url: URL, href: string) => redirect(303, withCurrentQueryParams(url, href));

export const load: PageServerLoad = async ({ url }) => {
	const isAdmin = hasAdminParam(url);
	const currentUser = getUserParam(url);
	const tasks = isAdmin
		? await db.select().from(aiTasks).orderBy(desc(aiTasks.updatedAt))
		: currentUser
			? await db
					.select()
					.from(aiTasks)
					.where(eq(aiTasks.userKey, currentUser))
					.orderBy(desc(aiTasks.updatedAt))
			: [];
	const runs = await db
		.select()
		.from(aiTaskRuns)
		.orderBy(desc(aiTaskRuns.createdAt), desc(aiTaskRuns.id));
	const latestRunByTaskId = new Map<number, (typeof runs)[number]>();

	for (const run of runs) {
		if (!latestRunByTaskId.has(run.taskId)) latestRunByTaskId.set(run.taskId, run);
	}

	return {
		isAdmin,
		currentUser,
		tasks: tasks.map((task) => ({
			...task,
			latestRun: latestRunByTaskId.get(task.id) ?? null
		})),
		saved: url.searchParams.get('saved') === '1'
	};
};

export const actions: Actions = {
	toggleTask: async ({ request, url }) => {
		const isAdmin = hasAdminParam(url);
		const currentUser = getUserParam(url);
		if (!isAdmin && !currentUser) return fail(400, { error: 'Usuario no ingresado.' });

		const form = await request.formData();
		const taskId = Number(form.get('taskId'));
		const isActive = Number(form.get('isActive')) === 1 ? 1 : 0;
		if (!taskId) return fail(400, { error: 'No se pudo actualizar esa tarea.' });

		await db
			.update(aiTasks)
			.set({ isActive, updatedAt: new Date().toISOString() })
			.where(
				isAdmin
					? eq(aiTasks.id, taskId)
					: and(eq(aiTasks.id, taskId), eq(aiTasks.userKey, currentUser!))
			);

		throw tasksRedirect(url, '/tasks?saved=1');
	},

	runNow: async ({ request, url }) => {
		const isAdmin = hasAdminParam(url);
		const currentUser = getUserParam(url);
		if (!isAdmin && !currentUser) return fail(400, { error: 'Usuario no ingresado.' });

		const form = await request.formData();
		const taskId = Number(form.get('taskId'));
		if (!taskId) return fail(400, { error: 'No se pudo ejecutar esa tarea.' });

		const [task] = await db
			.select()
			.from(aiTasks)
			.where(
				isAdmin
					? eq(aiTasks.id, taskId)
					: and(eq(aiTasks.id, taskId), eq(aiTasks.userKey, currentUser!))
			)
			.limit(1);
		if (!task) return fail(404, { error: 'No se encontró esa tarea.' });

		await executeAiTask(task);
		throw tasksRedirect(url, '/tasks?saved=1');
	},

	deleteTask: async ({ request, url }) => {
		const isAdmin = hasAdminParam(url);
		const currentUser = getUserParam(url);
		if (!isAdmin && !currentUser) return fail(400, { error: 'Usuario no ingresado.' });

		const form = await request.formData();
		const taskId = Number(form.get('taskId'));
		if (!taskId) return fail(400, { error: 'No se pudo eliminar esa tarea.' });

		await db
			.delete(aiTasks)
			.where(
				isAdmin
					? eq(aiTasks.id, taskId)
					: and(eq(aiTasks.id, taskId), eq(aiTasks.userKey, currentUser!))
			);

		throw tasksRedirect(url, '/tasks');
	}
};
