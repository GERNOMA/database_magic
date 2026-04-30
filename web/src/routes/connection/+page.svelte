<script lang="ts">
	import { APP_NAME } from '$lib/app';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Conexión | {APP_NAME}</title>
</svelte:head>

<section class="mx-auto max-w-2xl rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
	<h1 class="text-2xl font-semibold">Conexión</h1>
	<p class="mt-2 text-sm text-stone-500">
		Conéctate a una base de datos que el servidor pueda alcanzar. Usa un usuario de solo lectura
		siempre que sea posible.
	</p>

	{#if form?.error}
		<div class="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<form method="POST" action="?/saveConnection" class="mt-6 space-y-4">
		<label class="block text-sm font-medium text-stone-700" for="type">Tipo de base de datos</label>
		<select
			id="type"
			name="type"
			class="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none focus:border-stone-500"
		>
			<option value="postgres" selected={data.connection?.type === 'postgres'}>PostgreSQL</option>
			<option value="mysql" selected={data.connection?.type === 'mysql'}>MySQL</option>
			<option value="sqlite" selected={!data.connection || data.connection.type === 'sqlite'}
				>SQLite</option
			>
		</select>

		<label class="block text-sm font-medium text-stone-700" for="connection">
			Cadena de conexión
		</label>
		<input
			id="connection"
			name="connectionString"
			value={data.connection?.connectionString ?? ''}
			placeholder="postgres://readonly:password@host:5432/database"
			class="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none focus:border-stone-500"
		/>
		<p class="text-xs leading-5 text-stone-500">
			Ejemplos: <code>postgres://user:pass@host:5432/db</code>,
			<code>mysql://user:pass@host:3306/db</code> o <code>/ruta/absoluta/a/local.db</code>.
		</p>
		<button
			class="rounded-2xl bg-stone-950 px-5 py-3 text-sm font-medium text-white hover:bg-stone-800"
		>
			Guardar conexión
		</button>
	</form>

	{#if form?.savedConnection}
		<p
			class="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
		>
			Conexión guardada.
		</p>
	{/if}
</section>
