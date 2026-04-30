export const USER_QUERY_PARAM = 'user';

type QueryParamValue = string | number | boolean | null | undefined;
type QueryParamSource = URL | URLSearchParams | Record<string, QueryParamValue>;

function splitHref(href: string) {
	const hashIndex = href.indexOf('#');
	const hrefWithoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
	const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
	const searchIndex = hrefWithoutHash.indexOf('?');

	if (searchIndex === -1) return { prefix: hrefWithoutHash, search: '', hash };

	return {
		prefix: hrefWithoutHash.slice(0, searchIndex),
		search: hrefWithoutHash.slice(searchIndex + 1),
		hash
	};
}

function splitSvelteAction(search: string) {
	if (!search.startsWith('/')) return { action: '', search };

	const separatorIndex = search.indexOf('&');
	if (separatorIndex === -1) return { action: search, search: '' };

	return {
		action: search.slice(0, separatorIndex),
		search: search.slice(separatorIndex + 1)
	};
}

function applyQueryParams(params: URLSearchParams, source: QueryParamSource) {
	const entries =
		source instanceof URL
			? source.searchParams.entries()
			: source instanceof URLSearchParams
				? source.entries()
				: Object.entries(source);

	for (const [key, value] of entries) {
		if (key.startsWith('/')) continue;

		if (value == null || value === '') {
			params.delete(key);
			continue;
		}

		params.set(key, String(value));
	}
}

function buildHref(prefix: string, action: string, params: URLSearchParams, hash: string) {
	const search = [action, params.toString()].filter(Boolean).join('&');
	return `${prefix}${search ? `?${search}` : ''}${hash}`;
}

export function getQueryParam(url: URL, name: string) {
	const value = url.searchParams.get(name)?.trim() ?? '';
	return value || null;
}

export function getUserParam(url: URL) {
	return getQueryParam(url, USER_QUERY_PARAM);
}

export function withQueryParams(href: string, ...sources: QueryParamSource[]) {
	const { prefix, search, hash } = splitHref(href);
	const { action, search: paramSearch } = splitSvelteAction(search);
	const params = new URLSearchParams(paramSearch);

	for (const source of sources) applyQueryParams(params, source);

	return buildHref(prefix, action, params, hash);
}

export function withCurrentQueryParams(url: URL, href: string, ...overrides: QueryParamSource[]) {
	const { prefix, search, hash } = splitHref(href);
	const { action, search: paramSearch } = splitSvelteAction(search);
	const params = new URLSearchParams(url.searchParams);

	applyQueryParams(params, new URLSearchParams(paramSearch));
	for (const override of overrides) applyQueryParams(params, override);

	return buildHref(prefix, action, params, hash);
}
