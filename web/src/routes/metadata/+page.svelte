<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import { SvelteMap } from 'svelte/reactivity';
	import type { ActionData, PageData } from './$types';

	type MetadataTable = PageData['tables'][number];
	type TableListSection =
		| { kind: 'category'; name: string; tables: MetadataTable[] }
		| { kind: 'single'; table: MetadataTable };
	type FilterTestResult = {
		tableId: number;
		tableName: string;
		rowCount: number;
		limit: number;
		hasLessThanLimit: boolean;
		error?: string;
	};

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let tableSearchQuery = $state('');
	let categorySearchQuery = $state('');
	let selectedCategoryNames = $state<string[]>([]);
	let showNewCategoryDialog = $state(false);
	let newCategoryName = $state('');
	let previewFileId = $state<number | null>(null);
	let isFilteringTestTables = $state(false);
	let filterTestCurrent = $state(0);
	let filterTestTotal = $state(0);
	let hasLiveFilterTestResults = $state(false);
	let liveFilterTestResults = $state<FilterTestResult[]>([]);
	let filterTestError = $state('');

	function storedFilterTestResults(tables: MetadataTable[]): FilterTestResult[] {
		return tables.flatMap((table) => {
			if (typeof table.filterTestRowCount !== 'number') return [];

			return [
				{
					tableId: table.id,
					tableName: table.name,
					rowCount: table.filterTestRowCount,
					limit: table.filterTestLimit ?? 100,
					hasLessThanLimit: table.filterTestHasLessThanLimit === 1
				}
			];
		});
	}
	const tableMatchesSearch = (table: MetadataTable, query: string) =>
		`${table.name} ${getTableCategories(table).join(' ')}`.toLowerCase().includes(query);
	const getTableCategories = (table: MetadataTable) => {
		const value = table.userFriendlyName?.trim();
		if (!value) return [];

		try {
			const parsed = JSON.parse(value) as unknown;
			if (!Array.isArray(parsed)) return [value];

			return parsed
				.filter((category): category is string => typeof category === 'string')
				.map((category) => category.trim())
				.filter(
					(category, index, categories) => category && categories.indexOf(category) === index
				);
		} catch {
			return [value];
		}
	};
	const getTableSortName = (table: MetadataTable) => getTableCategories(table)[0] || table.name;

	const selectedTable = $derived(
		data.tables.find((table) => table.id === data.selectedTableId) ?? data.tables[0]
	);
	const allCategoryNames = $derived(
		[...new Set([...data.tables.flatMap(getTableCategories), ...selectedCategoryNames])].sort(
			(left, right) => left.localeCompare(right)
		)
	);
	const categoryNamesToAdd = $derived(
		allCategoryNames.filter((category) => !selectedCategoryNames.includes(category))
	);
	const filteredCategoryNamesToAdd = $derived(
		categoryNamesToAdd.filter((category) =>
			category.toLowerCase().includes(categorySearchQuery.trim().toLowerCase())
		)
	);
	const metadataTableIds = $derived(new Set(data.metadataRows.map((metadata) => metadata.tableId)));
	const filteredTables = $derived(
		data.tables.filter((table) => tableMatchesSearch(table, tableSearchQuery.trim().toLowerCase()))
	);
	const filterTestResults = $derived(
		hasLiveFilterTestResults ? liveFilterTestResults : storedFilterTestResults(data.tables)
	);
	const filterTestResultByTableId = $derived(
		new Map(filterTestResults.map((result) => [result.tableId, result]))
	);
	const shouldMoveTableToFilterBottom = (table: MetadataTable) =>
		filterTestResultByTableId.get(table.id)?.hasLessThanLimit === true &&
		!metadataTableIds.has(table.id) &&
		getTableCategories(table).length === 0;
	const lowFilterTestTables = $derived(
		filterTestResults.filter((result) => {
			const table = data.tables.find((currentTable) => currentTable.id === result.tableId);
			return table ? shouldMoveTableToFilterBottom(table) : false;
		})
	);
	const tableListSections = $derived.by<TableListSection[]>(() => {
		const namedGroups = new SvelteMap<string, MetadataTable[]>();
		const unnamedTables: MetadataTable[] = [];

		for (const table of filteredTables) {
			const categories = getTableCategories(table);
			if (categories.length === 0) {
				unnamedTables.push(table);
				continue;
			}

			for (const category of categories) {
				namedGroups.set(category, [...(namedGroups.get(category) ?? []), table]);
			}
		}

		const categorySections = Array.from(namedGroups.entries())
			.sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
			.map(([name, tables]) => ({
				kind: 'category' as const,
				name,
				tables: tables.toSorted((tableA, tableB) => tableA.name.localeCompare(tableB.name))
			}));
		const singleTables = unnamedTables.toSorted((tableA, tableB) =>
			getTableSortName(tableA).localeCompare(getTableSortName(tableB))
		);

		return [
			...categorySections,
			...singleTables
				.filter((table) => metadataTableIds.has(table.id))
				.map((table) => ({ kind: 'single' as const, table })),
			...singleTables
				.filter((table) => !metadataTableIds.has(table.id) && !shouldMoveTableToFilterBottom(table))
				.map((table) => ({ kind: 'single' as const, table })),
			...singleTables
				.filter((table) => shouldMoveTableToFilterBottom(table))
				.map((table) => ({ kind: 'single' as const, table }))
		];
	});
	const selectedFiles = $derived(
		selectedTable ? data.files.filter((file) => file.tableId === selectedTable.id) : []
	);
	const hasAutomaticFile = $derived(
		selectedTable
			? selectedFiles.some((file) => file.name === `${selectedTable.name}_automatic.json`)
			: false
	);
	const selectedMetadata = $derived(
		selectedTable
			? data.metadataRows.find((metadata) => metadata.tableId === selectedTable.id)
			: undefined
	);
	const previewFile = $derived(selectedFiles.find((file) => file.id === previewFileId));

	const selectedTableParam = $derived(page.url.searchParams.get('table'));

	const metadataHref = (href: `/metadata?${string}`) => withCurrentQueryParams(page.url, href);
	const metadataAction = (actionName: string) => {
		return withCurrentQueryParams(page.url, `?/${actionName}`, { table: selectedTableParam });
	};
	const fileDownloadHref = (file: PageData['files'][number]) => {
		const mimeType = file.mimeType || 'text/plain';
		return `data:${mimeType};charset=utf-8,${encodeURIComponent(file.content)}`;
	};
	const filePreviewContent = (file: PageData['files'][number]) => {
		if (!file.mimeType.includes('json') && !file.name.toLowerCase().endsWith('.json')) {
			return file.content;
		}

		try {
			return JSON.stringify(JSON.parse(file.content), null, 2);
		} catch {
			return file.content;
		}
	};
	const tableCardClass = (table: MetadataTable) => {
		if (metadataTableIds.has(table.id)) {
			if (selectedTable?.id === table.id) return 'border-stone-950 bg-stone-950';
			return 'border-sky-200 bg-sky-50/80 hover:border-sky-300 hover:bg-sky-100/70';
		}
		if (shouldMoveTableToFilterBottom(table)) {
			if (selectedTable?.id === table.id) return 'border-orange-500 bg-orange-500';
			return 'border-orange-300 bg-orange-50 hover:border-orange-400 hover:bg-orange-100';
		}
		if (selectedTable?.id === table.id) return 'border-stone-950 bg-stone-950';
		return 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50';
	};
	const tableLinkClass = (table: MetadataTable) => {
		if (selectedTable?.id === table.id) return 'text-white';
		if (shouldMoveTableToFilterBottom(table)) return 'text-orange-800';
		return 'text-stone-700';
	};
	const filterResultBadgeClass = (table: MetadataTable, result: FilterTestResult) => {
		if (result.error) return 'bg-red-50 text-red-700';
		if (metadataTableIds.has(table.id)) return 'bg-sky-100 text-sky-700';
		if (result.hasLessThanLimit) return 'bg-orange-100 text-orange-800';
		return 'bg-emerald-50 text-emerald-700';
	};
	const deleteButtonClass = (table: MetadataTable) =>
		selectedTable?.id === table.id
			? 'border-white/25 text-white hover:bg-white/10'
			: 'border-red-200 text-red-600 hover:bg-red-50';

	$effect(() => {
		selectedCategoryNames = selectedTable ? getTableCategories(selectedTable) : [];
		categorySearchQuery = '';
		showNewCategoryDialog = false;
		newCategoryName = '';
		previewFileId = null;
	});

	function addCategory(category: string) {
		const cleanCategory = category.trim();
		if (!cleanCategory || selectedCategoryNames.includes(cleanCategory)) return;

		selectedCategoryNames = [...selectedCategoryNames, cleanCategory];
		categorySearchQuery = '';
	}

	function removeCategory(category: string) {
		selectedCategoryNames = selectedCategoryNames.filter(
			(selectedCategory) => selectedCategory !== category
		);
	}

	function openNewCategoryDialog() {
		newCategoryName = categorySearchQuery.trim();
		showNewCategoryDialog = true;
	}

	function closeNewCategoryDialog() {
		showNewCategoryDialog = false;
		newCategoryName = '';
	}

	function createCategory() {
		const category = newCategoryName.trim();
		if (!category) return;

		addCategory(category);
		closeNewCategoryDialog();
	}

	async function readFilterTestPayload(response: Response) {
		const text = await response.text();
		const contentType = response.headers.get('content-type') ?? '';

		if (!contentType.includes('application/json')) {
			throw new Error(
				response.ok
					? 'La respuesta de filtrar pruebas no vino en formato JSON.'
					: `No se pudo filtrar pruebas (${response.status}). Revisa la consola del servidor.`
			);
		}

		return JSON.parse(text) as Partial<FilterTestResult> & { error?: string };
	}

	async function runFilterTests() {
		if (isFilteringTestTables || data.tables.length === 0) return;

		const total = data.tables.length;
		let results: FilterTestResult[] = [];

		isFilteringTestTables = true;
		hasLiveFilterTestResults = true;
		filterTestCurrent = 0;
		filterTestTotal = total;
		liveFilterTestResults = [];
		filterTestError = '';

		for (const [index, table] of data.tables.entries()) {
			const current = index + 1;
			filterTestCurrent = current;
			console.info(`Filtrar pruebas ${current}/${total}: ${table.name}`);

			try {
				const response = await fetch(
					`${base}${withCurrentQueryParams(page.url, '/metadata/filter-tests')}`,
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ tableId: table.id, index: current, total })
					}
				);
				const payload = await readFilterTestPayload(response);
				const result: FilterTestResult = {
					tableId: table.id,
					tableName: table.name,
					rowCount: typeof payload.rowCount === 'number' ? payload.rowCount : 0,
					limit: typeof payload.limit === 'number' ? payload.limit : 100,
					hasLessThanLimit: response.ok && payload.hasLessThanLimit === true,
					error:
						typeof payload.error === 'string'
							? payload.error
							: response.ok
								? undefined
								: 'No se pudo probar la tabla.'
				};

				if (!response.ok) filterTestError = result.error ?? 'No se pudo probar una tabla.';
				results = [...results, result];
				liveFilterTestResults = results;
			} catch (error) {
				const message = error instanceof Error ? error.message : 'No se pudo probar una tabla.';
				filterTestError = message;
				results = [
					...results,
					{
						tableId: table.id,
						tableName: table.name,
						rowCount: 0,
						limit: 100,
						hasLessThanLimit: false,
						error: message
					}
				];
				liveFilterTestResults = results;
			}
		}

		isFilteringTestTables = false;
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<svelte:head>
	<title>Metadatos | {APP_NAME}</title>
</svelte:head>

{#if form?.error}
	<div class="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
		{form.error}
	</div>
{/if}

{#if data.saved}
	<div
		class="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
	>
		Metadatos guardados.
	</div>
{/if}

<div class="grid gap-6 lg:grid-cols-[320px_1fr]">
	<aside class="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
		<form method="POST" action={metadataAction('addTable')} class="space-y-3">
			<label class="text-sm font-medium text-stone-700" for="table-name">Agregar tabla</label>
			<div class="flex gap-2">
				<input
					id="table-name"
					name="name"
					placeholder="clientes"
					class="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500"
				/>
				<button
					class="inline-flex items-center gap-2 rounded-2xl bg-stone-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
				>
					<span aria-hidden="true">+</span>
					Agregar
				</button>
			</div>
		</form>

		<form method="POST" action={metadataAction('autoImportTables')} class="mt-4">
			<button
				class="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:bg-white"
			>
				Importar automáticamente
			</button>
		</form>

		<div class="mt-3 space-y-2">
			<button
				type="button"
				class="w-full rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-800 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
				disabled={isFilteringTestTables || data.tables.length === 0}
				onclick={runFilterTests}
			>
				Filtrar pruebas
			</button>
			{#if isFilteringTestTables || filterTestResults.length > 0 || filterTestError}
				<div
					class="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600"
				>
					<p class="font-medium text-stone-800">
						{isFilteringTestTables
							? `Filtrar pruebas ${filterTestCurrent}/${filterTestTotal}`
							: `Filtrar pruebas listo (${filterTestResults.length}/${filterTestTotal || data.tables.length})`}
					</p>
					{#if filterTestError}
						<p class="mt-1 text-red-600">{filterTestError}</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="mt-5 space-y-3">
			{#if data.tables.length > 0}
				<label class="relative block" for="metadata-table-search">
					<span class="sr-only">Buscar tablas</span>
					<span
						class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400"
						aria-hidden="true"
					>
						<svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path
								d="M9 15.5A6.5 6.5 0 1 0 9 2.5a6.5 6.5 0 0 0 0 13ZM14 14l3.5 3.5"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
							/>
						</svg>
					</span>
					<input
						id="metadata-table-search"
						type="search"
						bind:value={tableSearchQuery}
						placeholder="Buscar tabla..."
						class="w-full rounded-2xl border border-stone-200 bg-stone-50 py-2 pr-3 pl-9 text-sm text-stone-700 transition outline-none placeholder:text-stone-400 focus:border-stone-400 focus:bg-white"
					/>
				</label>
			{/if}
			<div class="max-h-96 space-y-2 overflow-y-auto pr-1">
				{#each tableListSections as section (section.kind === 'category' ? `group-${section.name}` : section.table.id)}
					{#if section.kind === 'category'}
						<div class="-ml-2 rounded-3xl border border-stone-200 bg-stone-50/70 p-2">
							<p
								class="px-2 pb-2 text-[0.68rem] font-semibold tracking-wide text-stone-500 uppercase"
							>
								Categoría: {section.name}
							</p>
							<div class="flex flex-wrap gap-2">
								{#each section.tables as table (table.id)}
									{@const filterResult = filterTestResultByTableId.get(table.id)}
									<div
										class={`flex min-w-34 flex-1 items-center gap-2 rounded-2xl border p-1 transition ${tableCardClass(table)}`}
									>
										<a
											href={metadataHref(`/metadata?table=${table.id}`)}
											class={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm ${tableLinkClass(table)}`}
										>
											{table.name}
										</a>
										{#if filterResult}
											<span
												class={`shrink-0 rounded-full px-2 py-1 text-[0.68rem] font-semibold ${filterResultBadgeClass(table, filterResult)}`}
											>
												{filterResult.error
													? 'Error'
													: `${filterResult.rowCount}/${filterResult.limit}`}
											</span>
										{/if}
										<form method="POST" action={metadataAction('deleteTable')}>
											<input type="hidden" name="tableId" value={table.id} />
											<button
												class={`rounded-full border px-3 py-1 text-xs font-medium transition ${deleteButtonClass(table)}`}
											>
												Eliminar
											</button>
										</form>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						{@const table = section.table}
						{@const filterResult = filterTestResultByTableId.get(table.id)}
						<div
							class={`flex items-center gap-2 rounded-2xl border p-1 transition ${tableCardClass(table)}`}
						>
							<a
								href={metadataHref(`/metadata?table=${table.id}`)}
								class={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm ${tableLinkClass(table)}`}
							>
								{table.name}
							</a>
							{#if filterResult}
								<span
									class={`shrink-0 rounded-full px-2 py-1 text-[0.68rem] font-semibold ${filterResultBadgeClass(table, filterResult)}`}
								>
									{filterResult.error ? 'Error' : `${filterResult.rowCount}/${filterResult.limit}`}
								</span>
							{/if}
							<form method="POST" action={metadataAction('deleteTable')}>
								<input type="hidden" name="tableId" value={table.id} />
								<button
									class={`rounded-full border px-3 py-1 text-xs font-medium transition ${deleteButtonClass(table)}`}
								>
									Eliminar
								</button>
							</form>
						</div>
					{/if}
				{:else}
					<p class="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
						{data.tables.length === 0
							? 'Agrega tu primera tabla para empezar a recopilar contexto.'
							: 'No encontramos tablas con ese nombre.'}
					</p>
				{/each}
			</div>
		</div>
	</aside>

	<section class="space-y-6">
		<div class="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-7">
			<div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<p class="text-sm text-stone-500">Tabla seleccionada</p>
					<h1 class="mt-1 text-2xl font-semibold">
						{selectedTable?.name ?? 'No hay ninguna tabla seleccionada'}
					</h1>
				</div>

				{#if selectedTable}
					<div class="flex w-full flex-col gap-4 lg:w-lg lg:shrink-0">
						<form
							method="POST"
							action={metadataAction('saveTableUserName')}
							class="flex w-full flex-col gap-2"
						>
							<input type="hidden" name="tableId" value={selectedTable.id} />
							<label class="text-xs font-medium text-stone-500" for="table-category-search">
								Categoría
							</label>
							{#each selectedCategoryNames as category (category)}
								<input type="hidden" name="categories" value={category} />
							{/each}
							<div class="rounded-2xl border border-stone-200 bg-white p-3">
								<div class="flex min-h-10 items-start gap-3">
									<div class="flex flex-1 flex-wrap gap-2">
										{#each selectedCategoryNames as category (category)}
											<div
												class="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-950 py-1 pr-1 pl-3 text-xs font-medium text-white"
												role="group"
												aria-label={category}
											>
												<span>{category}</span>
												<button
													type="button"
													class="grid h-6 w-6 place-items-center rounded-full text-stone-200 transition hover:bg-white/10 hover:text-white"
													aria-label={`Quitar ${category}`}
													onclick={() => removeCategory(category)}
												>
													x
												</button>
											</div>
										{:else}
											<p class="py-2 text-sm text-stone-500">Esta tabla no tiene categoría.</p>
										{/each}
									</div>
									<button
										class="shrink-0 rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium hover:bg-stone-50"
									>
										Guardar
									</button>
								</div>

								<div class="mt-3 space-y-3 border-t border-stone-100 pt-3">
									<div class="flex gap-2">
										<label class="relative min-w-0 flex-1" for="table-category-search">
											<span class="sr-only">Buscar categoría</span>
											<span
												class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400"
												aria-hidden="true"
											>
												<svg
													class="h-4 w-4"
													viewBox="0 0 20 20"
													fill="none"
													xmlns="http://www.w3.org/2000/svg"
												>
													<path
														d="M9 15.5A6.5 6.5 0 1 0 9 2.5a6.5 6.5 0 0 0 0 13ZM14 14l3.5 3.5"
														stroke="currentColor"
														stroke-width="1.8"
														stroke-linecap="round"
													/>
												</svg>
											</span>
											<input
												id="table-category-search"
												type="search"
												bind:value={categorySearchQuery}
												placeholder="Buscar categoría..."
												class="w-full rounded-2xl border border-stone-200 bg-stone-50 py-2 pr-3 pl-9 text-sm text-stone-700 transition outline-none placeholder:text-stone-400 focus:border-stone-400 focus:bg-white"
											/>
										</label>
										<button
											type="button"
											class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-stone-950 text-white transition hover:bg-stone-800"
											aria-label="Crear categoría"
											onclick={openNewCategoryDialog}
										>
											<span aria-hidden="true">+</span>
										</button>
									</div>
									<div class="max-h-28 overflow-y-auto pr-1">
										<div class="flex flex-wrap gap-2">
											{#each filteredCategoryNamesToAdd as category (category)}
												<button
													type="button"
													class="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-white"
													onclick={() => addCategory(category)}
												>
													+ {category}
												</button>
											{:else}
												<p
													class="rounded-2xl border border-dashed border-stone-200 p-3 text-sm text-stone-500"
												>
													No encontramos categorías con ese nombre.
												</p>
											{/each}
										</div>
									</div>
								</div>
							</div>
						</form>
						<div class="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap">
							{#if !hasAutomaticFile}
								<form method="POST" action={metadataAction('addAutomaticFile')} class="sm:shrink-0">
									<input type="hidden" name="tableId" value={selectedTable.id} />
									<button
										class="w-full rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium hover:bg-stone-50 sm:w-auto"
									>
										Archivo automático
									</button>
								</form>
							{/if}
							<form
								method="POST"
								action={metadataAction('addFile')}
								enctype="multipart/form-data"
								class="flex w-full min-w-0 flex-col gap-3 sm:flex-1 sm:flex-row"
							>
								<input type="hidden" name="tableId" value={selectedTable.id} />
								<input
									name="file"
									type="file"
									class="min-w-0 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-stone-950 file:px-3 file:py-1.5 file:text-sm file:text-white sm:flex-1"
								/>
								<button
									class="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium hover:bg-stone-50"
								>
									+ Agregar archivo
								</button>
							</form>
						</div>
					</div>
				{/if}
			</div>

			<div class="mt-7 grid gap-4 md:grid-cols-2">
				{#each selectedFiles as file (file.id)}
					<article class="rounded-2xl border border-stone-200 bg-stone-50 p-5">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="flex min-w-0 items-center gap-2">
									<h2 class="min-w-0 flex-1 truncate font-medium">{file.name}</h2>
									<a
										href={fileDownloadHref(file)}
										download={file.name}
										class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-100"
										aria-label={`Descargar ${file.name}`}
										title="Descargar"
									>
										<svg
											class="h-4 w-4"
											viewBox="0 0 20 20"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
											aria-hidden="true"
										>
											<path
												d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 16.5h12"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
												stroke-linejoin="round"
											/>
										</svg>
									</a>
									<button
										type="button"
										class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-100"
										aria-label={`Ver ${file.name}`}
										title="Ver archivo"
										onclick={() => (previewFileId = file.id)}
									>
										<svg
											class="h-4 w-4"
											viewBox="0 0 20 20"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
											aria-hidden="true"
										>
											<path
												d="M2.5 10s2.75-5 7.5-5 7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5Z"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linejoin="round"
											/>
											<path
												d="M10 12.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"
												stroke="currentColor"
												stroke-width="1.8"
											/>
										</svg>
									</button>
								</div>
								<p class="mt-1 text-xs text-stone-500">{file.mimeType}</p>
							</div>
							<form method="POST" action={metadataAction('deleteFile')}>
								<input type="hidden" name="fileId" value={file.id} />
								<input type="hidden" name="tableId" value={file.tableId} />
								<button
									class="rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
								>
									Eliminar
								</button>
							</form>
						</div>
						<p class="mt-3 line-clamp-3 text-sm text-stone-600">{file.content}</p>
					</article>
				{:else}
					<p
						class="rounded-2xl border border-dashed border-stone-200 p-5 text-sm text-stone-500 md:col-span-2"
					>
						Los archivos que agregues para esta tabla aparecerán aquí.
					</p>
				{/each}
			</div>
		</div>

		<div class="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 class="text-lg font-semibold">Metadatos generados</h2>
					<p class="text-sm text-stone-500">
						{selectedMetadata?.fileName ??
							'Ejecuta el análisis para crear un archivo JSON de metadatos.'}
					</p>
				</div>
				{#if selectedTable}
					<form method="POST" action={metadataAction('analyzeTable')}>
						<input type="hidden" name="tableId" value={selectedTable.id} />
						<button
							class="rounded-2xl bg-stone-950 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
						>
							Analizar archivos
						</button>
					</form>
				{/if}
			</div>

			{#if selectedMetadata && selectedTable}
				<form method="POST" action={metadataAction('saveMetadata')} class="mt-5 space-y-3">
					<input type="hidden" name="tableId" value={selectedTable.id} />
					<textarea
						name="json"
						rows="18"
						spellcheck="false"
						class="max-h-[420px] w-full resize-y overflow-auto rounded-2xl border-0 bg-stone-950 p-4 font-mono text-xs leading-6 text-stone-100 ring-1 ring-transparent outline-none focus:ring-stone-500"
						value={selectedMetadata.json}
					></textarea>
					<div class="flex justify-end">
						<button
							class="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium hover:bg-stone-50"
						>
							Guardar metadatos
						</button>
					</div>
				</form>
			{:else}
				<div
					class="mt-5 rounded-2xl border border-dashed border-stone-200 p-5 text-sm text-stone-500"
				>
					No hay metadatos para esta tabla.
				</div>
			{/if}
		</div>
	</section>
</div>

{#if previewFile}
	<div class="fixed inset-0 z-50 grid place-items-center bg-stone-950/45 p-4">
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			aria-label="Cerrar vista previa"
			onclick={() => (previewFileId = null)}
		></button>
		<div
			class="relative flex max-h-[88vh] w-full max-w-5xl flex-col rounded-3xl border border-stone-200 bg-white shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="file-preview-title"
			tabindex="-1"
		>
			<div class="flex items-start justify-between gap-4 border-b border-stone-100 p-5">
				<div class="min-w-0">
					<h2 id="file-preview-title" class="truncate text-lg font-semibold text-stone-950">
						{previewFile.name}
					</h2>
					<p class="mt-1 text-sm text-stone-500">{previewFile.mimeType}</p>
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<a
						href={fileDownloadHref(previewFile)}
						download={previewFile.name}
						class="grid h-9 w-9 place-items-center rounded-full border border-stone-200 text-stone-700 transition hover:bg-stone-50"
						aria-label={`Descargar ${previewFile.name}`}
						title="Descargar"
					>
						<svg
							class="h-4 w-4"
							viewBox="0 0 20 20"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
							aria-hidden="true"
						>
							<path
								d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 16.5h12"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</a>
					<button
						type="button"
						class="grid h-9 w-9 place-items-center rounded-full border border-stone-200 text-stone-700 transition hover:bg-stone-50"
						aria-label="Cerrar vista previa"
						onclick={() => (previewFileId = null)}
					>
						x
					</button>
				</div>
			</div>
			<div class="min-h-0 flex-1 overflow-auto bg-stone-950 p-5">
				<pre
					class="font-mono text-sm leading-6 wrap-break-word whitespace-pre-wrap text-stone-100">{filePreviewContent(
						previewFile
					)}</pre>
			</div>
		</div>
	</div>
{/if}

{#if showNewCategoryDialog}
	<div class="fixed inset-0 z-50 grid place-items-center bg-stone-950/35 p-4">
		<div class="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-5 shadow-xl">
			<div class="flex items-start justify-between gap-3">
				<div>
					<p class="text-sm font-semibold text-stone-900">Nueva categoría</p>
					<p class="mt-1 text-sm text-stone-500">Nombra la categoría para esta tabla.</p>
				</div>
				<button
					type="button"
					class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"
					aria-label="Cerrar"
					onclick={closeNewCategoryDialog}
				>
					x
				</button>
			</div>

			<label class="mt-4 grid gap-1" for="new-category-name">
				<span class="text-xs font-medium text-stone-600">Categoría</span>
				<input
					id="new-category-name"
					bind:value={newCategoryName}
					placeholder="Ventas"
					class="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none placeholder:text-stone-400 focus:border-stone-500 focus:bg-white"
					onkeydown={(event) => {
						if (event.key === 'Enter') createCategory();
						if (event.key === 'Escape') closeNewCategoryDialog();
					}}
				/>
			</label>

			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					class="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
					onclick={closeNewCategoryDialog}
				>
					Cancelar
				</button>
				<button
					type="button"
					class="rounded-2xl bg-stone-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
					disabled={!newCategoryName.trim()}
					onclick={createCategory}
				>
					Agregar
				</button>
			</div>
		</div>
	</div>
{/if}
