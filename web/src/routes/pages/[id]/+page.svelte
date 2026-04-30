<script lang="ts">
	import { page as pageState } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const pagesHref = withCurrentQueryParams(pageState.url, '/pages');
	const title = $derived(data.rendered?.title ?? data.page.title);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<svelte:head>
	<title>{title} | {APP_NAME}</title>
</svelte:head>

<a href={pagesHref} class="text-sm font-medium text-stone-500 transition hover:text-stone-950">
	← Volver a páginas
</a>

<article class="mt-5 overflow-hidden rounded-4xl border border-stone-200 bg-white shadow-sm">
	<header class="border-b border-stone-100 bg-white p-6">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
			<div>
				<p class="text-sm font-medium tracking-[0.2em] text-stone-400 uppercase">
					Página dinámica generada por IA
				</p>
				<h1 class="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
				<p class="mt-3 max-w-3xl text-sm leading-6 text-stone-500">{data.page.description}</p>
			</div>
			<div class="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">
				Se ejecuta al abrir
			</div>
		</div>
	</header>

	{#if data.error}
		<div class="m-6 rounded-3xl border border-red-200 bg-red-50 p-5 text-red-700">
			<h2 class="font-semibold">La página no pudo renderizarse</h2>
			<p class="mt-2 text-sm">{data.error}</p>
		</div>
	{:else if data.rendered}
		<div class="bg-stone-100 p-4">
			<iframe
				{title}
				srcdoc={data.rendered.html}
				sandbox=""
				class="min-h-[760px] w-full rounded-3xl border border-stone-200 bg-white"
			></iframe>
		</div>
	{/if}

	{#if data.isAdmin}
		<div class="grid gap-px border-t border-stone-800 bg-stone-800 lg:grid-cols-2">
			<div class="bg-stone-950 p-6 text-stone-100">
				<p class="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">
					Código de la página
				</p>
				<pre class="mt-3 max-h-[520px] overflow-auto text-sm leading-6 whitespace-pre-wrap">{data
						.page.pageCode}</pre>
			</div>
			<div class="bg-stone-950 p-6 text-stone-100">
				<p class="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">
					SQL ejecutado en este render
				</p>
				<pre
					class="mt-3 max-h-[520px] overflow-auto text-sm leading-6 whitespace-pre-wrap">{data.rendered?.executedSql.join(
						'\n--- ---\n'
					) || 'Sin consultas registradas.'}</pre>
			</div>
		</div>
	{/if}
</article>
