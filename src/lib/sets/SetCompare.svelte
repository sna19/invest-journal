<script lang="ts">
	import { tx } from '../i18n.js';
	import SortHead from '../SortHead.svelte';
	import { TableSort } from '../tablesort.svelte.js';
	import type { SetItem } from './types.js';

	/**
	 * A set's comparison table (the picked ones, a saved set): returns, valuation, risk, quality; a tap on a header
	 * sorts. The ratios come 8 a call from the provider — asked until all are there.
	 */
	let { items }: { items: SetItem[] } = $props();
	type Stat = Record<string, number | string | boolean | null>;
	let stats = $state<Record<number, Stat | null>>({});
	$effect(() => {
		const ids = items.map((x) => x.id);
		if (!ids.length) return;
		void (async () => {
			for (let k = 0; k < 5; k++) {
				const s = await fetch(`/api/ratios?ids=${ids.join(',')}`).then((x) => x.json()).catch(() => null);
				const got = s?.items ?? {};
				stats = Object.fromEntries(Object.entries(got).map(([id, v]) => [Number(id), ((v as { stats: Stat | null; swings?: Stat }).stats ?? (v as { swings?: Stat }).swings ?? null) as Stat | null]));
				if (ids.every((id) => id in got)) break;
			}
		})();
	});
	const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d).replace('.', tx(',', '.'))}%`);
	const num = (x: unknown, d = 1) => (typeof x === 'number' ? x.toFixed(d).replace('.', tx(',', '.')) : '—');
	const frac = (x: unknown, d = 0) => (typeof x === 'number' ? `${(x * 100).toFixed(d).replace('.', tx(',', '.'))}%` : '—');
	const cap = (x: number | null) => (x === null ? '—' : x >= 1e12 ? `${(x / 1e12).toFixed(1)} ${tx('трлн', 'T')}` : x >= 1e9 ? `${Math.round(x / 1e9)} ${tx('млрд', 'B')}` : `${Math.round(x / 1e6)} ${tx('млн', 'M')}`);
	const st = (it: SetItem, k: string) => (typeof stats[it.id]?.[k] === 'number' ? (stats[it.id]![k] as number) : null);
	const COLS: { key: string; ru: string; en: string; get: (it: SetItem) => number | null; fmt: (it: SetItem) => string; asc?: boolean }[] = [
		{ key: 'dayPct', ru: 'День', en: 'Day', get: (it) => it.dayPct, fmt: (it) => pct(it.dayPct) },
		{ key: 'm1', ru: '1М', en: '1M', get: (it) => it.m1, fmt: (it) => pct(it.m1) },
		{ key: 'm3', ru: '3М', en: '3M', get: (it) => it.m3, fmt: (it) => pct(it.m3) },
		{ key: 'y1', ru: '1Г', en: '1Y', get: (it) => it.y1, fmt: (it) => pct(it.y1) },
		{ key: 'pe', ru: 'P/E', en: 'P/E', get: (it) => st(it, 'pe'), fmt: (it) => num(stats[it.id]?.pe), asc: true },
		{ key: 'ps', ru: 'P/S', en: 'P/S', get: (it) => st(it, 'ps'), fmt: (it) => num(stats[it.id]?.ps), asc: true },
		{ key: 'beta', ru: 'Бета (β)', en: 'Beta (β)', get: (it) => st(it, 'beta'), fmt: (it) => num(stats[it.id]?.beta, 2), asc: true },
		{ key: 'vol', ru: 'Колеб. (HV)', en: 'Swings (HV)', get: (it) => st(it, 'vol1y'), fmt: (it) => frac(stats[it.id]?.vol1y), asc: true },
		{ key: 'margin', ru: 'Маржа (NPM)', en: 'Margin (NPM)', get: (it) => st(it, 'profitMargin'), fmt: (it) => frac(stats[it.id]?.profitMargin) },
		{ key: 'roe', ru: 'ROE', en: 'ROE', get: (it) => st(it, 'roe'), fmt: (it) => frac(stats[it.id]?.roe) },
		{ key: 'growth', ru: 'Рост выручки', en: 'Revenue growth', get: (it) => st(it, 'revenueGrowth'), fmt: (it) => frac(stats[it.id]?.revenueGrowth) },
		{ key: 'div', ru: 'Дивиденды (DY)', en: 'Dividend (DY)', get: (it) => st(it, 'dividendYield'), fmt: (it) => frac(stats[it.id]?.dividendYield, 1) },
		{ key: 'cap', ru: 'Капитализация', en: 'Market cap', get: (it) => it.capUsd, fmt: (it) => cap(it.capUsd) }
	];
	const sort = new TableSort<string>('y1');
	const rows = $derived(sort.rows(items, (it, k) => (k === 'symbol' ? it.symbol : (COLS.find((c) => c.key === k)?.get(it) ?? null))));
</script>

<div class="scroll">
	<table class="cmp">
		<thead>
			<tr>
				<th><SortHead s={sort} k="symbol" desc={false}>{tx('Бумага', 'Security')}</SortHead></th>
				{#each COLS as col (col.key)}<th class:sel={sort.key === col.key}><SortHead s={sort} k={col.key} desc={!col.asc}>{tx(col.ru, col.en)}</SortHead></th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as it (it.id)}
				<tr>
					<th><a href="/security/{it.id}">{it.symbol}</a></th>
					{#each COLS as col (col.key)}<td class:sel={sort.key === col.key}>{col.fmt(it)}</td>{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="muted small">{tx('Тап по заголовку — сортировка. Для бумаг TASE оценочные коэффициенты скрыты (Yahoo смешивает агороты и доллары).', 'Tap a header to sort. For TASE securities the price ratios are hidden (Yahoo mixes agorot and dollars).')}</p>

<style>
	.scroll {
		overflow-x: auto;
	}
	.cmp {
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.cmp th,
	.cmp td {
		padding: 5px 6px;
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	.cmp thead th {
		color: var(--muted);
		font-weight: 600;
	}
	.cmp th:first-child {
		text-align: left;
		position: sticky;
		left: 0;
		background: var(--surface);
	}
	.cmp .sel {
		font-weight: 600;
	}
	.cmp a {
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
</style>
