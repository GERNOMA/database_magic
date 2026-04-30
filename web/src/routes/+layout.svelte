<script lang="ts">
	import { page } from '$app/state';
	import './layout.css';
	import { APP_NAME } from '$lib/app';
	import favicon from '$lib/assets/favicon.svg';
	import { withCurrentQueryParams } from '$lib/query-params';

	let { children, data } = $props();

	const navItems = [
		{ label: 'Metadatos', href: '/metadata', adminOnly: true },
		{ label: 'Usuarios', href: '/users', adminOnly: true },
		{ label: 'Preguntar', href: '/ask', adminOnly: false },
		{ label: 'Notificaciones', href: '/notifications', adminOnly: false },
		{ label: 'Tareas', href: '/tasks', adminOnly: false },
		{ label: 'Páginas', href: '/pages', adminOnly: false },
		{ label: 'Conexión', href: '/connection', adminOnly: true }
	] as const;

	const navHref = (href: (typeof navItems)[number]['href']) => {
		return withCurrentQueryParams(page.url, href);
	};
	const brandHref = $derived(data.isAdmin ? navHref('/metadata') : navHref('/ask'));
	const visibleNavItems = $derived(navItems.filter((item) => data.isAdmin || !item.adminOnly));
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<main class="min-h-screen bg-stone-50 text-stone-950">
	<nav class="border-b border-stone-200 bg-white/85 backdrop-blur">
		<div
			class="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<a href={brandHref} class="text-lg font-semibold tracking-tight">{APP_NAME}</a>
			<div class="flex flex-wrap rounded-full border border-stone-200 bg-stone-100 p-1 text-sm">
				{#each visibleNavItems as item (item.href)}
					<a
						href={navHref(item.href)}
						class={`rounded-full px-4 py-2 transition ${
							page.url.pathname === item.href
								? 'bg-white shadow-sm'
								: 'text-stone-600 hover:text-stone-950'
						}`}
					>
						{item.label}
					</a>
				{/each}
			</div>
		</div>
	</nav>

	<section class="mx-auto max-w-7xl px-4 py-8">
		{@render children()}
	</section>
</main>
