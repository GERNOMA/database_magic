<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let question = $state('');

	function formatDate(value: string) {
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(value));
	}

	function rowCount(rowsJson: string | null) {
		if (!rowsJson) return 0;
		try {
			const rows = JSON.parse(rowsJson);
			return Array.isArray(rows) ? rows.length : 0;
		} catch {
			return 0;
		}
	}
</script>

<svelte:head>
	<title>Ask | Database Magic</title>
</svelte:head>

<div class="grid min-h-[calc(100vh-10rem)] gap-6 lg:grid-cols-[320px_1fr]">
	<aside class="flex flex-col rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-sm text-stone-500">Saved chats</p>
				<h2 class="text-lg font-semibold">Ask history</h2>
			</div>
			<a
				href={resolve('/ask')}
				class="rounded-2xl bg-stone-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
			>
				New
			</a>
		</div>

		<div class="mt-5 flex-1 space-y-2 overflow-auto">
			{#each data.chats as chat (chat.id)}
				<div
					class={`group flex items-center gap-2 rounded-2xl border p-1 transition ${
						data.selectedChat?.id === chat.id
							? 'border-stone-950 bg-stone-950'
							: 'border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-white'
					}`}
				>
					<a
						href={resolve(`/ask?chat=${chat.id}`)}
						class={`min-w-0 flex-1 rounded-xl px-3 py-2 ${
							data.selectedChat?.id === chat.id ? 'text-white' : 'text-stone-700'
						}`}
					>
						<span class="block truncate text-sm font-medium">{chat.title}</span>
						<span
							class={`mt-1 block text-xs ${
								data.selectedChat?.id === chat.id ? 'text-stone-300' : 'text-stone-500'
							}`}>{formatDate(chat.updatedAt)}</span
						>
					</a>
					<form method="POST" action="?/deleteChat">
						<input type="hidden" name="chatId" value={chat.id} />
						<button
							class={`rounded-full border px-3 py-1 text-xs font-medium transition ${
								data.selectedChat?.id === chat.id
									? 'border-white/25 text-white hover:bg-white/10'
									: 'border-red-200 text-red-600 hover:bg-red-50'
							}`}
							aria-label={`Delete ${chat.title}`}
						>
							Delete
						</button>
					</form>
				</div>
			{:else}
				<p class="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
					Your saved conversations will appear here.
				</p>
			{/each}
		</div>
	</aside>

	<section
		class="flex min-h-[680px] flex-col rounded-3xl border border-stone-200 bg-white shadow-sm"
	>
		<header class="border-b border-stone-200 p-5">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p class="text-sm text-stone-500">Read-only database assistant</p>
					<h1 class="mt-1 text-2xl font-semibold">
						{data.selectedChat?.title ?? 'Ask your data'}
					</h1>
					<p class="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
						Ask follow-up questions, revisit past answers, and keep each thread available for later.
					</p>
				</div>
				<div
					class="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-500"
				>
					SQL is generated as read-only queries and limited to one statement.
				</div>
			</div>

			{#if form?.error}
				<div
					class="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
				>
					{form.error}
				</div>
			{/if}
		</header>

		<div class="flex-1 space-y-5 overflow-auto bg-stone-50/70 p-5">
			{#each data.messages as message (message.id)}
				{#if message.role === 'user'}
					<div class="flex justify-end">
						<div class="max-w-[78%] rounded-3xl bg-stone-950 px-5 py-4 text-white shadow-sm">
							<p class="text-sm leading-6 whitespace-pre-wrap">{message.content}</p>
						</div>
					</div>
				{:else}
					<div class="max-w-3xl rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
						<div class="flex items-center justify-between gap-3">
							<p class="text-sm font-semibold text-stone-700">Database Magic</p>
							{#if message.rowsJson}
								<span class="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">
									{rowCount(message.rowsJson)} rows
								</span>
							{/if}
						</div>
						<p class="mt-3 text-sm leading-6 whitespace-pre-wrap text-stone-800">
							{message.content}
						</p>
						{#if message.sql}
							<details class="mt-4 rounded-2xl border border-stone-200 bg-stone-950 p-4">
								<summary class="cursor-pointer text-sm font-medium text-stone-100">
									View generated SQL
								</summary>
								<pre class="mt-3 overflow-auto text-xs leading-6 text-stone-100">{message.sql}</pre>
							</details>
						{/if}
					</div>
				{/if}
			{:else}
				<div
					class="flex h-full min-h-[360px] items-center justify-center rounded-3xl border border-dashed border-stone-200 bg-white"
				>
					<div class="max-w-md px-6 text-center">
						<p class="text-sm font-medium text-stone-500">Start a conversation</p>
						<h2 class="mt-2 text-3xl font-semibold tracking-tight">What do you want to know?</h2>
						<p class="mt-3 text-sm leading-6 text-stone-500">
							Try asking for trends, rankings, anomalies, or summaries from the database metadata
							you created.
						</p>
					</div>
				</div>
			{/each}
		</div>

		<form method="POST" action="?/ask" class="border-t border-stone-200 p-5">
			<input type="hidden" name="chatId" value={data.selectedChat?.id ?? ''} />
			<div
				class="rounded-3xl border border-stone-200 bg-stone-50 p-2 focus-within:border-stone-500"
			>
				<textarea
					name="question"
					bind:value={question}
					rows="3"
					placeholder="Ask a follow-up, like: why did that change?"
					class="max-h-48 w-full resize-y border-0 bg-transparent p-3 text-sm leading-6 outline-none"
				></textarea>
				<div class="flex items-center justify-between gap-3 px-2 pb-2">
					<p class="text-xs text-stone-500">
						{data.selectedChat ? 'Continuing this chat' : 'A new chat will be saved automatically'}
					</p>
					<button
						class="rounded-2xl bg-stone-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800"
					>
						Send
					</button>
				</div>
			</div>
		</form>
	</section>
</div>
