import type { metadataTables } from '$lib/server/db/schema';

type MetadataTable = typeof metadataTables.$inferSelect;

export type TableGroup = {
	id: string;
	label: string;
	tableIds: number[];
	tableNames: string[];
};

export function parseTableCategories(table: MetadataTable) {
	const value = table.userFriendlyName?.trim();
	if (!value) return [];

	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [value];

		return parsed
			.filter((category): category is string => typeof category === 'string')
			.map((category) => category.trim())
			.filter((category, index, categories) => category && categories.indexOf(category) === index);
	} catch {
		return [value];
	}
}

export function tableLabel(table: MetadataTable) {
	const categories = parseTableCategories(table);
	return categories.length > 0 ? categories.join(', ') : table.name;
}

function tableGroupId(label: string) {
	return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createTableGroups(tables: MetadataTable[], tableIdsWithMetadata: Set<number>) {
	const groups = new Map<string, TableGroup>();

	for (const table of tables) {
		if (!tableIdsWithMetadata.has(table.id)) continue;

		const labels = parseTableCategories(table);
		const tableLabels = labels.length > 0 ? labels : [table.name];

		for (const label of tableLabels) {
			const id = tableGroupId(label);
			const existing = groups.get(id);

			if (existing) {
				existing.tableIds.push(table.id);
				existing.tableNames.push(table.name);
				continue;
			}

			groups.set(id, {
				id,
				label,
				tableIds: [table.id],
				tableNames: [table.name]
			});
		}
	}

	return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function parseTableIdsJson(value: string | null) {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((id): id is number => Number.isInteger(id) && id > 0)
			: [];
	} catch {
		return [];
	}
}

export function parseTableRestrictionsJson(value: string | null) {
	const restrictions = new Map<number, string>();
	if (!value) return restrictions;

	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return restrictions;

		for (const [tableId, restriction] of Object.entries(parsed)) {
			const id = Number(tableId);
			if (!Number.isInteger(id) || id <= 0 || typeof restriction !== 'string') continue;

			const cleanRestriction = restriction.trim();
			if (cleanRestriction) restrictions.set(id, cleanRestriction);
		}
	} catch {
		return restrictions;
	}

	return restrictions;
}

export function serializeTableRestrictions(
	value: string | null,
	allowedTableIds: number[] | Set<number>
) {
	const allowedIdSet = allowedTableIds instanceof Set ? allowedTableIds : new Set(allowedTableIds);
	const restrictions = parseTableRestrictionsJson(value);
	const serialized: Record<string, string> = {};

	for (const [tableId, restriction] of restrictions) {
		if (allowedIdSet.has(tableId)) serialized[String(tableId)] = restriction;
	}

	return JSON.stringify(serialized);
}

export function getSelectedTableIds(form: FormData) {
	return form
		.getAll('tableIds')
		.map((value) => Number(value))
		.filter((id, index, ids) => Number.isInteger(id) && id > 0 && ids.indexOf(id) === index);
}

export function expandSelectedTableIds(selectedTableIds: number[], tableGroups: TableGroup[]) {
	if (selectedTableIds.length === 0) return [];

	const selectedIdSet = new Set(selectedTableIds);
	const expandedIds = tableGroups.flatMap((group) =>
		group.tableIds.some((tableId) => selectedIdSet.has(tableId)) ? group.tableIds : []
	);

	return [...new Set(expandedIds)];
}
