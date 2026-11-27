<script lang="ts">
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { tx } from '#lib/i18n.js';
	import { money } from '#lib/portfolio.js';
	import type { MonthPt } from '#lib/path.js';
	import PeriodsRow, { type P } from './PeriodsRow.svelte';
	import Mosaic from './Mosaic.svelte';

	/**
	 * T-033, a portfolio: the periods and the mosaic by its time-weighted return in its currency, against its market;
	 * the positions' contribution by year (the gain of the year over the portfolio's value at its start).
	 */
	let { portfolioId, version = 0 }: { portfolioId: number; version?: number } = $props();
	type V = { currency: string; market: string; periods: P[]; months: MonthPt[]; years: number[]; contrib: { positionId: number; symbol: string; cells: ({ gain: number; pp: number | null } | null)[] }[] };
	let v = $state<V | null>(null);
	let pp = $state(true);
	$effect(() => {
		void portfolioId;
		void version;
		fetch(`/api/path?portfolio=${portfolioId}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => (v = j && !j.empty ? j : null))
			.catch(() => (v = null));
	});
	const shownYears = $derived(v ? v.years.slice(-4) : []);
	const off = $derived(v ? v.years.length - shownYears.length : 0);
	const rows = $derived(v ? [...v.contrib].filter((r) => r.cells.slice(off).some((c) => c)).sort((a, b) => Math.abs(b.cells.at(-1)?.gain ?? 0) - Math.abs(a.cells.at(-1)?.gain ?? 0)) : []);
	const cell = (c: { gain: number; pp: number | null } | null) =>
		c === null ? '' : pp ? (c.pp === null ? '—' : `${c.pp > 0 ? '+' : ''}${c.pp.toLocaleString(undefined, { maximumFractionDigits: 1 })}`) : money(c.gain, v!.currency, true);
</script>

{#if v && v.months.length > 1}
	<Fold key="portfolio-path" title={tx('Как набиралась прибыль', 'How the profit was made')} open={false} remind="stock.periods">
		{#snippet aside()}<HelpIcon topicKey="stock.periods" label={tx('периоды', 'periods')} />{/snippet}
		<PeriodsRow periods={v.periods} market={v.market} />
		<h3>{tx('Мозаика по месяцам', 'Mosaic by month')} <HelpIcon topicKey="stock.monthly" label={tx('мозаика', 'mosaic')} /></h3>
		<Mosaic months={v.months} market={v.market} />
		<h3>{tx('Вклад позиций по годам', 'The positions\' contribution by year')} <HelpIcon topicKey="stock.return_path" label={tx('вклад', 'contribution')} /></h3>
		<div class="seg" role="radiogroup" aria-label={tx('В п.п. или в деньгах', 'In pp or in money')}>
			<button role="radio" aria-checked={pp} class:on={pp} onclick={() => (pp = true)}>{tx('п.п. портфеля', 'pp of the portfolio')}</button>
			<button role="radio" aria-checked={!pp} class:on={!pp} onclick={() => (pp = false)}>{tx('деньги', 'money')}</button>
		</div>
		<div class="scroll">
			<table>
				<thead><tr><th></th>{#each shownYears as y (y)}<th>{y}</th>{/each}</tr></thead>
				<tbody>
					{#each rows as r (r.positionId)}
						<tr><td>{r.symbol}</td>{#each r.cells.slice(off) as c, i (i)}<td class:up={(c?.gain ?? 0) > 0} class:down={(c?.gain ?? 0) < 0}>{cell(c)}</td>{/each}</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="note">{tx('Вклад года — прибыль позиции за год (стоимость на конец и продажи минус стоимость на начало и покупки, без дивидендов) к стоимости портфеля на начало года.', 'A year\'s contribution — the position\'s gain of the year (its value at the end and its sales less its value at the start and its purchases, without dividends) over the portfolio\'s value at the year\'s start.')}</p>
	</Fold>
{/if}

<style>
	h3 {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: var(--s4) 0 var(--s2);
		font-size: var(--fs-m);
	}
	.seg {
		display: flex;
		gap: 2px;
		margin-bottom: 6px;
	}
	.seg button {
		flex: 1;
		min-height: 32px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.seg button.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	th {
		font-weight: 500;
		color: var(--muted);
		text-align: right;
	}
	td {
		padding: 4px 3px;
		border-top: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	td:first-child {
		text-align: left;
		font-weight: 600;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.note {
		margin: 6px 0 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
