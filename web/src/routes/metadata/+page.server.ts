import { fail, redirect } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
import { askOpenRouter } from '$lib/server/ai/openrouter';
import { db } from '$lib/server/db';
import { compiledMetadata, metadataTables, tableFiles, tableMetadata } from '$lib/server/db/schema';
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

function extractJson<T>(value: string): T {
	const withoutFence = value.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '');
	return JSON.parse(withoutFence) as T;
}

export const load: PageServerLoad = async ({ url }) => {
	const tables = await db.select().from(metadataTables).orderBy(asc(metadataTables.name));
	const files = await db.select().from(tableFiles).orderBy(desc(tableFiles.createdAt));
	const metadataRows = await db.select().from(tableMetadata).orderBy(desc(tableMetadata.updatedAt));
	const [compiled] = await db
		.select()
		.from(compiledMetadata)
		.orderBy(desc(compiledMetadata.createdAt))
		.limit(1);

	const selectedTableId = Number(url.searchParams.get('table') ?? tables[0]?.id ?? 0);

	return {
		tables,
		files,
		metadataRows,
		selectedTableId,
		compiled
	};
};

export const actions: Actions = {
	addTable: async ({ request }) => {
		const form = await request.formData();
		const name = cleanName(String(form.get('name') ?? ''));
		if (!name) return fail(400, { error: 'Table name is required.' });

		const timestamp = now();
		let createdId: number;
		try {
			const [created] = await db
				.insert(metadataTables)
				.values({ name, createdAt: timestamp, updatedAt: timestamp })
				.returning();
			createdId = created.id;
		} catch {
			return fail(400, { error: 'A table with that name already exists.' });
		}
		throw redirect(303, `/metadata?table=${createdId}`);
	},

	deleteTable: async ({ request }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		if (!tableId) return fail(400, { error: 'Could not delete that table.' });

		await db.delete(metadataTables).where(eq(metadataTables.id, tableId));

		throw redirect(303, '/metadata');
	},

	addFile: async ({ request }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		const file = form.get('file');

		if (!tableId) return fail(400, { error: 'Select a table before adding files.' });
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { error: 'Choose a file to upload.' });

		await db.insert(tableFiles).values({
			tableId,
			name: file.name,
			content: await file.text(),
			mimeType: file.type || 'text/plain',
			createdAt: now()
		});

		throw redirect(303, `/metadata?table=${tableId}`);
	},

	deleteFile: async ({ request }) => {
		const form = await request.formData();
		const fileId = Number(form.get('fileId'));
		const tableId = Number(form.get('tableId'));

		if (!fileId || !tableId) return fail(400, { error: 'Could not delete that file.' });

		await db.delete(tableFiles).where(eq(tableFiles.id, fileId));

		throw redirect(303, `/metadata?table=${tableId}`);
	},

	analyzeTable: async ({ request }) => {
		const form = await request.formData();
		const tableId = Number(form.get('tableId'));
		if (!tableId) return fail(400, { error: 'Select a table to analyze.' });

		const [table] = await db
			.select()
			.from(metadataTables)
			.where(eq(metadataTables.id, tableId))
			.limit(1);
		const files = await db.select().from(tableFiles).where(eq(tableFiles.tableId, tableId));
		if (!table) return fail(404, { error: 'Table not found.' });
		if (files.length === 0) return fail(400, { error: 'Add at least one file before analyzing.' });

		try {
			const response = await askOpenRouter(
				[
					{
						role: 'system',
						content:
							'You analyze database context files and return strict JSON only. The JSON shape must be {"tableName": string, "generalDescription": string, "fields": [{"name": string, "description": string}]}'
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
				error: error instanceof Error ? error.message : 'Could not analyze table.'
			});
		}
		throw redirect(303, `/metadata?table=${tableId}`);
	},

	compileAll: async () => {
		const rows = await db.select().from(tableMetadata).orderBy(asc(tableMetadata.fileName));
		const compiled = {
			createdAt: now(),
			tables: rows.map((row) => extractJson<MetadataJson>(row.json))
		};

		await db.insert(compiledMetadata).values({
			fileName: 'master_metadata.json',
			json: JSON.stringify(compiled, null, 2),
			createdAt: compiled.createdAt
		});

		throw redirect(303, '/metadata?compiled=1');
	}
};
