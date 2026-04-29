<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let question = $state('');
</script>

<svelte:head>
	<title>Ask | Database Magic</title>
</svelte:head>

<section class="mx-auto max-w-3xl rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
	<h1 class="text-2xl font-semibold">Ask your data</h1>
	<p class="mt-2 text-sm text-stone-500">
		The AI writes a read-only SQL query, executes it against your connected SQLite database, then
		explains the result.
	</p>

	{#if form?.error}
		<div class="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<form method="POST" action="?/ask" class="mt-6 space-y-4">
		<textarea
			name="question"
			bind:value={question}
			rows="5"
			placeholder="Which customers generated the most revenue last month?"
			class="w-full rounded-2xl border border-stone-200 bg-stone-50 p-4 outline-none focus:border-stone-500"
		></textarea>
		<button
			class="rounded-2xl bg-stone-950 px-5 py-3 text-sm font-medium text-white hover:bg-stone-800"
		>
			Ask
		</button>
	</form>

	{#if form?.answer}
		<div class="mt-8 space-y-4">
			<div class="rounded-2xl border border-stone-200 bg-stone-50 p-4">
				<p class="text-sm font-medium text-stone-600">SQL</p>
				<pre class="mt-2 overflow-auto text-sm">{form.sql}</pre>
			</div>
			<div class="rounded-2xl border border-stone-200 bg-stone-50 p-4">
				<p class="text-sm font-medium text-stone-600">Answer</p>
				<p class="mt-2 whitespace-pre-wrap text-stone-800">{form.answer}</p>
			</div>
		</div>
	{/if}
</section>
