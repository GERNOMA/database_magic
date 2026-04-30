<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let selectedTableGroupIds = $state<string[]>([]);
	let tableSearchQuery = $state('');
	let selectedRestrictionTableId = $state('');
	let newRestrictionText = $state('');
	let tableRestrictions = $state<Record<string, string>>({});
	let hoveredTableGroup = $state<PageData['tableGroups'][number] | null>(null);
	let tableTooltipX = $state(0);
	let tableTooltipY = $state(0);

	const selectedUser = $derived(
		data.users.find((user) => user.id === data.selectedUserId) ?? data.users[0]
	);
	const selectedTableGroups = $derived(
		data.tableGroups.filter((group) => selectedTableGroupIds.includes(group.id))
	);
	const tableGroupsToAdd = $derived(
		data.tableGroups.filter((group) => !selectedTableGroupIds.includes(group.id))
	);
	const filteredTableGroupsToAdd = $derived(
		tableGroupsToAdd.filter((group) =>
			`${group.label} ${group.tableNames.join(' ')}`
				.toLowerCase()
				.includes(tableSearchQuery.trim().toLowerCase())
		)
	);
	const restrictionTableOptions = $derived(
		selectedTableGroups.flatMap((group) =>
			group.tableIds.map((tableId, index) => ({
				id: String(tableId),
				label:
					group.tableIds.length > 1 ? `${group.label} / ${group.tableNames[index]}` : group.label
			}))
		)
	);
	const restrictionLabelsById = $derived(
		Object.fromEntries(restrictionTableOptions.map((table) => [table.id, table.label]))
	);
	const savedRestrictionEntries = $derived(
		Object.entries(tableRestrictions)
			.map(([tableId, restriction]) => ({ tableId, restriction: restriction.trim() }))
			.filter(({ tableId, restriction }) => restriction && restrictionLabelsById[tableId])
			.sort((left, right) =>
				restrictionLabelsById[left.tableId].localeCompare(restrictionLabelsById[right.tableId])
			)
	);
	const availableRestrictionTableOptions = $derived(
		restrictionTableOptions.filter((table) => !tableRestrictions[table.id]?.trim())
	);
	const tableRestrictionsJson = $derived(
		JSON.stringify(
			Object.fromEntries(
				savedRestrictionEntries.map(({ tableId, restriction }) => [tableId, restriction])
			)
		)
	);

	$effect(() => {
		const selectedTableIdSet = new Set(data.selectedTableIds);
		selectedTableGroupIds = data.tableGroups
			.filter((group) => group.tableIds.some((tableId) => selectedTableIdSet.has(tableId)))
			.map((group) => group.id);
		tableRestrictions = Object.fromEntries(
			Object.entries(data.tableRestrictions ?? {}).map(([tableId, restriction]) => [
				tableId,
				String(restriction)
			])
		);
		selectedRestrictionTableId = '';
	});

	$effect(() => {
		const availableRestrictionTableIds = new Set(
			availableRestrictionTableOptions.map((table) => table.id)
		);
		if (selectedRestrictionTableId && availableRestrictionTableIds.has(selectedRestrictionTableId))
			return;

		selectedRestrictionTableId = availableRestrictionTableOptions[0]?.id ?? '';
	});

	function addTableGroupToContext(groupId: string) {
		if (selectedTableGroupIds.includes(groupId)) return;
		selectedTableGroupIds = [...selectedTableGroupIds, groupId];
	}

	function removeTableGroupFromContext(groupId: string) {
		const groupToRemove = selectedTableGroups.find((group) => group.id === groupId);
		selectedTableGroupIds = selectedTableGroupIds.filter(
			(selectedTableGroupId) => selectedTableGroupId !== groupId
		);
		if (!groupToRemove) return;

		const nextRestrictions = { ...tableRestrictions };
		for (const tableId of groupToRemove.tableIds) {
			delete nextRestrictions[String(tableId)];
		}
		tableRestrictions = nextRestrictions;
	}

	function showTableGroupTooltip(group: PageData['tableGroups'][number], event: MouseEvent) {
		hoveredTableGroup = group;
		moveTableGroupTooltip(event);
	}

	function moveTableGroupTooltip(event: MouseEvent) {
		tableTooltipX = event.clientX + 16;
		tableTooltipY = event.clientY + 16;
	}

	function hideTableGroupTooltip() {
		hoveredTableGroup = null;
	}

	function addRestriction() {
		const restriction = newRestrictionText.trim();
		if (!selectedRestrictionTableId || !restriction) return;

		tableRestrictions = { ...tableRestrictions, [selectedRestrictionTableId]: restriction };
		newRestrictionText = '';
	}

	function updateRestriction(tableId: string, value: string) {
		tableRestrictions = { ...tableRestrictions, [tableId]: value };
	}

	function deleteRestriction(tableId: string) {
		const nextRestrictions = { ...tableRestrictions };
		delete nextRestrictions[tableId];
		tableRestrictions = nextRestrictions;
	}

	type RouteHref = Parameters<typeof resolve>[0];
	const usersHref = (href: '/users' | `/users?${string}`) =>
		resolve(withCurrentQueryParams(page.url, href) as RouteHref);
	const usersAction = (actionName: string) => {
		return withCurrentQueryParams(page.url, `?/${actionName}`);
	};
</script>

<svelte:head>
	<title>Usuarios | {APP_NAME}</title>
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
		Permisos guardados.
	</div>
{/if}

<div class="grid gap-6 lg:grid-cols-[320px_1fr]">
	<aside class="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
		<form method="POST" action={usersAction('addUser')} class="space-y-3">
			<label class="text-sm font-medium text-stone-700" for="user-key">Agregar usuario</label>
			<div class="flex gap-2">
				<input
					id="user-key"
					name="userKey"
					placeholder="usuario"
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

		<div class="mt-5 space-y-2">
			{#each data.users as user (user.id)}
				<div
					class={`flex items-center gap-2 rounded-2xl border p-1 transition ${
						selectedUser?.id === user.id
							? 'border-stone-950 bg-stone-950'
							: 'border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-white'
					}`}
				>
					<a
						href={usersHref(`/users?account=${user.id}`)}
						class={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm ${
							selectedUser?.id === user.id ? 'text-white' : 'text-stone-700'
						}`}
					>
						{user.userKey}
					</a>
					<form method="POST" action={usersAction('deleteUser')}>
						<input type="hidden" name="userId" value={user.id} />
						<button
							class={`rounded-full border px-3 py-1 text-xs font-medium transition ${
								selectedUser?.id === user.id
									? 'border-white/25 text-white hover:bg-white/10'
									: 'border-red-200 text-red-600 hover:bg-red-50'
							}`}
						>
							Eliminar
						</button>
					</form>
				</div>
			{:else}
				<p class="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
					Agrega tu primer usuario para habilitar el acceso a Preguntar.
				</p>
			{/each}
		</div>
	</aside>

	<section class="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-7">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<p class="text-sm text-stone-500">Usuario seleccionado</p>
				<h1 class="mt-1 text-2xl font-semibold">
					{selectedUser?.userKey ?? 'No hay ningún usuario seleccionado'}
				</h1>
				<p class="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
					Elige las tablas que este usuario puede seleccionar y consultar en sus chats.
				</p>
			</div>
			{#if selectedUser}
				<form id="user-permissions-form" method="POST" action={usersAction('savePermissions')}>
					<input type="hidden" name="userId" value={selectedUser.id} />
					<input type="hidden" name="tableRestrictionsJson" value={tableRestrictionsJson} />
					{#each selectedTableGroups as group (group.id)}
						{#each group.tableIds as tableId (tableId)}
							<input type="hidden" name="tableIds" value={tableId} />
						{/each}
					{/each}
					<button
						class="rounded-2xl bg-stone-950 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
					>
						Guardar permisos
					</button>
				</form>
			{/if}
		</div>

		{#if selectedUser}
			<div class="mt-7 min-w-0 flex-1 text-xs text-stone-500">
				<p class="mb-2 font-medium text-stone-600">Tablas habilitadas</p>
				<div class="rounded-2xl border border-stone-200 bg-white p-3">
					<div class="flex min-h-10 flex-wrap gap-2">
						{#each selectedTableGroups as group (group.id)}
							<div
								class="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-950 py-1 pr-1 pl-3 text-xs font-medium text-white"
								role="group"
								aria-label={group.label}
								onmouseenter={(event) => showTableGroupTooltip(group, event)}
								onmousemove={moveTableGroupTooltip}
								onmouseleave={hideTableGroupTooltip}
							>
								<span>{group.label}</span>
								{#if group.tableIds.length > 1}
									<span class="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] text-stone-200">
										{group.tableIds.length} tablas
									</span>
								{/if}
								<button
									type="button"
									class="grid h-6 w-6 place-items-center rounded-full text-stone-200 transition hover:bg-white/10 hover:text-white"
									aria-label={`Quitar ${group.label}`}
									onclick={() => removeTableGroupFromContext(group.id)}
								>
									x
								</button>
							</div>
						{:else}
							<p class="py-2 text-sm text-stone-500">Este usuario no tiene tablas habilitadas.</p>
						{/each}
					</div>

					{#if tableGroupsToAdd.length > 0}
						<div class="mt-3 space-y-3 border-t border-stone-100 pt-3">
							<label class="relative block" for="user-table-search">
								<span class="sr-only">Buscar tablas para este usuario</span>
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
									id="user-table-search"
									type="search"
									bind:value={tableSearchQuery}
									placeholder="Buscar tabla..."
									class="w-full rounded-2xl border border-stone-200 bg-stone-50 py-2 pr-3 pl-9 text-sm text-stone-700 transition outline-none placeholder:text-stone-400 focus:border-stone-400 focus:bg-white"
								/>
							</label>
							<div class="max-h-72 overflow-y-auto pr-1">
								<div class="flex flex-wrap gap-2">
									{#each filteredTableGroupsToAdd as group (group.id)}
										<button
											type="button"
											class="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-white"
											onmouseenter={(event) => showTableGroupTooltip(group, event)}
											onmousemove={moveTableGroupTooltip}
											onmouseleave={hideTableGroupTooltip}
											onclick={() => addTableGroupToContext(group.id)}
										>
											+ {group.label}
											{#if group.tableIds.length > 1}
												<span class="text-stone-400">({group.tableIds.length})</span>
											{/if}
										</button>
									{:else}
										<p
											class="rounded-2xl border border-dashed border-stone-200 p-3 text-sm text-stone-500"
										>
											No encontramos tablas con ese nombre.
										</p>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>
				<p class="mt-1">
					{data.tableGroups.length === 0
						? 'Genera metadatos para habilitar tablas.'
						: 'Agrega una o más tablas para permitirlas.'}
				</p>

				<div class="mt-6 rounded-2xl border border-stone-200 bg-stone-50 p-4">
					<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<p class="font-medium text-stone-700">Restricciones por tabla</p>
							<p class="mt-1 max-w-2xl text-sm leading-6 text-stone-500">
								El texto se agrega como <span class="font-mono">restriction</span> al JSON de metadatos
								enviado para esa tabla y este usuario.
							</p>
						</div>
					</div>

					{#if restrictionTableOptions.length > 0}
						<div class="mt-4 space-y-3">
							{#each savedRestrictionEntries as entry (entry.tableId)}
								<div class="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
									<div class="flex items-start justify-between gap-3">
										<div class="min-w-0">
											<p class="text-xs font-semibold tracking-wide text-stone-400 uppercase">
												Tabla
											</p>
											<p class="mt-1 truncate text-sm font-semibold text-stone-800">
												{restrictionLabelsById[entry.tableId]}
											</p>
										</div>
										<button
											type="button"
											class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-100 bg-red-50 text-red-600 transition hover:border-red-200 hover:bg-red-100"
											aria-label={`Eliminar restricción de ${restrictionLabelsById[entry.tableId]}`}
											onclick={() => deleteRestriction(entry.tableId)}
										>
											<svg
												class="h-4 w-4"
												viewBox="0 0 20 20"
												fill="none"
												xmlns="http://www.w3.org/2000/svg"
												aria-hidden="true"
											>
												<path
													d="M4.5 6h11M8 6V4.5h4V6m-5.5 0 .5 9.5h6L13.5 6"
													stroke="currentColor"
													stroke-width="1.7"
													stroke-linecap="round"
													stroke-linejoin="round"
												/>
											</svg>
										</button>
									</div>
									<textarea
										rows="3"
										value={entry.restriction}
										placeholder="Ej: Only search for data that belongs to this user in this table and nothing else."
										class="mt-3 min-h-24 w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none placeholder:text-stone-400 focus:border-stone-500 focus:bg-white"
										aria-label={`Restricción de ${restrictionLabelsById[entry.tableId]}`}
										oninput={(event) => updateRestriction(entry.tableId, event.currentTarget.value)}
									></textarea>
								</div>
							{:else}
								<p
									class="rounded-2xl border border-dashed border-stone-200 bg-white p-3 text-sm text-stone-500"
								>
									Este usuario no tiene restricciones. Puedes dejarlo así o agregar una abajo.
								</p>
							{/each}
						</div>

						{#if availableRestrictionTableOptions.length > 0}
							<div class="mt-4 rounded-2xl border border-stone-200 bg-white p-3">
								<p class="text-sm font-medium text-stone-700">Agregar restricción</p>
								<div
									class="mt-3 grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_1fr_auto] lg:items-start"
								>
									<label class="grid gap-1" for="restriction-table">
										<span class="text-xs font-medium text-stone-600">Tabla</span>
										<select
											id="restriction-table"
											bind:value={selectedRestrictionTableId}
											class="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none focus:border-stone-500 focus:bg-white"
										>
											{#each availableRestrictionTableOptions as table (table.id)}
												<option value={table.id}>{table.label}</option>
											{/each}
										</select>
									</label>

									<label class="grid gap-1" for="table-restriction">
										<span class="text-xs font-medium text-stone-600">Restricción</span>
										<textarea
											id="table-restriction"
											rows="3"
											bind:value={newRestrictionText}
											placeholder="Ej: Only search for data that belongs to this user in this table and nothing else."
											class="min-h-24 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none placeholder:text-stone-400 focus:border-stone-500 focus:bg-white"
										></textarea>
									</label>

									<button
										type="button"
										class="inline-flex items-center justify-center gap-2 rounded-2xl bg-stone-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300 lg:mt-5"
										disabled={!selectedRestrictionTableId || !newRestrictionText.trim()}
										onclick={addRestriction}
									>
										<span
											class="grid h-5 w-5 place-items-center rounded-full bg-white/15 text-base leading-none"
											aria-hidden="true">+</span
										>
										Agregar
									</button>
								</div>
							</div>
						{:else}
							<p
								class="mt-4 rounded-2xl border border-stone-200 bg-white p-3 text-sm text-stone-500"
							>
								Todas las tablas habilitadas ya tienen restricción.
							</p>
						{/if}
					{:else}
						<p
							class="mt-4 rounded-2xl border border-dashed border-stone-200 bg-white p-3 text-sm text-stone-500"
						>
							Habilita una tabla para agregar una restricción.
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</section>
</div>

{#if hoveredTableGroup}
	<div
		class="pointer-events-none fixed z-50 max-w-xs rounded-2xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700 shadow-lg"
		style={`left: ${tableTooltipX}px; top: ${tableTooltipY}px;`}
		role="tooltip"
	>
		<p class="font-semibold text-stone-900">{hoveredTableGroup.label}</p>
		<p class="mt-1 text-[0.65rem] tracking-wide text-stone-400 uppercase">Tablas reales</p>
		<ul class="mt-1 max-h-48 space-y-1 overflow-auto">
			{#each hoveredTableGroup.tableNames as tableName (tableName)}
				<li class="font-mono text-[0.7rem] break-all">{tableName}</li>
			{/each}
		</ul>
	</div>
{/if}
