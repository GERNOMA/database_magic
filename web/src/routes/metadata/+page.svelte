<script lang="ts">
	import { page } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import type { ActionData, PageData } from './$types';

	type MetadataTable = PageData['tables'][number];
	type TableListSection =
		| { kind: 'shared'; name: string; tables: MetadataTable[] }
		| { kind: 'single'; table: MetadataTable };

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let tableSearchQuery = $state('');

	const tableMatchesSearch = (table: MetadataTable, query: string) =>
		`${table.name} ${table.userFriendlyName ?? ''}`.toLowerCase().includes(query);
	const getUserNameGroup = (table: MetadataTable) => table.userFriendlyName?.trim() ?? '';
	const getTableSortName = (table: MetadataTable) => getUserNameGroup(table) || table.name;

	const selectedTable = $derived(
		data.tables.find((table) => table.id === data.selectedTableId) ?? data.tables[0]
	);
	const metadataTableIds = $derived(new Set(data.metadataRows.map((metadata) => metadata.tableId)));
	const filteredTables = $derived(
		data.tables.filter((table) => tableMatchesSearch(table, tableSearchQuery.trim().toLowerCase()))
	);
	const tableListSections = $derived.by<TableListSection[]>(() => {
		const namedGroups = new Map<string, MetadataTable[]>();
		const unnamedTables: MetadataTable[] = [];

		for (const table of filteredTables) {
			const groupName = getUserNameGroup(table);
			if (!groupName) {
				unnamedTables.push(table);
				continue;
			}

			namedGroups.set(groupName, [...(namedGroups.get(groupName) ?? []), table]);
		}

		const sharedSections = Array.from(namedGroups.entries())
			.filter(([, tables]) => tables.length > 1)
			.sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
			.map(([name, tables]) => ({
				kind: 'shared' as const,
				name,
				tables: tables.toSorted((tableA, tableB) => tableA.name.localeCompare(tableB.name))
			}));
		const singleTables = [
			...Array.from(namedGroups.values())
				.filter((tables) => tables.length === 1)
				.flat(),
			...unnamedTables
		].toSorted((tableA, tableB) =>
			getTableSortName(tableA).localeCompare(getTableSortName(tableB))
		);

		return [
			...sharedSections,
			...singleTables
				.filter((table) => metadataTableIds.has(table.id))
				.map((table) => ({ kind: 'single' as const, table })),
			...singleTables
				.filter((table) => !metadataTableIds.has(table.id))
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

	const selectedTableParam = $derived(page.url.searchParams.get('table'));

	const metadataHref = (href: `/metadata?${string}`) => withCurrentQueryParams(page.url, href);
	const metadataAction = (actionName: string) => {
		return withCurrentQueryParams(page.url, `?/${actionName}`, { table: selectedTableParam });
	};
	const tableCardClass = (table: MetadataTable) => {
		if (selectedTable?.id === table.id) return 'border-stone-950 bg-stone-950';
		if (metadataTableIds.has(table.id))
			return 'border-sky-200 bg-sky-50/80 hover:border-sky-300 hover:bg-sky-100/70';
		return 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50';
	};
	const tableLinkClass = (table: MetadataTable) =>
		selectedTable?.id === table.id ? 'text-white' : 'text-stone-700';
	const deleteButtonClass = (table: MetadataTable) =>
		selectedTable?.id === table.id
			? 'border-white/25 text-white hover:bg-white/10'
			: 'border-red-200 text-red-600 hover:bg-red-50';
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
				{#each tableListSections as section (section.kind === 'shared' ? `group-${section.name}` : section.table.id)}
					{#if section.kind === 'shared'}
						<div class="-ml-2 rounded-3xl border border-stone-200 bg-stone-50/70 p-2">
							<p
								class="px-2 pb-2 text-[0.68rem] font-semibold tracking-wide text-stone-500 uppercase"
							>
								Nombre de usuario: {section.name}
							</p>
							<div class="flex flex-wrap gap-2">
								{#each section.tables as table (table.id)}
									<div
										class={`flex min-w-[8.5rem] flex-1 items-center gap-2 rounded-2xl border p-1 transition ${tableCardClass(table)}`}
									>
										<a
											href={metadataHref(`/metadata?table=${table.id}`)}
											class={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm ${tableLinkClass(table)}`}
										>
											{table.name}
										</a>
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
						<div
							class={`flex items-center gap-2 rounded-2xl border p-1 transition ${tableCardClass(table)}`}
						>
							<a
								href={metadataHref(`/metadata?table=${table.id}`)}
								class={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm ${tableLinkClass(table)}`}
							>
								{table.name}
							</a>
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
							<label class="text-xs font-medium text-stone-500" for="user-friendly-name">
								Nombre para usuario
							</label>
							<div class="flex flex-col gap-3 sm:flex-row">
								<input
									id="user-friendly-name"
									name="userFriendlyName"
									value={selectedTable.userFriendlyName ?? ''}
									placeholder={selectedTable.name}
									class="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-500"
								/>
								<button
									class="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium hover:bg-stone-50"
								>
									Guardar
								</button>
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
								<h2 class="truncate font-medium">{file.name}</h2>
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
				<pre
					class="mt-5 max-h-[420px] overflow-auto rounded-2xl bg-stone-950 p-4 text-xs leading-6 text-stone-100">{'{\n  "tableName": "",\n  "generalDescription": "",\n  "fields": []\n}'}</pre>
			{/if}
		</div>
	</section>
</div>
