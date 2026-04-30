<script lang="ts">
	import { page } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const pageHref = (id: number) => withCurrentQueryParams(page.url, `/pages/${id}`);
	const askHref = withCurrentQueryParams(page.url, '/ask');
	const pagesAction = (actionName: string) => withCurrentQueryParams(page.url, `?/${actionName}`);

	function formatDate(value: string) {
		return new Intl.DateTimeFormat('es', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(value));
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<svelte:head>
	<title>Páginas | {APP_NAME}</title>
</svelte:head>

<div class="rounded-4xl border border-stone-200 bg-white p-6 shadow-sm">
	<div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
		<div>
			<p class="text-sm font-medium tracking-[0.2em] text-stone-400 uppercase">Webs dinámicas</p>
			<h1 class="mt-2 text-3xl font-semibold tracking-tight">Páginas</h1>
			<p class="mt-3 max-w-2xl text-sm leading-6 text-stone-500">
				Aquí viven las páginas SvelteKit con Tailwind que creó la IA. Cada una ejecuta su carga de
				datos al abrirse y puede consultar la base con SQL de solo lectura.
			</p>
		</div>
		<a
			href={askHref}
			class="inline-flex items-center justify-center rounded-2xl bg-stone-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800"
		>
			Crear desde Preguntar
		</a>
	</div>
</div>

{#if !data.isAdmin && !data.currentUser}
	<div class="mt-6 rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm">
		<h2 class="text-xl font-semibold">Usuario no ingresado</h2>
		<p class="mt-2 text-sm text-stone-500">Agrega el parámetro de usuario para ver tus páginas.</p>
	</div>
{:else if data.pages.length === 0}
	<div class="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-10 text-center">
		<h2 class="text-xl font-semibold">Todavía no hay páginas</h2>
		<p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-stone-500">
			Pídele al asistente algo como: “crea una página SvelteKit con Tailwind que muestre resumen de
			ventas, cards, ranking de productos y una tabla de últimas compras”.
		</p>
	</div>
{:else}
	<div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#each data.pages as aiPage (aiPage.id)}
			<article
				class="flex min-h-64 flex-col justify-between rounded-3xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:shadow-md"
			>
				<a href={pageHref(aiPage.id)} class="group block flex-1">
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
							>
								Dinámica
							</span>
							{#if data.isAdmin}
								<span
									class="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
								>
									Usuario: {aiPage.userKey || 'sin usuario'}
								</span>
							{/if}
						</div>
						<h2 class="mt-4 text-2xl font-semibold tracking-tight">{aiPage.title}</h2>
						<p class="mt-3 line-clamp-4 text-sm leading-6 text-stone-600">{aiPage.description}</p>
					</div>
				</a>
				<div>
					<p class="mt-5 text-sm leading-6 text-stone-500">
						<span class="font-medium text-stone-700">Visual:</span>
						{aiPage.visualPrompt}
					</p>
					<p class="mt-4 text-xs tracking-[0.16em] text-stone-400 uppercase">
						Actualizada {formatDate(aiPage.updatedAt)}
					</p>
					<form method="POST" action={pagesAction('deletePage')} class="mt-4">
						<input type="hidden" name="pageId" value={aiPage.id} />
						<button
							class="rounded-2xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
						>
							Eliminar
						</button>
					</form>
				</div>
			</article>
		{/each}
	</div>
{/if}
