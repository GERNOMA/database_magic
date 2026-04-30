import { withQueryParams } from '$lib/query-params';

const ADMIN_QUERY_PARAM = 'admin';
const ADMIN_QUERY_VALUE = 'true';

export function hasAdminParam(url: URL) {
	return url.searchParams.get(ADMIN_QUERY_PARAM) === ADMIN_QUERY_VALUE;
}

export function withAdminParam(href: string) {
	return withQueryParams(href, { [ADMIN_QUERY_PARAM]: ADMIN_QUERY_VALUE });
}

export function adminAction(actionName: string) {
	return withAdminParam(`?/${actionName}`);
}
