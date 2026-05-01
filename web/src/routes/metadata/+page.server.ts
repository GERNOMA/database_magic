import { fail, redirect } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
import { withCurrentQueryParams } from '$lib/query-params';
import { askOpenRouter } from '$lib/server/ai/openrouter';
import { db } from '$lib/server/db';
import {
	isDatabaseType,
	listDatabaseTableExamples,
	listDatabaseTableFields,
	listDatabaseTableNames
} from '$lib/server/db/query-runner';
import {
	databaseConnections,
	metadataTables,
	tableFiles,
	tableMetadata
} from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

type MetadataJson = {
	tableName: string;
	generalDescription: string;
	fields: Array<{ name: string; description: string }>;
};

const now = () => new Date().toISOString();

function cleanName(name: string) {
	return name.trim().replace(/\s+/g, '_');
}

function cleanCategories(categories: FormDataEntryValue[]) {
	return categories
		.map((category) => String(category).trim())
		.filter(
			(category, index, allCategories) => category && allCategories.indexOf(category) === index
		);
}

function extractJson<T>(value: string): T {
	const withoutFence = value.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '');
	return JSON.parse(withoutFence) as T;
}

function normalizeJsonValue(value: unknown): unknown {
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(normalizeJsonValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, nestedValue]) => [key, normalizeJsonValue(nestedValue)])
		);
	}
	return value;
}

const adminRedirect = (url: URL, href: string) => redirect(303, withCurrentQueryParams(url, href));

export const load: PageServerLoad = async ({ url }) => {
	const tables = await db.select().from(metadataTables).orderBy(asc(metadataTables.name));
	const files = await db.select().from(tableFiles).orderBy(desc(tableFiles.createdAt));
	const metadataRows = await db.select().from(tableMetadata).orderBy(desc(tableMetadata.updatedAt));

	const selectedTableId = Number(url.searchParams.get('table') ?? tables[0]?.id ?? 0);

	return {
		tables,
		files,
		metadataRows,
		selectedTableId,
		saved: url.searchParams.get('saved') === '1'
	};
};

export const actions: Actions = {
	addTable: async ({ request, url }) => {
		const form = await request.formData();
		const name = cleanName(String(form.get('name') ?? ''));
		if (!name) return fail(400, { error: 'El nombre de la tabla es obligatorio.' });

		const timestamp = now();
		let createdId: number;
		try {
			const [created] = await db
				.insert(metadataTables)
				.values({ name, createdAt: timestamp, updatedAt: timestamp })
				.returning();
			createdId = created.id;
		} catch {
			return fail(400, { error: 'Ya existe una tabla con ese nombre.' });
		}
		throw adminRedirect(url, `/metadata?table=${createdId}`);
	},

	deleteTable: async ({ request, url }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		if (!tableId) return fail(400, { error: 'No se pudo eliminar esa tabla.' });

		await db.delete(metadataTables).where(eq(metadataTables.id, tableId));

		throw adminRedirect(url, '/metadata');
	},

	saveTableUserName: async ({ request, url }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		const categories = cleanCategories(form.getAll('categories'));
		if (!tableId)
			return fail(400, { error: 'Selecciona una tabla antes de guardar la categoría.' });

		await db
			.update(metadataTables)
			.set({
				userFriendlyName: categories.length > 0 ? JSON.stringify(categories) : null,
				updatedAt: now()
			})
			.where(eq(metadataTables.id, tableId));

		throw adminRedirect(url, `/metadata?table=${tableId}&saved=1`);
	},

	autoImportTables: async ({ url }) => {
		const [connection] = await db
			.select()
			.from(databaseConnections)
			.orderBy(desc(databaseConnections.updatedAt))
			.limit(1);
		if (!connection)
			return fail(400, { error: 'Conecta una base de datos antes de importar tablas.' });
		if (!isDatabaseType(connection.type)) {
			return fail(400, {
				error: 'Elige un tipo de base de datos compatible antes de importar tablas.'
			});
		}

		let databaseTableNames: string[];
		try {
			databaseTableNames = await listDatabaseTableNames(
				connection.type,
				connection.connectionString
			);
		} catch (error) {
			return fail(500, {
				error:
					error instanceof Error
						? error.message
						: 'No se pudieron importar las tablas de la base de datos.'
			});
		}

		const existingTables = await db.select().from(metadataTables);
		const existingNames = new Set(existingTables.map((table) => table.name));
		const namesToImport = databaseTableNames
			.map(cleanName)
			.filter((name, index, names) => name && names.indexOf(name) === index)
			.filter((name) => !existingNames.has(name));

		if (namesToImport.length === 0) throw adminRedirect(url, '/metadata');

		const timestamp = now();
		const importedTables = await db
			.insert(metadataTables)
			.values(namesToImport.map((name) => ({ name, createdAt: timestamp, updatedAt: timestamp })))
			.returning();

		throw adminRedirect(url, `/metadata?table=${importedTables[0]?.id ?? ''}`);
	},

	addFile: async ({ request, url }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		const file = form.get('file');

		if (!tableId) return fail(400, { error: 'Selecciona una tabla antes de agregar archivos.' });
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { error: 'Elige un archivo para subir.' });

		await db.insert(tableFiles).values({
			tableId,
			name: file.name,
			content: await file.text(),
			mimeType: file.type || 'text/plain',
			createdAt: now()
		});

		throw adminRedirect(url, `/metadata?table=${tableId}`);
	},

	addAutomaticFile: async ({ request, url }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		if (!tableId) return fail(400, { error: 'Selecciona una tabla antes de agregar archivos.' });

		const [table] = await db
			.select()
			.from(metadataTables)
			.where(eq(metadataTables.id, tableId))
			.limit(1);
		if (!table) return fail(404, { error: 'No se encontró la tabla.' });

		const [connection] = await db
			.select()
			.from(databaseConnections)
			.orderBy(desc(databaseConnections.updatedAt))
			.limit(1);
		if (!connection)
			return fail(400, {
				error: 'Conecta una base de datos antes de agregar un archivo automático.'
			});
		if (!isDatabaseType(connection.type)) {
			return fail(400, {
				error: 'Elige un tipo de base de datos compatible antes de agregar un archivo automático.'
			});
		}

		let fields: string[];
		let tableExamples: Array<Record<string, unknown>>;
		try {
			fields = await listDatabaseTableFields(
				connection.type,
				connection.connectionString,
				table.name
			);
			tableExamples = await listDatabaseTableExamples(
				connection.type,
				connection.connectionString,
				table.name
			);
		} catch (error) {
			return fail(500, {
				error:
					error instanceof Error ? error.message : 'No se pudo leer la información de la tabla.'
			});
		}

		if (fields.length === 0)
			return fail(400, { error: 'No se encontraron campos para esa tabla.' });

		await db.insert(tableFiles).values({
			tableId,
			name: `${table.name}_automatic.json`,
			content: JSON.stringify(
				{ tableName: table.name, fields, table_examples: normalizeJsonValue(tableExamples) },
				null,
				2
			),
			mimeType: 'application/json',
			createdAt: now()
		});

		throw adminRedirect(url, `/metadata?table=${tableId}`);
	},

	deleteFile: async ({ request, url }) => {
		const form = await request.formData();
		const fileId = Number(form.get('fileId'));
		const tableId = Number(form.get('tableId'));

		if (!fileId || !tableId) return fail(400, { error: 'No se pudo eliminar ese archivo.' });

		await db.delete(tableFiles).where(eq(tableFiles.id, fileId));

		throw adminRedirect(url, `/metadata?table=${tableId}`);
	},

	analyzeTable: async ({ request, url }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		if (!tableId) return fail(400, { error: 'Selecciona una tabla para analizar.' });

		const [table] = await db
			.select()
			.from(metadataTables)
			.where(eq(metadataTables.id, tableId))
			.limit(1);
		const files = await db.select().from(tableFiles).where(eq(tableFiles.tableId, tableId));
		if (!table) return fail(404, { error: 'No se encontró la tabla.' });
		if (files.length === 0)
			return fail(400, { error: 'Agrega al menos un archivo antes de analizar.' });

		try {
			const response = await askOpenRouter(
				[
					{
						role: 'system',
						content:
							'You analyze database context files and return strict JSON only. Write descriptions in Spanish. The JSON shape must be {"tableName": string, "generalDescription": string, "fields": [{"name": string, "description": string}]}'
					},
					{
						role: 'user',
						content: `Analyze the table named "${table.name}". Use these files as context:\n\n${files
							.map((file) => `--- ${file.name} ---\n${file.content}`)
							.join('\n\n')}`
					}
				],
				{ json: true }
			);
			const metadata = extractJson<MetadataJson>(response);
			const timestamp = now();
			const fileName = `${table.name}_metadata.json`;

			await db
				.insert(tableMetadata)
				.values({
					tableId,
					fileName,
					json: JSON.stringify(metadata, null, 2),
					createdAt: timestamp,
					updatedAt: timestamp
				})
				.onConflictDoUpdate({
					target: tableMetadata.tableId,
					set: { fileName, json: JSON.stringify(metadata, null, 2), updatedAt: timestamp }
				});
		} catch (error) {
			return fail(500, {
				error: error instanceof Error ? error.message : 'No se pudo analizar la tabla.'
			});
		}
		throw adminRedirect(url, `/metadata?table=${tableId}`);
	},

	saveMetadata: async ({ request, url }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		const json = String(form.get('json') ?? '').trim();

		if (!tableId) return fail(400, { error: 'Selecciona una tabla antes de guardar metadatos.' });
		if (!json) return fail(400, { error: 'El JSON de metadatos no puede estar vacío.' });

		const [metadata] = await db
			.select()
			.from(tableMetadata)
			.where(eq(tableMetadata.tableId, tableId))
			.limit(1);
		if (!metadata) return fail(404, { error: 'Genera metadatos antes de editarlos.' });

		try {
			const parsed = extractJson<MetadataJson>(json);
			await db
				.update(tableMetadata)
				.set({ json: JSON.stringify(parsed, null, 2), updatedAt: now() })
				.where(eq(tableMetadata.tableId, tableId));
		} catch {
			return fail(400, { error: 'Los metadatos deben ser JSON válido antes de poder guardarse.' });
		}

		throw adminRedirect(url, `/metadata?table=${tableId}&saved=1`);
	}
};
