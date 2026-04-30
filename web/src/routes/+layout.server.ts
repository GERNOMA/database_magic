import { hasAdminParam } from '$lib/admin';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ url }) => {
	return {
		isAdmin: hasAdminParam(url),
		currentUser: url.searchParams.get('user')?.trim() || null
	};
};
