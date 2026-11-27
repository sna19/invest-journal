<script lang="ts">
	import { onMount } from 'svelte';
	import Fold from './Fold.svelte';
	import HelpIcon from './HelpIcon.svelte';
	import SortHead from './SortHead.svelte';
	import { TableSort } from './tablesort.svelte.js';
	import { sectorName } from './allocation.js';
	import { loc, tx } from './i18n.js';

	/**
	 * Owner 27.11.2026: «список всех секторов, равно как и список всех индексов» — on «Тикеры». Sectors and industries
	 * of both markets with their companies in the base, each opens its page; the indices by the ETFs that track them.
	 */
	type Etf = { id: number; symbol: string; y1: number | null } | null;
	interface Catalog {
		sectors: { market: 'US' | 'IL'; key: string; count: number; industries: number; etf: Etf }[];
		industries: { market: 'US' | 'IL'; name: string; sector: string; count: number }[];
		indices: { market: 'US' | 'IL'; label: string; symbol: string; etf: Etf }[];
	}
	let c = $state<Catalog | null>(null);
	onMount(async () => (c = await fetch('/api/sectors/catalog').then((r) => (r.ok ? r.json() : null)).catch(() => null)));

	const secSort = new TableSort<'name' | 'count' | 'industries' | 'y1'>('count');
	const indSort = new TableSort<'name' | 'count'>('count');
	const ixSort = new TableSort<'name' | 'y1'>();
	let indLimit = $state(30);
	let indQ = $state('');
	const mk = (m: 'US' | 'IL') => (m === 'US' ? tx('США', 'US') : 'TASE');
	const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`);
	const sectors = $derived(c ? secSort.rows(c.sectors, (s, k) => (k === 'name' ? sectorName(s.key, tx) : k === 'y1' ? s.etf?.y1 : s[k])) : []);
	const industries = $derived.by(() => {
		if (!c) return [];
		const q = indQ.trim().toLowerCase();
		const list = q ? c.industries.filter((i) => `${i.name} ${sectorName(i.sector, tx)}`.toLowerCase().includes(q)) : c.industries;
		return indSort.rows(list, (i, k) => (k === 'name' ? i.name : i.count));
	});
	const indices = $derived(c ? ixSort.rows(c.indices, (i, k) => (k === 'name' ? i.label : i.etf?.y1)) : []);
</script>

{#if c}
	<Fold key="tickers-sectors" remind="sector.screen" title={`${tx('Секторы', 'Sectors')} · ${c.sectors.length}`} open={false} summary={tx('тап — страница сектора', 'a tap — the sector\'s page')}>
		{#snippet aside()}<HelpIcon topicKey="sector.screen" label={tx('сектор', 'sector')} />{/snippet}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th><SortHead s={secSort} k="name" desc={false}>{tx('Сектор', 'Sector')}</SortHead></th>
						<th><SortHead s={secSort} k="count">{tx('Компаний', 'Companies')}</SortHead></th>
						<th><SortHead s={secSort} k="industries">{tx('Отраслей', 'Industries')}</SortHead></th>
						<th><SortHead s={secSort} k="y1" title={tx('ETF сектора за год', 'the sector ETF over a year')}>ETF 1Г</SortHead></th>
					</tr>
				</thead>
				<tbody>
					{#each sectors as s (`${s.market}|${s.key}`)}
						<tr>
							<th><a href="/sector?sector={s.key}&country={s.market}">{sectorName(s.key, tx)}</a> <span class="muted">{mk(s.market)}</span></th>
							<td>{s.count}</td>
							<td>{s.industries}</td>
							<td class:up={(s.etf?.y1 ?? 0) > 0} class:down={(s.etf?.y1 ?? 0) < 0}>{#if s.etf}<a class="etf" href="/security/{s.etf.id}">{s.etf.symbol}</a> {pct(s.etf.y1)}{:else}—{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</Fold>

	<Fold key="tickers-industries" remind="sector.screen" title={`${tx('Отрасли', 'Industries')} · ${c.industries.length}`} open={false} summary={tx('тап — страница отрасли', 'a tap — the industry\'s page')}>
		<input class="q" type="search" bind:value={indQ} placeholder={tx('Найти отрасль: Semiconductors, Banks…', 'Find an industry: Semiconductors, Banks…')} />
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th><SortHead s={indSort} k="name" desc={false}>{tx('Отрасль', 'Industry')}</SortHead></th>
						<th><SortHead s={indSort} k="count">{tx('Компаний', 'Companies')}</SortHead></th>
					</tr>
				</thead>
				<tbody>
					{#each industries.slice(0, indLimit) as i (`${i.market}|${i.name}`)}
						<tr>
							<th><a href="/sector?sector={i.sector}&industry={encodeURIComponent(i.name)}&country={i.market}">{i.name}</a> <span class="muted">{sectorName(i.sector, tx)} · {mk(i.market)}</span></th>
							<td>{i.count}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if industries.length > indLimit}<button class="more" onclick={() => (indLimit += 50)}>{tx(`Показать ещё — осталось ${industries.length - indLimit}`, `Show more — ${industries.length - indLimit} left`)}</button>{/if}
	</Fold>

	<Fold key="tickers-indices" remind="sector.screen" title={`${tx('Индексы', 'Indices')} · ${c.indices.length}`} open={false} summary={c.indices.map((i) => i.label).join(' · ')}>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th><SortHead s={ixSort} k="name" desc={false}>{tx('Индекс', 'Index')}</SortHead></th>
						<th>{tx('Через ETF', 'Via ETF')}</th>
						<th><SortHead s={ixSort} k="y1">1Г</SortHead></th>
					</tr>
				</thead>
				<tbody>
					{#each indices as i (i.symbol)}
						<tr>
							<th>{i.label} <span class="muted">{mk(i.market)}</span></th>
							<td><a class="etf" href="/security/{i.etf!.id}">{i.etf!.symbol}</a></td>
							<td class:up={(i.etf?.y1 ?? 0) > 0} class:down={(i.etf?.y1 ?? 0) < 0}>{pct(i.etf?.y1)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small">{tx('Индекс нельзя купить напрямую — его повторяет ETF; карточка ETF показывает график, состав и сравнение.', 'An index cannot be bought directly — an ETF tracks it; the ETF\'s card shows its chart, holdings and comparison.')}</p>
	</Fold>
{/if}

<style>
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 6px 4px;
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	thead th {
		color: var(--muted);
		font-weight: 600;
	}
	tbody th,
	thead th:first-child {
		text-align: left;
		white-space: normal;
	}
	tbody th {
		font-weight: 400;
	}
	tbody th a {
		color: var(--text);
		font-weight: 600;
	}
	.etf {
		color: var(--link);
		margin-right: 4px;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.q {
		width: 100%;
		box-sizing: border-box;
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
		margin-bottom: var(--s2);
	}
	.more {
		width: 100%;
		min-height: 38px;
		margin-top: var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
</style>
