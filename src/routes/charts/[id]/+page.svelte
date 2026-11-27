<script lang="ts">
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import TopBar from '#lib/TopBar.svelte';
	import ChartWidget, { type ChartConfig } from '#lib/charts/ChartWidget.svelte';
	import SetMap from '#lib/sets/SetMap.svelte';
	import SetCompare from '#lib/sets/SetCompare.svelte';
	import SetRisk from '#lib/sets/SetRisk.svelte';
	import SetBasket from '#lib/sets/SetBasket.svelte';
	import type { SetItem } from '#lib/sets/types.js';
	import { showToast } from '#lib/toast.svelte.js';
	import { tx } from '#lib/i18n.js';

	/**
	 * Owner 27.11.2026: a set — a saved chart's securities (the main one and the added ones), or the picked ones
	 * (/charts/picked) — seen as a chart (the same widget as on the card), a map of ties or a comparison table.
	 * /charts/new?security=<id> — a new one from a security.
	 */
	type Saved = { id: number; name: string; securityId: number; symbol: string; config: ChartConfig };
	let ch = $state<Saved | null>(null);
	let items = $state<SetItem[] | null>(null);
	let problem = $state<string | null>(null);
	let renaming = $state(false);
	let name = $state('');
	const isNew = $derived(page.params.id === 'new');
	const isPicked = $derived(page.params.id === 'picked');
	const newSec = $derived(Number(page.url.searchParams.get('security')) || null);
	const VIEWS = [
		['chart', 'График', 'Chart'],
		['map', 'Карта связей', 'Map of ties'],
		['compare', 'Сравнение', 'Comparison'],
		['risk', 'Риск', 'Risk'],
		['basket', 'Корзина', 'Basket']
	] as const;
	type View = (typeof VIEWS)[number][0];
	let view = $state<View>((VIEWS.find((v) => v[0] === page.url.searchParams.get('view'))?.[0] ?? 'chart') as View);
	function setView(v: View) {
		view = v;
		replaceState(`?view=${v}`, {});
	}

	async function load() {
		problem = null;
		if (isNew) return;
		if (isPicked) {
			const r = await fetch('/api/shortlist').catch(() => null);
			items = r?.ok ? (await r.json()).items : [];
			return;
		}
		const r = await fetch(`/api/charts/${page.params.id}`).catch(() => null);
		if (!r?.ok) return void (problem = tx('Нет такого набора', 'No such set'));
		ch = await r.json();
		const ids = [ch!.securityId, ...ch!.config.peers];
		const j = await fetch(`/api/sets/items?ids=${ids.join(',')}`).then((x) => x.json()).catch(() => null);
		items = j?.items ?? [];
	}
	// «Сохранить как новый» opens the new one on the same screen
	$effect(() => {
		void page.params.id;
		ch = null;
		items = null;
		void load();
	});
	async function rename() {
		const r = await fetch(`/api/charts/${ch!.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
		if (!r?.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		ch = await r.json();
		renaming = false;
	}
	async function remove() {
		if (!confirm(tx(`Удалить «${ch!.name}»?`, `Delete «${ch!.name}»?`))) return;
		await fetch(`/api/charts/${ch!.id}`, { method: 'DELETE' }).catch(() => null);
		goto('/charts');
	}
	const title = $derived(isPicked ? tx('★ Отмеченные', '★ Picked') : (ch?.name ?? (isNew ? tx('Новый график', 'A new chart') : tx('Набор', 'Set'))));
</script>

<svelte:head><title>{title}</title></svelte:head>
<TopBar {title} help="charts.saved" back={{ href: '/charts', label: tx('Наборы', 'Sets') }} />

{#if problem}
	<p class="muted">{problem}</p>
{:else if isNew && newSec}
	<p class="muted small">{tx('Настрой график и нажми «Сохранить график» под ним.', 'Set up the chart and press «Save the chart» under it.')}</p>
	{#key newSec}
		<ChartWidget securityId={newSec} onsaved={(x) => goto(`/charts/${x.id}`, { replaceState: true })} />
	{/key}
{:else if items}
	{#if ch}
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
	{:else if isPicked}
		<p class="head"><a href="/shortlist">{tx('Отмеченные', 'Picked')} · {items.length} →</a></p>
	{/if}
	<div class="views" role="tablist" aria-label={tx('Вид набора', 'The set\'s view')}>
		{#each VIEWS as [k, ru, en] (k)}
			<button role="tab" aria-selected={view === k} class:on={view === k} onclick={() => setView(k)}>{tx(ru, en)}</button>
		{/each}
	</div>
	{#if !items.length}
		<p class="muted">{tx('В наборе пока нет бумаг.', 'No securities in the set yet.')}</p>
	{:else if view === 'chart'}
		{#key `${page.params.id}`}
			{#if ch}
				<ChartWidget securityId={ch.securityId} config={ch.config} saved={{ id: ch.id, name: ch.name }} onsaved={(x) => goto(`/charts/${x.id}`)} />
			{:else}
				{@const rest = items.slice(1, 9).map((x) => x.id)}
				{#if items.length > 9}<p class="muted small">{tx(`На графике первые 9 из ${items.length}: больше линий не различить.`, `The chart shows the first 9 of ${items.length}: more lines cannot be told apart.`)}</p>{/if}
				<ChartWidget securityId={items[0].id} config={{ period: '1Y', peers: rest, shown: rest, sma: [], highlight: null }} onsaved={(x) => goto(`/charts/${x.id}`)} />
			{/if}
		{/key}
	{:else if view === 'map'}
		<SetMap {items} storeKey={isPicked ? 'picked' : `set-${page.params.id}`} />
	{:else if view === 'compare'}
		<SetCompare {items} />
	{:else if view === 'risk'}
		<SetRisk {items} />
	{:else}
		<SetBasket {items} />
	{/if}
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
	.views {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin-bottom: var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.views {
		overflow-x: auto;
	}
	.views button {
		flex: 1 0 auto;
		min-height: 36px;
		padding: 0 8px;
		white-space: nowrap;
		border: none;
		border-radius: var(--r1);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.views button.on {
		background: var(--surface);
		font-weight: 600;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
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
