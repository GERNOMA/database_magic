const ADMIN_QUERY_PARAM = 'admin';
const ADMIN_QUERY_VALUE = 'true';

export function hasAdminParam(url: URL) {
	return url.searchParams.get(ADMIN_QUERY_PARAM) === ADMIN_QUERY_VALUE;
}

export function withAdminParam(href: string) {
	const [hrefWithoutHash, hash] = href.split('#', 2);
	const [pathname, search = ''] = hrefWithoutHash.split('?', 2);
	const params = new URLSearchParams(search);
	params.set(ADMIN_QUERY_PARAM, ADMIN_QUERY_VALUE);
	const query = params.toString();

	return `${pathname}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

export function adminAction(actionName: string) {
	return `?/${actionName}&${ADMIN_QUERY_PARAM}=${ADMIN_QUERY_VALUE}`;
}
