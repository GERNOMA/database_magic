<script lang="ts">
	import { page } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ReportSection = {
		type?: string;
		title?: string;
		value?: string;
		note?: string;
		body?: string;
		columns?: string[];
		rows?: Array<Record<string, unknown>>;
		labelKey?: string;
		valueKey?: string;
	};

	type ReportSpec = {
		title?: string;
		subtitle?: string;
		summary?: string;
		accent?: string;
		sections?: ReportSection[];
	};

	const notificationsHref = withCurrentQueryParams(page.url, '/notifications');

	function parseJson<T>(value: string | null, fallback: T) {
		if (!value) return fallback;
		try {
			return JSON.parse(value) as T;
		} catch {
			return fallback;
		}
	}

	const report = $derived(parseJson<ReportSpec>(data.run?.pageSpecJson ?? null, {}));
	const rawRows = $derived(
		parseJson<Array<Record<string, unknown>>>(data.run?.rowsJson ?? null, [])
	);
	const sections = $derived(
		report.sections?.length
			? report.sections
			: [
					{
						type: rawRows.length ? 'table' : 'text',
						title: rawRows.length ? 'Datos obtenidos' : 'Sin datos',
						body: rawRows.length ? undefined : 'La consulta no devolvió filas.',
						columns: Object.keys(rawRows[0] ?? {}),
						rows: rawRows
					}
				]
	);
	const accentClass = $derived(
		report.accent === 'emerald'
			? 'from-emerald-500 to-teal-500'
			: report.accent === 'indigo'
				? 'from-indigo-500 to-violet-500'
				: report.accent === 'amber'
					? 'from-amber-500 to-orange-500'
					: 'from-stone-800 to-stone-500'
	);

	function formatDate(value: string) {
		return new Intl.DateTimeFormat('es', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	function displayValue(value: unknown) {
		if (value == null) return '—';
		if (typeof value === 'number') return new Intl.NumberFormat('es').format(value);
		if (typeof value === 'boolean') return value ? 'Sí' : 'No';
		return String(value);
	}

	function numericValue(value: unknown) {
		const number = Number(value);
		return Number.isFinite(number) ? number : 0;
	}

	function maxValue(rows: Array<Record<string, unknown>>, valueKey: string) {
		return Math.max(1, ...rows.map((row) => numericValue(row[valueKey])));
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<svelte:head>
	<title>{report.title ?? data.notification.title} | {APP_NAME}</title>
</svelte:head>

<a
	href={notificationsHref}
	class="text-sm font-medium text-stone-500 transition hover:text-stone-950"
>
	← Volver a notificaciones
</a>

<article class="mt-5 overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-sm">
	<header class={`bg-gradient-to-br ${accentClass} p-8 text-white`}>
		<div class="max-w-4xl">
			<p class="text-sm font-medium tracking-[0.22em] text-white/70 uppercase">
				Reporte generado por IA
			</p>
			<h1 class="mt-3 text-4xl font-semibold tracking-tight">
				{report.title ?? data.notification.title}
			</h1>
			<p class="mt-4 max-w-3xl text-base leading-7 text-white/80">
				{report.subtitle ?? data.task?.description ?? data.notification.message}
			</p>
		</div>
	</header>

	<section class="grid gap-4 border-b border-stone-100 p-6 md:grid-cols-[1fr_auto] md:items-center">
		<p class="max-w-4xl text-sm leading-6 text-stone-600">
			{report.summary ?? data.notification.message}
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
		<div class="grid gap-5 p-6 lg:grid-cols-2">
			{#each sections as section, index (`${section.title}-${index}`)}
				{#if section.type === 'metric'}
					<section class="rounded-3xl border border-stone-200 bg-stone-50 p-6">
						<p class="text-sm font-medium text-stone-500">{section.title}</p>
						<p class="mt-3 text-4xl font-semibold tracking-tight text-stone-950">
							{section.value}
						</p>
						{#if section.note}
							<p class="mt-3 text-sm leading-6 text-stone-500">{section.note}</p>
						{/if}
					</section>
				{:else if section.type === 'bars' && section.rows && section.labelKey && section.valueKey}
					<section class="rounded-3xl border border-stone-200 bg-white p-6">
						<h2 class="text-lg font-semibold">{section.title}</h2>
						<div class="mt-5 space-y-4">
							{#each section.rows.slice(0, 12) as row, rowIndex (rowIndex)}
								{@const value = numericValue(row[section.valueKey])}
								{@const width = Math.max(
									3,
									(value / maxValue(section.rows, section.valueKey)) * 100
								)}
								<div>
									<div class="mb-1 flex justify-between gap-3 text-sm">
										<span class="truncate text-stone-600"
											>{displayValue(row[section.labelKey])}</span
										>
										<span class="font-medium text-stone-900">{displayValue(value)}</span>
									</div>
									<div class="h-3 overflow-hidden rounded-full bg-stone-100">
										<div class="h-full rounded-full bg-stone-950" style={`width: ${width}%`}></div>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{:else if section.type === 'table' && section.rows}
					<section
						class="overflow-hidden rounded-3xl border border-stone-200 bg-white lg:col-span-2"
					>
						<div class="border-b border-stone-100 p-5">
							<h2 class="text-lg font-semibold">{section.title}</h2>
						</div>
						<div class="overflow-auto">
							<table class="w-full min-w-[720px] text-left text-sm">
								<thead class="bg-stone-50 text-xs tracking-[0.14em] text-stone-400 uppercase">
									<tr>
										{#each section.columns?.length ? section.columns : Object.keys(section.rows[0] ?? {}) as column (column)}
											<th class="px-4 py-3 font-medium">{column}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-stone-100">
									{#each section.rows.slice(0, 50) as row, rowIndex (rowIndex)}
										<tr class="hover:bg-stone-50">
											{#each section.columns?.length ? section.columns : Object.keys(row) as column (column)}
												<td class="px-4 py-3 text-stone-700">{displayValue(row[column])}</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</section>
				{:else}
					<section class="rounded-3xl border border-stone-200 bg-white p-6">
						<h2 class="text-lg font-semibold">{section.title}</h2>
						<p class="mt-3 text-sm leading-6 text-stone-600">{section.body}</p>
					</section>
				{/if}
			{/each}
		</div>
	{/if}

	{#if data.isAdmin && data.run?.sql}
		<div class="border-t border-stone-100 bg-stone-950 p-6 text-stone-100">
			<p class="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">SQL ejecutado</p>
			<pre class="mt-3 overflow-auto text-sm leading-6 whitespace-pre-wrap">{data.run.sql}</pre>
		</div>
	{/if}
</article>
