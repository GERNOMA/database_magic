<script lang="ts">
	import { page } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const notificationHref = (id: number) => withCurrentQueryParams(page.url, `/notifications/${id}`);

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
	<title>Notificaciones | {APP_NAME}</title>
</svelte:head>

<div class="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
	<div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
		<div>
			<p class="text-sm font-medium tracking-[0.2em] text-stone-400 uppercase">Resultados</p>
			<h1 class="mt-2 text-3xl font-semibold tracking-tight">Notificaciones</h1>
			<p class="mt-3 max-w-2xl text-sm leading-6 text-stone-500">
				Cada rutina completada aparece aquí. Ábrela para ver la página visual generada por la IA.
			</p>
		</div>
		<div class="rounded-3xl bg-stone-950 px-5 py-4 text-white">
			<p class="text-xs tracking-[0.18em] text-stone-400 uppercase">Sin leer</p>
			<p class="mt-1 text-3xl font-semibold">{data.unreadCount}</p>
		</div>
	</div>
</div>

{#if !data.isAdmin && !data.currentUser}
	<div class="mt-6 rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm">
		<h2 class="text-xl font-semibold">Usuario no ingresado</h2>
		<p class="mt-2 text-sm text-stone-500">
			Agrega el parámetro de usuario para ver tus notificaciones.
		</p>
	</div>
{:else if data.notifications.length === 0}
	<div class="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-10 text-center">
		<h2 class="text-xl font-semibold">No hay notificaciones todavía</h2>
		<p class="mt-2 text-sm text-stone-500">
			Cuando una tarea se ejecute, el reporte generado aparecerá en esta lista.
		</p>
	</div>
{:else}
	<div class="mt-6 grid gap-3">
		{#each data.notifications as notification (notification.id)}
			<a
				href={notificationHref(notification.id)}
				class={`group block rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
					notification.readAt ? 'border-stone-200 bg-white' : 'border-amber-200 bg-amber-50'
				}`}
			>
				<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<span
								class={`h-2.5 w-2.5 rounded-full ${
									notification.readAt ? 'bg-stone-300' : 'bg-amber-500'
								}`}
							></span>
							<span class="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">
								{notification.readAt ? 'Leída' : 'Nueva'}
							</span>
							{#if data.isAdmin}
								<span
									class="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
								>
									Usuario: {notification.userKey || 'sin usuario'}
								</span>
							{/if}
						</div>
						<h2 class="mt-3 truncate text-xl font-semibold tracking-tight">
							{notification.title}
						</h2>
						<p class="mt-2 line-clamp-2 text-sm leading-6 text-stone-600">
							{notification.message}
						</p>
					</div>
					<div class="shrink-0 text-sm text-stone-500">{formatDate(notification.createdAt)}</div>
				</div>
			</a>
		{/each}
	</div>
{/if}
