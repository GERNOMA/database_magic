<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const selectedTable = $derived(
		data.tables.find((table) => table.id === data.selectedTableId) ?? data.tables[0]
	);
	const selectedFiles = $derived(
		selectedTable ? data.files.filter((file) => file.tableId === selectedTable.id) : []
	);
	const selectedMetadata = $derived(
		selectedTable
			? data.metadataRows.find((metadata) => metadata.tableId === selectedTable.id)
			: undefined
	);
</script>

<svelte:head>
	<title>Metadata | Database Magic</title>
</svelte:head>

{#if form?.error}
	<div class="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
		{form.error}
	</div>
{/if}

{#if data.saved}
	<div class="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
		Metadata saved.
	</div>
{/if}

<div class="grid gap-6 lg:grid-cols-[320px_1fr]">
	<aside class="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
		<form method="POST" action="?/addTable" class="space-y-3">
			<label class="text-sm font-medium text-stone-700" for="table-name">Add table</label>
			<div class="flex gap-2">
				<input
					id="table-name"
					name="name"
					placeholder="customers"
					class="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500"
				/>
				<button
					class="inline-flex items-center gap-2 rounded-2xl bg-stone-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
				>
					<span aria-hidden="true">+</span>
					Add
				</button>
			</div>
		</form>

		<div class="mt-5 space-y-2">
			{#each data.tables as table (table.id)}
				<div
					class={`flex items-center gap-2 rounded-2xl border p-1 transition ${
						selectedTable?.id === table.id
							? 'border-stone-950 bg-stone-950'
							: 'border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-white'
					}`}
				>
					<a
						href={resolve(`/metadata?table=${table.id}`)}
						class={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm ${
							selectedTable?.id === table.id ? 'text-white' : 'text-stone-700'
						}`}
					>
						{table.name}
					</a>
					<form method="POST" action="?/deleteTable">
						<input type="hidden" name="tableId" value={table.id} />
						<button
							class={`rounded-full border px-3 py-1 text-xs font-medium transition ${
								selectedTable?.id === table.id
									? 'border-white/25 text-white hover:bg-white/10'
									: 'border-red-200 text-red-600 hover:bg-red-50'
							}`}
						>
							Delete
						</button>
					</form>
				</div>
			{:else}
				<p class="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
					Add your first table to start collecting context.
				</p>
			{/each}
		</div>
	</aside>

	<section class="space-y-6">
		<div class="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p class="text-sm text-stone-500">Selected table</p>
					<h1 class="mt-1 text-2xl font-semibold">{selectedTable?.name ?? 'No table selected'}</h1>
				</div>

				{#if selectedTable}
					<form
						method="POST"
						action="?/addFile"
						enctype="multipart/form-data"
						class="flex flex-col gap-2 sm:flex-row"
					>
						<input type="hidden" name="tableId" value={selectedTable.id} />
						<input
							name="file"
							type="file"
							class="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-stone-950 file:px-3 file:py-1.5 file:text-sm file:text-white"
						/>
						<button
							class="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium hover:bg-stone-50"
						>
							+ Add file
						</button>
					</form>
				{/if}
			</div>

			<div class="mt-5 grid gap-3 md:grid-cols-2">
				{#each selectedFiles as file (file.id)}
					<article class="rounded-2xl border border-stone-200 bg-stone-50 p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<h2 class="truncate font-medium">{file.name}</h2>
								<p class="mt-1 text-xs text-stone-500">{file.mimeType}</p>
							</div>
							<form method="POST" action="?/deleteFile">
								<input type="hidden" name="fileId" value={file.id} />
								<input type="hidden" name="tableId" value={file.tableId} />
								<button
									class="rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
								>
									Delete
								</button>
							</form>
						</div>
						<p class="mt-3 line-clamp-3 text-sm text-stone-600">{file.content}</p>
					</article>
				{:else}
					<p
						class="rounded-2xl border border-dashed border-stone-200 p-5 text-sm text-stone-500 md:col-span-2"
					>
						Files you add for this table will appear here.
					</p>
				{/each}
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-[1fr_260px]">
			<div class="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h2 class="text-lg font-semibold">Generated metadata</h2>
						<p class="text-sm text-stone-500">
							{selectedMetadata?.fileName ?? 'Run analysis to create a metadata JSON file.'}
						</p>
					</div>
					{#if selectedTable}
						<form method="POST" action="?/analyzeTable">
							<input type="hidden" name="tableId" value={selectedTable.id} />
							<button
								class="rounded-2xl bg-stone-950 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
							>
								Analyze files
							</button>
						</form>
					{/if}
				</div>

				{#if selectedMetadata && selectedTable}
					<form method="POST" action="?/saveMetadata" class="mt-5 space-y-3">
						<input type="hidden" name="tableId" value={selectedTable.id} />
						<textarea
							name="json"
							rows="18"
							spellcheck="false"
							class="max-h-[420px] w-full resize-y overflow-auto rounded-2xl border-0 bg-stone-950 p-4 font-mono text-xs leading-6 text-stone-100 outline-none ring-1 ring-transparent focus:ring-stone-500"
							value={selectedMetadata.json}
						></textarea>
						<div class="flex justify-end">
							<button
								class="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium hover:bg-stone-50"
							>
								Save metadata
							</button>
						</div>
					</form>
				{:else}
					<pre
						class="mt-5 max-h-[420px] overflow-auto rounded-2xl bg-stone-950 p-4 text-xs leading-6 text-stone-100">{'{\n  "tableName": "",\n  "generalDescription": "",\n  "fields": []\n}'}</pre>
				{/if}
			</div>

			<div class="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
				<h2 class="text-lg font-semibold">Compile</h2>
				<p class="mt-2 text-sm text-stone-500">
					Build a master JSON from every table that already has metadata.
				</p>
				<form method="POST" action="?/compileAll" class="mt-5">
					<button
						class="w-full rounded-2xl bg-stone-950 px-4 py-3 text-sm font-medium text-white hover:bg-stone-800"
					>
						Compile all
					</button>
				</form>
				{#if data.compiled}
					<p class="mt-4 text-xs text-stone-500">
						Latest: <span class="font-medium text-stone-700">{data.compiled.fileName}</span>
					</p>
				{/if}
			</div>
		</div>
	</section>
</div>
