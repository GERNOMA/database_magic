import { desc, eq } from 'drizzle-orm';
import { hasAdminParam } from '$lib/admin';
import { getUserParam } from '$lib/query-params';
import { db } from '$lib/server/db';
import { notifications } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const isAdmin = hasAdminParam(url);
	const currentUser = getUserParam(url);
	const items = isAdmin
		? await db
				.select()
				.from(notifications)
				.orderBy(desc(notifications.createdAt), desc(notifications.id))
		: currentUser
			? await db
					.select()
					.from(notifications)
					.where(eq(notifications.userKey, currentUser))
					.orderBy(desc(notifications.createdAt), desc(notifications.id))
			: [];

	return {
		isAdmin,
		currentUser,
		notifications: items,
		unreadCount: items.filter((item) => !item.readAt).length
	};
};
