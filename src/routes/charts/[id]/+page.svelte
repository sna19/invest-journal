<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TopBar from '#lib/TopBar.svelte';
	import ChartWidget, { type ChartConfig } from '#lib/charts/ChartWidget.svelte';
	import { showToast } from '#lib/toast.svelte.js';
	import { tx } from '#lib/i18n.js';

	/**
	 * Owner 27.11.2026: a saved chart — the same widget as on the card, opened with everything chosen; changed and saved
	 * («Сохранить изменения» / «Сохранить как новый»), renamed, deleted. /charts/new?security=<id> — a new one.
	 */
	type Saved = { id: number; name: string; securityId: number; symbol: string; config: ChartConfig };
	let ch = $state<Saved | null>(null);
	let problem = $state<string | null>(null);
	let renaming = $state(false);
	let name = $state('');
	const isNew = $derived(page.params.id === 'new');
	const newSec = $derived(Number(page.url.searchParams.get('security')) || null);

	async function load() {
		if (isNew) return;
		const r = await fetch(`/api/charts/${page.params.id}`).catch(() => null);
		if (!r?.ok) return void (problem = tx('Нет такого графика', 'No such chart'));
		ch = await r.json();
	}
	// «Сохранить как новый» opens the new one on the same screen
	$effect(() => {
		void page.params.id;
		ch = null;
		void load();
	});
	async function rename() {
		const r = await fetch(`/api/charts/${ch!.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
		if (!r?.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		ch = await r.json();
		renaming = false;
	}
	async function remove() {
		if (!confirm(tx(`Удалить график «${ch!.name}»?`, `Delete the chart «${ch!.name}»?`))) return;
		await fetch(`/api/charts/${ch!.id}`, { method: 'DELETE' }).catch(() => null);
		goto('/charts');
	}
</script>

<svelte:head><title>{ch?.name ?? tx('График', 'Chart')}</title></svelte:head>
<TopBar title={ch?.name ?? (isNew ? tx('Новый график', 'A new chart') : tx('График', 'Chart'))} help="charts.saved" back={{ href: '/charts', label: tx('Графики', 'Charts') }} />

{#if problem}
	<p class="muted">{problem}</p>
{:else if isNew && newSec}
	<p class="muted small">{tx('Настрой график и нажми «Сохранить график» под ним.', 'Set up the chart and press «Save the chart» under it.')}</p>
	{#key newSec}
		<ChartWidget securityId={newSec} onsaved={(x) => goto(`/charts/${x.id}`, { replaceState: true })} />
	{/key}
{:else if ch}
	<p class="head">
		<a href="/security/{ch.securityId}">{ch.symbol} →</a>
		{#if renaming}
			<input bind:value={name} aria-label={tx('Название', 'Name')} />
			<button class="ghost" disabled={!name.trim()} onclick={rename}>{tx('Сохранить', 'Save')}</button>
			<button class="ghost" onclick={() => (renaming = false)}>{tx('Отмена', 'Cancel')}</button>
		{:else}
			<button class="link" onclick={() => ((name = ch!.name), (renaming = true))}>{tx('Переименовать', 'Rename')}</button>
			<button class="link danger" onclick={remove}>{tx('Удалить', 'Delete')}</button>
		{/if}
	</p>
	{#key ch.id}
		<ChartWidget securityId={ch.securityId} config={ch.config} saved={{ id: ch.id, name: ch.name }} onsaved={(x) => goto(`/charts/${x.id}`)} />
	{/key}
{:else}
	<p class="muted">{tx('Загружаю…', 'Loading…')}</p>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s2);
		margin: var(--s2) 0 var(--s3);
	}
	.head a {
		font-weight: 600;
		color: var(--link);
		text-decoration: none;
		margin-right: auto;
	}
	.head input {
		flex: 1;
		min-width: 0;
		min-height: 36px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
	}
	.link {
		border: none;
		background: none;
		color: var(--link);
		font-size: var(--fs-s);
		cursor: pointer;
		padding: 6px;
	}
	.danger {
		color: var(--down);
	}
	.ghost {
		min-height: 36px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
</style>
