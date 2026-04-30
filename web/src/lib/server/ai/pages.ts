import { and, desc, eq } from 'drizzle-orm';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import type { OpenRouterTool } from '$lib/server/ai/openrouter';
import { db } from '$lib/server/db';
import {
	extractReadOnlySql,
	isDatabaseType,
	runReadOnlyQuery,
	type DatabaseType
} from '$lib/server/db/query-runner';
import { aiPages, databaseConnections } from '$lib/server/db/schema';

const CREATE_PAGE_TOOL_NAME = 'create_page';
const LIST_PAGES_TOOL_NAME = 'list_pages';
const UPDATE_PAGE_CODE_TOOL_NAME = 'update_page_code';
const MAX_QUERY_ROWS = 500;
const MAX_EXECUTED_QUERIES = 12;
const MAX_PAGE_HTML_LENGTH = 300_000_000;
const TAILWIND_BROWSER_CSS_SCRIPT = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4';

type PageToolArgs = {
	title?: unknown;
	description?: unknown;
	pageCode?: unknown;
	visualPrompt?: unknown;
};

type UpdatePageCodeArgs = {
	pageId?: unknown;
	pageCode?: unknown;
};

type CreatePageInput = {
	userKey: string;
	title: string;
	description: string;
	pageCode: string;
	visualPrompt: string;
	selectedTableIds: number[];
};

type PageResult = {
	title?: unknown;
	html?: unknown;
};

type SvelteModule = {
	default: Component<{ data: Record<string, unknown> }>;
	loadPage?: (
		helpers: PageLoadHelpers
	) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

type PageLoadHelpers = {
	query: (sqlValue: unknown) => Promise<Array<Record<string, unknown>>>;
	formatNumber: (value: unknown) => string;
	Date: DateConstructor;
	Math: Math;
	JSON: JSON;
};

const now = () => new Date().toISOString();

function cleanString(value: unknown, fallback = '') {
	return typeof value === 'string' ? value.trim() : fallback;
}

function stripCodeFence(value: string) {
	const code = value
		.trim()
		.replace(/^```(?:svelte|sveltekit|js|javascript|ts|typescript)?\s*/i, '')
		.replace(/```\s*$/i, '')
		.trim();
	if (isSveltePageCode(code)) return code;
	const functionBody = code.match(/^(?:async\s+)?function\s+\w*\s*\([^)]*\)\s*\{([\s\S]*)\}$/);
	if (functionBody?.[1]) return functionBody[1].trim();
	return code;
}

function escapeHtml(value: unknown) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function sanitizePageHtml(value: string) {
	return value
		.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
		.replace(/\son\w+="[^"]*"/gi, '')
		.replace(/\son\w+='[^']*'/gi, '')
		.replace(/javascript:/gi, '');
}

function isSveltePageCode(code: string) {
	return /<script[\s\S]*?>|<[a-zA-Z][\s\S]*?>|{#(?:if|each|await)\b/.test(code);
}

function validatePageCode(code: string) {
	const forbidden = [
		/\bimport\b/,
		/\brequire\s*\(/,
		/\bprocess\b/,
		/\bchild_process\b/,
		/\bfs\b/,
		/\bfetch\s*\(/,
		/\beval\s*\(/,
		/\bFunction\b/,
		/\bconstructor\b/,
		/\bglobalThis\b/,
		/\bglobal\b/,
		/\bwindow\b/,
		/\bdocument\b/,
		/<script[^>]+\bsrc\s*=/i
	];

	if (forbidden.some((pattern) => pattern.test(code))) {
		throw new Error('El código de la página usa APIs no permitidas.');
	}
}

function createPreviewDocument(html: string, head = '') {
	return `<!doctype html>
<html lang="es">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<script src="${TAILWIND_BROWSER_CSS_SCRIPT}"></script>
	${head}
</head>
<body class="min-h-screen bg-white text-stone-950 antialiased">
	${html}
</body>
</html>`;
}

async function latestConnection() {
	const [connection] = await db
		.select()
		.from(databaseConnections)
		.orderBy(desc(databaseConnections.updatedAt))
		.limit(1);

	if (!connection) throw new Error('No hay una conexión de base de datos configurada.');
	if (!isDatabaseType(connection.type))
		throw new Error('La conexión configurada no es compatible.');

	return connection as typeof connection & { type: DatabaseType };
}

export function createPageTool(dialect: string): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: CREATE_PAGE_TOOL_NAME,
			description: `Create a saved dynamic ${dialect} SvelteKit web page for the current user. Use it when the user asks you to build a page, dashboard, portal, report, or visual app that should be opened later from Páginas. The stored page is a Svelte component rendered by the app with Tailwind classes. It may export loadPage({ query, formatNumber, Date, Math, JSON }) to run read-only SQL whenever the page opens.`,
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: 'Short Spanish name for the page.'
					},
					description: {
						type: 'string',
						description: 'What the page does and how the user described it.'
					},
					pageCode: {
						type: 'string',
						description:
							'SvelteKit +page.svelte component source using Svelte 5 syntax and Tailwind utility classes. Do not return raw HTML/CSS/JavaScript. Do not use imports, browser APIs, external scripts, or <script lang="ts">. If database data is needed, add <script module>export async function loadPage({ query, formatNumber, Date, Math, JSON }) { const rows = await query("SELECT ..."); return { title: "...", rows }; }</script>. In the component script use let { data } = $props(); and render the data with Svelte markup such as {#each data.rows as row}. Every SQL passed to query() must be one read-only SELECT or WITH statement.'
					},
					visualPrompt: {
						type: 'string',
						description:
							'The requested Svelte/Tailwind page style and behavior in Spanish. Include layout, charts/tables/cards, colors, responsive behavior, and any data assumptions.'
					}
				},
				required: ['title', 'description', 'pageCode', 'visualPrompt'],
				additionalProperties: false
			}
		}
	};
}

export function createListPagesTool(): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: LIST_PAGES_TOOL_NAME,
			description:
				'List every saved dynamic AI page owned by the current user, including ids, descriptions, current page code, and metadata. Use this before changing a page by name or when the user asks what pages exist.',
			parameters: {
				type: 'object',
				properties: {},
				additionalProperties: false
			}
		}
	};
}

export function createUpdatePageCodeTool(): OpenRouterTool {
	return {
		type: 'function',
		function: {
			name: UPDATE_PAGE_CODE_TOOL_NAME,
			description:
				'Update the SvelteKit component code of an existing dynamic page owned by the current user. Use list_pages first if the user identifies the page by name instead of id.',
			parameters: {
				type: 'object',
				properties: {
					pageId: {
						type: 'number',
						description: 'The id of the page to update.'
					},
					pageCode: {
						type: 'string',
						description:
							'Full replacement SvelteKit +page.svelte component source using Svelte 5 syntax and Tailwind utility classes. It may export loadPage({ query, formatNumber, Date, Math, JSON }) for read-only SQL data. Do not use raw HTML documents, imports, browser APIs, external scripts, or TypeScript.'
					}
				},
				required: ['pageId', 'pageCode'],
				additionalProperties: false
			}
		}
	};
}

export function isCreatePageToolCall(name: string) {
	return name === CREATE_PAGE_TOOL_NAME;
}

export function isListPagesToolCall(name: string) {
	return name === LIST_PAGES_TOOL_NAME;
}

export function isUpdatePageCodeToolCall(name: string) {
	return name === UPDATE_PAGE_CODE_TOOL_NAME;
}

export function parseCreatePageArgs(value: string) {
	const parsed = JSON.parse(value) as PageToolArgs;
	const title = cleanString(parsed.title, 'Página generada');
	const description = cleanString(parsed.description);
	const visualPrompt = cleanString(parsed.visualPrompt, description || title);
	const pageCode = stripCodeFence(cleanString(parsed.pageCode));

	if (!description) throw new Error('La página necesita una descripción.');
	if (!visualPrompt) throw new Error('La página necesita una descripción visual.');
	if (!pageCode) throw new Error('La página necesita código ejecutable.');
	validatePageCode(pageCode);

	return { title, description, visualPrompt, pageCode };
}

export function parseUpdatePageCodeArgs(value: string) {
	const parsed = JSON.parse(value) as UpdatePageCodeArgs;
	const pageId = Number(parsed.pageId);
	const pageCode = stripCodeFence(cleanString(parsed.pageCode));

	if (!Number.isInteger(pageId) || pageId <= 0) throw new Error('La página necesita un id válido.');
	if (!pageCode) throw new Error('La página necesita nuevo código ejecutable.');
	validatePageCode(pageCode);

	return { pageId, pageCode };
}

export async function listAiPagesForUser(userKey: string) {
	const pages = await db
		.select()
		.from(aiPages)
		.where(eq(aiPages.userKey, userKey))
		.orderBy(desc(aiPages.updatedAt), desc(aiPages.id));

	return pages.map((page) => ({
		id: page.id,
		userKey: page.userKey,
		title: page.title,
		description: page.description,
		pageCode: page.pageCode,
		visualPrompt: page.visualPrompt,
		selectedTableIdsJson: page.selectedTableIdsJson,
		createdAt: page.createdAt,
		updatedAt: page.updatedAt
	}));
}

export async function updateAiPageCodeForUser(userKey: string, pageId: number, pageCode: string) {
	const [page] = await db
		.select()
		.from(aiPages)
		.where(and(eq(aiPages.id, pageId), eq(aiPages.userKey, userKey)))
		.limit(1);
	if (!page) throw new Error('No se encontró esa página.');

	await db
		.update(aiPages)
		.set({
			pageCode,
			updatedAt: now()
		})
		.where(and(eq(aiPages.id, pageId), eq(aiPages.userKey, userKey)));

	return { id: page.id, title: page.title, updated: true };
}

export async function createAiPage(input: CreatePageInput) {
	const timestamp = now();
	const [page] = await db
		.insert(aiPages)
		.values({
			userKey: input.userKey,
			title: input.title,
			description: input.description,
			pageCode: input.pageCode,
			visualPrompt: input.visualPrompt,
			selectedTableIdsJson: JSON.stringify(input.selectedTableIds),
			createdAt: timestamp,
			updatedAt: timestamp
		})
		.returning();

	return page;
}

export async function renderAiPage(page: typeof aiPages.$inferSelect) {
	const connection = await latestConnection();
	const executedSql: string[] = [];
	const query = async (sqlValue: unknown) => {
		if (executedSql.length >= MAX_EXECUTED_QUERIES) {
			throw new Error(`La página superó el máximo de ${MAX_EXECUTED_QUERIES} consultas.`);
		}

		const sql = extractReadOnlySql(cleanString(sqlValue));
		const rows = await runReadOnlyQuery(connection.type, connection.connectionString, sql);
		executedSql.push(sql);
		return rows.slice(0, MAX_QUERY_ROWS);
	};
	const formatNumber = (value: unknown) =>
		new Intl.NumberFormat('es').format(Number.isFinite(Number(value)) ? Number(value) : 0);
	if (isSveltePageCode(page.pageCode)) {
		const compiled = compile(page.pageCode, {
			dev: false,
			generate: 'server',
			name: `AiPage${page.id}`
		});
		const svelteServerUrl = await import.meta.resolve('svelte/internal/server');
		const moduleCode = compiled.js.code.replace(
			/from ['"]svelte\/internal\/server['"]/g,
			`from '${svelteServerUrl}'`
		);
		const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleCode)}`;
		const componentModule = (await import(/* @vite-ignore */ moduleUrl)) as SvelteModule;
		const data =
			(await componentModule.loadPage?.({
				query,
				formatNumber,
				Date,
				Math,
				JSON
			})) ?? {};
		const rendered = render(componentModule.default, { props: { data } });
		const title = cleanString((data as { title?: unknown }).title, page.title) || page.title;
		const html = sanitizePageHtml(rendered.html);
		const head = sanitizePageHtml(rendered.head);

		if (!html) throw new Error('La página Svelte no devolvió contenido.');
		const previewHtml = createPreviewDocument(html, head);
		if (previewHtml.length > MAX_PAGE_HTML_LENGTH)
			throw new Error('La página generada es demasiado grande.');

		return { title, html: previewHtml, executedSql };
	}

	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
		...args: string[]
	) => (...args: unknown[]) => Promise<PageResult>;
	const run = new AsyncFunction(
		'query',
		'escapeHtml',
		'formatNumber',
		'Date',
		'Math',
		'JSON',
		'Array',
		'Object',
		'String',
		'Number',
		'Boolean',
		'console',
		'process',
		'require',
		'globalThis',
		'global',
		'fetch',
		'eval',
		'Function',
		page.pageCode
	);
	const result = await run(
		query,
		escapeHtml,
		formatNumber,
		Date,
		Math,
		JSON,
		Array,
		Object,
		String,
		Number,
		Boolean,
		{ log: () => undefined },
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined
	);
	const title = cleanString(result?.title, page.title) || page.title;
	const html = sanitizePageHtml(cleanString(result?.html));

	if (!html) throw new Error('La página no devolvió HTML.');
	if (html.length > MAX_PAGE_HTML_LENGTH)
		throw new Error('La página generada es demasiado grande.');

	return { title, html: createPreviewDocument(html), executedSql };
}
