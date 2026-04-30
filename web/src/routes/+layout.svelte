<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import './layout.css';
	import { APP_NAME } from '$lib/app';
	import favicon from '$lib/assets/favicon.svg';
	import { withCurrentQueryParams } from '$lib/query-params';

	let { children, data } = $props();

	const navItems = [
		{ label: 'Metadatos', href: '/metadata' },
		{ label: 'Usuarios', href: '/users' },
		{ label: 'Preguntar', href: '/ask' },
		{ label: 'Conexión', href: '/connection' }
	] as const;

	type RouteHref = Parameters<typeof resolve>[0];

	const navHref = (href: (typeof navItems)[number]['href']) => {
		return resolve(withCurrentQueryParams(page.url, href) as RouteHref);
	};
	const brandHref = $derived(data.isAdmin ? navHref('/metadata') : navHref('/ask'));
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<main class="min-h-screen bg-stone-50 text-stone-950">
	<nav class="border-b border-stone-200 bg-white/85 backdrop-blur">
		<div
			class="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<a href={brandHref} class="text-lg font-semibold tracking-tight">{APP_NAME}</a>
			{#if data.isAdmin}
				<div class="flex rounded-full border border-stone-200 bg-stone-100 p-1 text-sm">
					{#each navItems as item (item.href)}
						<a
							href={navHref(item.href)}
							class={`rounded-full px-4 py-2 transition ${
								page.url.pathname === resolve(item.href as RouteHref)
									? 'bg-white shadow-sm'
									: 'text-stone-600 hover:text-stone-950'
							}`}
						>
							{item.label}
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</nav>

	<section class="mx-auto max-w-7xl px-4 py-8">
		{@render children()}
	</section>
</main>
