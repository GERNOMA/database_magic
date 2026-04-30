<script lang="ts">
	import { page } from '$app/state';
	import { APP_NAME } from '$lib/app';
	import { withCurrentQueryParams } from '$lib/query-params';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const taskAction = (actionName: string) => {
		return withCurrentQueryParams(page.url, `?/${actionName}`);
	};
	const askHref = withCurrentQueryParams(page.url, '/ask');

	function formatDate(value: string | null) {
		if (!value) return 'Aún no';
		return new Intl.DateTimeFormat('es', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(value));
	}

	function intervalLabel(minutes: number) {
		if (minutes % 1440 === 0) return `Cada ${minutes / 1440} día${minutes === 1440 ? '' : 's'}`;
		if (minutes % 60 === 0) return `Cada ${minutes / 60} hora${minutes === 60 ? '' : 's'}`;
		return `Cada ${minutes} minuto${minutes === 1 ? '' : 's'}`;
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<svelte:head>
	<title>Tareas | {APP_NAME}</title>
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
		Tarea actualizada.
	</div>
{/if}

<div class="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
	<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
		<div>
			<p class="text-sm font-medium tracking-[0.2em] text-stone-400 uppercase">Rutinas de IA</p>
			<h1 class="mt-2 text-3xl font-semibold tracking-tight">Tareas programadas</h1>
			<p class="mt-3 max-w-2xl text-sm leading-6 text-stone-500">
				Cada tarea ejecuta el SQL que creó la IA en su intervalo, genera una notificación y
				construye una página visual con los datos obtenidos.
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
		<p class="mt-2 text-sm text-stone-500">Agrega el parámetro de usuario para ver tus tareas.</p>
	</div>
{:else if data.tasks.length === 0}
	<div class="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-10 text-center">
		<h2 class="text-xl font-semibold">Todavía no hay tareas</h2>
		<p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-stone-500">
			Pídele al asistente algo como: “cada 5 minutos revisa ventas por región y muéstrame un
			dashboard con barras y métricas principales”.
		</p>
	</div>
{:else}
	<div class="mt-6 grid gap-5">
		{#each data.tasks as task (task.id)}
			<article class="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
				<div class="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-start">
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<span
								class={`rounded-full px-3 py-1 text-xs font-medium ${
									task.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'
								}`}
							>
								{task.isActive ? 'Activa' : 'Pausada'}
							</span>
							<span class="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
								{intervalLabel(task.intervalMinutes)}
							</span>
							{#if data.isAdmin}
								<span
									class="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
								>
									Usuario: {task.userKey || 'sin usuario'}
								</span>
							{/if}
						</div>
						<h2 class="mt-4 text-2xl font-semibold tracking-tight">{task.title}</h2>
						<p class="mt-2 text-sm leading-6 text-stone-600">{task.description}</p>
						<p class="mt-3 text-sm leading-6 text-stone-500">
							<span class="font-medium text-stone-700">Visual:</span>
							{task.visualPrompt}
						</p>
					</div>

					<div class="grid gap-2 text-sm text-stone-500 sm:grid-cols-3 lg:min-w-[440px]">
						<div class="rounded-2xl bg-stone-50 p-4">
							<p class="text-xs tracking-[0.18em] text-stone-400 uppercase">Última</p>
							<p class="mt-2 font-medium text-stone-800">{formatDate(task.lastRunAt)}</p>
						</div>
						<div class="rounded-2xl bg-stone-50 p-4">
							<p class="text-xs tracking-[0.18em] text-stone-400 uppercase">Próxima</p>
							<p class="mt-2 font-medium text-stone-800">{formatDate(task.nextRunAt)}</p>
						</div>
						<div class="rounded-2xl bg-stone-50 p-4">
							<p class="text-xs tracking-[0.18em] text-stone-400 uppercase">Estado</p>
							<p class="mt-2 font-medium text-stone-800">
								{task.latestRun?.status === 'error' ? 'Con error' : 'Lista'}
							</p>
						</div>
					</div>
				</div>

				{#if data.isAdmin}
					<div class="border-t border-stone-100 bg-stone-950 p-5 text-stone-100">
						<p class="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">
							SQL ejecutado
						</p>
						<pre class="mt-3 overflow-auto text-sm leading-6 whitespace-pre-wrap">{task.sql}</pre>
					</div>
				{/if}

				<div
					class="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 p-4"
				>
					<p class="text-sm text-stone-500">
						Creada {formatDate(task.createdAt)}
						{#if task.latestRun?.error}
							<span class="text-red-600"> · {task.latestRun.error}</span>
						{/if}
					</p>
					<div class="flex flex-wrap gap-2">
						<form method="POST" action={taskAction('runNow')}>
							<input type="hidden" name="taskId" value={task.id} />
							<button class="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium">
								Ejecutar ahora
							</button>
						</form>
						<form method="POST" action={taskAction('toggleTask')}>
							<input type="hidden" name="taskId" value={task.id} />
							<input type="hidden" name="isActive" value={task.isActive ? 0 : 1} />
							<button class="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-medium">
								{task.isActive ? 'Pausar' : 'Activar'}
							</button>
						</form>
						<form method="POST" action={taskAction('deleteTask')}>
							<input type="hidden" name="taskId" value={task.id} />
							<button
								class="rounded-2xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600"
							>
								Eliminar
							</button>
						</form>
					</div>
				</div>
			</article>
		{/each}
	</div>
{/if}
