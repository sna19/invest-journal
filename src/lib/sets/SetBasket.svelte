<script lang="ts">
	import { tx } from '../i18n.js';
	import LineChart, { type Line } from '../charts/LineChart.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import type { SetItem } from './types.js';

	/**
	 * Owner 27.11.2026, a set's «Корзина»: every security bought for the same money at the start of 1 / 3 / 5 years and
	 * held — the basket against the index, a year on average, the worst drawdown, and who made the result.
	 */
	let { items }: { items: SetItem[] } = $props();
	type B = {
		points: { date: string; value: number }[];
		bench: { date: string; value: number }[];
		benchLabel: string | null;
		total: number | null;
		benchTotal: number | null;
		perYear: number | null;
		maxDrawdown: number | null;
		benchDrawdown: number | null;
		parts: { id: number; symbol: string; ret: number; part: number }[];
		left: { id: number; symbol: string }[];
	};
	let years = $state(1);
	let b = $state<B | null>(null);
	$effect(() => {
		const ids = items.map((x) => x.id);
		const y = years;
		b = null;
		fetch(`/api/sets/basket?ids=${ids.join(',')}&years=${y}`)
			.then((r) => r.json())
			.then((j) => (b = j))
			.catch(() => (b = null));
	});
	const css = (n: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(n).trim());
	const lines = $derived<Line[]>(b ? [{ key: 'basket', label: tx('Корзина', 'Basket'), points: b.points, main: true }, ...(b.bench.length ? [{ key: 'bench', label: b.benchLabel ?? '', points: b.bench, color: css('--muted'), dashed: true }] : [])] : []);
	const pct = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1).replace('.', tx(',', '.'))}%`);
</script>

<div class="yrs" role="radiogroup" aria-label={tx('Период', 'Period')}>
	{#each [1, 3, 5] as y (y)}<button role="radio" aria-checked={years === y} class:on={years === y} onclick={() => (years = y)}>{tx(`${y} г.`, `${y}y`)}</button>{/each}
	<HelpIcon topicKey="charts.saved" label={tx('корзина', 'basket')} />
</div>

{#if !b}
	<div class="skeleton"></div>
{:else if !b.points.length}
	<p class="muted small">{tx('Ни у одной бумаги набора нет цен с начала периода.', 'No security of the set has prices from the start of the period.')}</p>
{:else}
	<div class="sum">
		<div><span class="k">{tx('Корзина', 'Basket')}</span><b class:up={(b.total ?? 0) > 0} class:down={(b.total ?? 0) < 0}>{pct(b.total)}</b>{#if b.perYear !== null && years > 1}<span class="k">{pct(b.perYear)} {tx('в год', 'a year')}</span>{/if}</div>
		{#if b.benchLabel}<div><span class="k">{b.benchLabel}</span><b>{pct(b.benchTotal)}</b><span class="k">{tx('сверх рынка', 'over the market')} {pct(b.total !== null && b.benchTotal !== null ? Math.round((b.total - b.benchTotal) * 10) / 10 : null)}</span></div>{/if}
		<div><span class="k">{tx('Худшая просадка', 'Worst drawdown')}</span><b class="down">{pct(b.maxDrawdown)}</b>{#if b.benchDrawdown !== null}<span class="k">{b.benchLabel}: {pct(b.benchDrawdown)}</span>{/if}</div>
	</div>
	<LineChart {lines} height={220} format={(v) => `${Math.round(v - 100)}%`} />
	<p class="k">{tx('Кто сделал результат (вклад = доходность бумаги / число бумаг):', 'Who made the result (part = the security\'s return / the number of securities):')}</p>
	<ul class="parts">
		{#each b.parts as p (p.id)}
			<li><a href="/security/{p.id}">{p.symbol}</a><span class:up={p.ret > 0} class:down={p.ret < 0}>{pct(p.ret)}</span><span class="muted">{tx('вклад', 'part')} {pct(p.part)}</span></li>
		{/each}
	</ul>
	{#if b.left.length}<p class="muted small">{tx('Без цен с начала периода, не в корзине', 'No prices from the start of the period, not in the basket')}: {b.left.map((x) => x.symbol).join(', ')}.</p>{/if}
	<p class="muted small">{tx('Поровну в начале периода и держать, без перебалансировки; цены с дивидендами и сплитами; без комиссий и налогов. Это прошлое, не прогноз — но видно, был ли набор лучше простого индекса и что пришлось бы пережить.', 'Equal money at the start and held, no rebalancing; prices with dividends and splits; no fees or taxes. The past, not a forecast — but it shows whether the set beat a plain index and what holding it meant living through.')}</p>
{/if}

<style>
	.yrs {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: var(--s3);
	}
	.yrs button {
		min-height: 32px;
		padding: 0 14px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.yrs button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.sum {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s3) var(--s4);
		margin-bottom: var(--s3);
	}
	.sum > div {
		display: flex;
		flex-direction: column;
	}
	.sum b {
		font-size: var(--fs-l);
		font-variant-numeric: tabular-nums;
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.parts {
		list-style: none;
		margin: var(--s2) 0;
		padding: 0;
		font-size: var(--fs-s);
	}
	.parts li {
		display: flex;
		gap: var(--s3);
		padding: 4px 0;
		border-bottom: 1px solid var(--line);
		font-variant-numeric: tabular-nums;
	}
	.parts a {
		min-width: 5em;
		font-weight: 600;
		color: var(--text);
		text-decoration: none;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.skeleton {
		height: 220px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
</style>
