<script lang="ts">
	import ScoreDot from '#lib/ScoreDot.svelte';
	import { onMount } from 'svelte';
	import TopBar from '#lib/TopBar.svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import ScreenSwitch from '#lib/ScreenSwitch.svelte';
	import RecentCards from '#lib/RecentCards.svelte';
	import TvLink from '#lib/TvLink.svelte';
	import { sectorName } from '#lib/allocation.js';
	import SetCompare from '#lib/sets/SetCompare.svelte';
	import SetMap from '#lib/sets/SetMap.svelte';
	import type { SetItem } from '#lib/sets/types.js';
	import { loc, tx } from '#lib/i18n.js';
	import { keepScroll } from '#lib/scroll.js';

	/**
	 * «Отмеченные» (owner's request 26.11.2026): the securities picked — a model's candidates opened from the model,
	 * any card with ☆ — at one glance: the numbers, a comparison table and their map of ties.
	 */
	let items = $state<SetItem[] | null>(null);
	const scroll = keepScroll(() => 'shortlist');

	async function load() {
		const r = await fetch('/api/shortlist').then((x) => x.json()).catch(() => null);
		items = r?.items ?? [];
		void scroll.restore();
	}
	onMount(load);
	async function unpick(id: number) {
		await fetch('/api/shortlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ securityId: id, on: false }) });
		items = items?.filter((x) => x.id !== id) ?? null;
	}
	const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d).replace('.', tx(',', '.'))}%`);
	const price = (it: SetItem) => (it.price === null ? '—' : it.unit === 'ILA' ? `${(it.price / 100).toLocaleString(loc(), { maximumFractionDigits: 2 })} ₪` : `${it.price.toLocaleString(loc(), { maximumFractionDigits: 2 })} ${it.unit === 'ILS' ? '₪' : '$'}`);
</script>

<svelte:head><title>{tx('Отмеченные', 'Picked')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Отмеченные', 'Picked')} help="shortlist.screen" back={{ href: '/more', label: tx('Ещё', 'More') }} />
<ScreenSwitch />
<RecentCards />

{#if items === null}
	<div class="skeleton"></div>
{:else if !items.length}
	<p class="muted">{tx('Пока ничего не отмечено. Кандидат модели, открытый из модели, отмечается сам; любую бумагу можно отметить ☆ в её карточке.', 'Nothing picked yet. A model\'s candidate opened from the model is picked by that; any security — with ☆ on its card.')}</p>
{:else}
	<a class="asset" href="/charts/picked">{tx('Открыть как набор: график · карта связей · сравнение →', 'Open as a set: chart · map of ties · comparison →')}</a>
	<Fold key="short-list" remind="shortlist.screen" title={tx(`Отмеченные · ${items.length}`, `Picked · ${items.length}`)} summary={items.map((x) => x.symbol).join(' · ')}>
		{#snippet aside()}<HelpIcon topicKey="shortlist.screen" label={tx('отмеченные', 'picked')} />{/snippet}
		<ul class="list">
			{#each items as it (it.id)}
				<li>
					<a class="row" href="/security/{it.id}">
						<span class="who"><b>{it.symbol}</b><ScoreDot id={it.id} /> <span class="muted small">{it.name}</span><span class="muted small block">{it.sector ? sectorName(it.sector, tx) : ''}{it.origin ? ` · ${it.origin}` : ''}</span></span>
						<span class="vals"><b>{price(it)}</b><span class="small" class:up={(it.dayPct ?? 0) > 0} class:down={(it.dayPct ?? 0) < 0}>{pct(it.dayPct)}</span></span>
					</a>
					<span class="side"><TvLink exchange={it.exchange} symbol={it.symbol} /><button class="unpick" aria-label={tx('Снять отметку', 'Unpick')} onclick={() => unpick(it.id)}>★</button></span>
				</li>
			{/each}
		</ul>
	</Fold>

	<Fold key="short-compare" title={tx('Сравнение', 'Comparison')} summary={tx('доходность, оценка, риск, качество', 'return, valuation, risk, quality')} remind="security.stats">
		{#snippet aside()}<HelpIcon topicKey="security.stats" label={tx('показатели', 'ratios')} />{/snippet}
		<SetCompare {items} />
	</Fold>

	{#if items.length}
		<Fold key="short-map" title={tx('Карта связей', 'Map of ties')} remind="portfolio.risk_map">
			{#snippet aside()}<HelpIcon topicKey="portfolio.risk_map" label={tx('карта связей', 'map of ties')} />{/snippet}
			<SetMap {items} storeKey="picked" />
		</Fold>
	{/if}
{/if}

<style>
	.asset {
		display: block;
		margin: var(--s2) 0 var(--s3);
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		color: var(--link);
		text-decoration: none;
		font-size: var(--fs-s);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.block {
		display: block;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: var(--s2);
		border-bottom: 1px solid var(--line);
	}
	.row {
		flex: 1;
		display: flex;
		justify-content: space-between;
		gap: var(--s2);
		padding: var(--s2) 0;
		color: var(--text);
		text-decoration: none;
		min-width: 0;
	}
	.who {
		min-width: 0;
	}
	.vals {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.side {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.unpick {
		border: none;
		background: none;
		font-size: 1.2rem;
		color: var(--warn-text, #b8860b);
		cursor: pointer;
	}
</style>
