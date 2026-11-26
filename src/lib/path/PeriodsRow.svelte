<script lang="ts">
	import { tx } from '#lib/i18n.js';

	/** T-033: 1М · 3М · 6М · с начала года · 1Г · 3Г · 5Г (· с покупки) — and under each, the same over the market */
	export interface P {
		key: string;
		ret: number | null;
		perYear: number | null;
		excess: number | null;
	}
	let { periods, market }: { periods: P[]; market: string } = $props();
	const LABEL: Record<string, [string, string]> = {
		'1m': ['1М', '1M'],
		'3m': ['3М', '3M'],
		'6m': ['6М', '6M'],
		ytd: ['с нач. года', 'YTD'],
		'1y': ['1Г', '1Y'],
		'3y': ['3Г', '3Y'],
		'5y': ['5Г', '5Y'],
		buy: ['с покупки', 'since buy']
	};
	const pct = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toLocaleString(undefined, { maximumFractionDigits: Math.abs(x) < 0.1 ? 1 : 0 })}%`);
	const pp = (x: number | null) => (x === null ? '' : `${x > 0 ? '+' : ''}${(x * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}`);
</script>

<div class="row" role="list" aria-label={tx('Доходность за периоды', 'Return over periods')}>
	{#each periods as p (p.key)}
		<div class="cell" role="listitem" class:buy={p.key === 'buy'}>
			<span class="k">{tx(...LABEL[p.key])}</span>
			<b class:up={(p.ret ?? 0) > 0} class:down={(p.ret ?? 0) < 0}>{pct(p.ret)}</b>
			{#if p.perYear !== null}<span class="y">{pct(p.perYear)}/{tx('г', 'y')}</span>{/if}
			{#if p.excess !== null}<span class="x" class:up={p.excess > 0} class:down={p.excess < 0} title={tx(`к рынку (${market}), п.п.${p.perYear !== null ? ' в год' : ''}`, `over the market (${market}), pp${p.perYear !== null ? ' a year' : ''}`)}>{pp(p.excess)}</span>{/if}
		</div>
	{/each}
</div>
<p class="note">{tx(`С дивидендами; мелко — к рынку (${market}), п.п.`, `With dividends; small — over the market (${market}), pp.`)}</p>

<style>
	.row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2px;
		border-radius: var(--r2);
		background: var(--bg);
		font-variant-numeric: tabular-nums;
		line-height: 1.15;
	}
	.cell.buy {
		outline: 1px solid var(--accent);
	}
	.k,
	.y,
	.x {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	b {
		font-size: var(--fs-s);
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.x.up,
	.x.down {
		opacity: 0.85;
	}
	.note {
		margin: 4px 0 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
