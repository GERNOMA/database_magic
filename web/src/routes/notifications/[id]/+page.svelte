<script lang="ts">
	import { page } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const notificationsHref = withCurrentQueryParams(page.url, '/notifications');
	const reportTitle = $derived(data.run?.reportTitle ?? data.notification.title);
	const reportSummary = $derived(data.run?.reportSummary ?? data.notification.message);
	const fallbackHtml = $derived(
		`<section style="font-family:Inter,system-ui,sans-serif;padding:32px;color:#1c1917"><h1>${escapeHtml(reportTitle)}</h1><p>${escapeHtml(reportSummary)}</p></section>`
	);
	const reportHtml = $derived(data.run?.reportHtml ?? fallbackHtml);

	function escapeHtml(value: unknown) {
		return String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function formatDate(value: string) {
		return new Intl.DateTimeFormat('es', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<svelte:head>
	<title>{reportTitle} | {APP_NAME}</title>
</svelte:head>

<a
	href={notificationsHref}
	class="text-sm font-medium text-stone-500 transition hover:text-stone-950"
>
	← Volver a notificaciones
</a>

<article class="mt-5 overflow-hidden rounded-4xl border border-stone-200 bg-white shadow-sm">
	<header class="bg-linear-to-br from-stone-950 to-stone-700 p-8 text-white">
		<div class="max-w-4xl">
			<p class="text-sm font-medium tracking-[0.22em] text-white/70 uppercase">
				Página fija generada por la tarea
			</p>
			<h1 class="mt-3 text-4xl font-semibold tracking-tight">{reportTitle}</h1>
			<p class="mt-4 max-w-3xl text-base leading-7 text-white/80">{reportSummary}</p>
		</div>
	</header>

	<section class="grid gap-4 border-b border-stone-100 p-6 md:grid-cols-[1fr_auto] md:items-center">
		<p class="max-w-4xl text-sm leading-6 text-stone-600">
			Esta página es el HTML estático que devolvió el super código de la tarea después de hacer sus
			consultas. Al abrirla no se ejecuta SQL.
		</p>
		<div class="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">
			<p class="text-xs tracking-[0.18em] text-stone-400 uppercase">Ejecutado</p>
			<p class="mt-1 font-medium text-stone-800">{formatDate(data.notification.createdAt)}</p>
		</div>
	</section>

	{#if data.run?.status === 'error'}
		<div class="m-6 rounded-3xl border border-red-200 bg-red-50 p-5 text-red-700">
			<h2 class="font-semibold">La tarea terminó con error</h2>
			<p class="mt-2 text-sm">{data.run.error}</p>
		</div>
	{:else}
		<div class="bg-stone-100 p-4">
			<iframe
				title={reportTitle}
				srcdoc={reportHtml}
				sandbox=""
				class="min-h-[720px] w-full rounded-3xl border border-stone-200 bg-white"
			></iframe>
		</div>
	{/if}

	{#if data.isAdmin}
		<div class="grid gap-px border-t border-stone-800 bg-stone-800 lg:grid-cols-2">
			<div class="bg-stone-950 p-6 text-stone-100">
				<p class="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">
					Super código de la tarea
				</p>
				<pre class="mt-3 max-h-[460px] overflow-auto text-sm leading-6 whitespace-pre-wrap">{data
						.task?.routineCode || data.task?.sql}</pre>
			</div>
			<div class="bg-stone-950 p-6 text-stone-100">
				<p class="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">
					SQL ejecutado durante esta corrida
				</p>
				<pre class="mt-3 max-h-[460px] overflow-auto text-sm leading-6 whitespace-pre-wrap">{data
						.run?.sql || 'Sin consultas registradas.'}</pre>
			</div>
		</div>
	{/if}
</article>
