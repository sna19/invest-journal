<script lang="ts">
	import { tx, loc } from '#lib/i18n.js';
	import { monthlyReturns, mosaic, over, type MonthPt } from '#lib/path.js';

	/**
	 * T-033: years × months (or quarters) with the year's total; the colour is the size, the months held are outlined;
	 * a tap shows the numbers (and `onpick` — the month on the chart). Fits an iPhone's width: the numbers are by tap.
	 */
	interface Props {
		months: MonthPt[];
		held?: { from: string; to: string | null }[];
		market: string;
		onpick?: (month: string) => void;
	}
	let { months, held = [], market, onpick }: Props = $props();
	let unit = $state<'month' | 'quarter'>('month');
	let rel = $state(false);
	let picked = $state<{ label: string; r: number | null; b: number | null; o: number | null; m: string | null } | null>(null);

	const rets = $derived(monthlyReturns(months));
	const rows = $derived(mosaic(rets, unit, rel, 10));
	const byMonth = $derived(new Map(rets.map((x) => [x.m, x])));
	const isHeld = (y: number, c: number) => {
		const ms = unit === 'month' ? [c + 1] : [c * 3 + 1, c * 3 + 2, c * 3 + 3];
		return ms.some((mo) => {
			const m = `${y}-${String(mo).padStart(2, '0')}`;
			return held.some((h) => m >= h.from.slice(0, 7) && (!h.to || m <= h.to.slice(0, 7)));
		});
	};
	const scale = $derived(unit === 'month' ? 0.1 : 0.2);
	const color = (r: number | null, k = 1) => {
		if (r === null) return 'transparent';
		const a = Math.min(1, Math.abs(r) / (scale * k));
		return `color-mix(in srgb, ${r >= 0 ? 'var(--up)' : 'var(--down)'} ${Math.round(12 + a * 70)}%, var(--surface))`;
	};
	const pct = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
	const MONTHS = $derived(Array.from({ length: 12 }, (_, i) => new Date(2024, i, 1).toLocaleDateString(loc(), { month: 'narrow' })));
	function pick(y: number, c: number | null, r: number | null) {
		if (c === null) return (picked = { label: tx(`${y} год`, `${y}`), r, b: null, o: null, m: null });
		if (unit === 'quarter') return (picked = { label: `Q${c + 1} ${y}`, r, b: null, o: null, m: null });
		const m = `${y}-${String(c + 1).padStart(2, '0')}`;
		const x = byMonth.get(m);
		picked = { label: new Date(y, c, 1).toLocaleDateString(loc(), { month: 'long', year: 'numeric' }), r: x?.r ?? null, b: x?.br ?? null, o: x ? over(x.r, x.br) : null, m };
	}
</script>

<div class="bar">
	<div class="seg" role="radiogroup" aria-label={tx('Месяцы или кварталы', 'Months or quarters')}>
		<button role="radio" aria-checked={unit === 'month'} class:on={unit === 'month'} onclick={() => ((unit = 'month'), (picked = null))}>{tx('месяцы', 'months')}</button>
		<button role="radio" aria-checked={unit === 'quarter'} class:on={unit === 'quarter'} onclick={() => ((unit = 'quarter'), (picked = null))}>{tx('кварталы', 'quarters')}</button>
	</div>
	<div class="seg" role="radiogroup" aria-label={tx('Как есть или к рынку', 'As is or over the market')}>
		<button role="radio" aria-checked={!rel} class:on={!rel} onclick={() => (rel = false)}>{tx('как есть', 'as is')}</button>
		<button role="radio" aria-checked={rel} class:on={rel} onclick={() => (rel = true)}>{tx('к рынку', 'vs market')}</button>
	</div>
</div>

<table class="mz" class:q={unit === 'quarter'}>
	<thead>
		<tr>
			<th></th>
			{#if unit === 'month'}{#each MONTHS as m, i (i)}<th>{m}</th>{/each}{:else}{#each [1, 2, 3, 4] as q (q)}<th>Q{q}</th>{/each}{/if}
			<th>{tx('год', 'yr')}</th>
		</tr>
	</thead>
	<tbody>
		{#each rows as row (row.year)}
			<tr>
				<th>{String(row.year).slice(2)}</th>
				{#each row.cells as r, c (c)}
					<td>
						<button class:held={isHeld(row.year, c)} style:background={color(r)} disabled={r === null} aria-label={`${row.year} ${unit === 'month' ? MONTHS[c] : `Q${c + 1}`}: ${pct(r)}`} onclick={() => pick(row.year, c, r)}>{#if unit === 'quarter' && r !== null}{(r * 100).toFixed(0)}{/if}</button>
					</td>
				{/each}
				<td class="yr"><button style:background={color(row.total, 3)} class:partial={row.partial} aria-label={`${row.year}: ${pct(row.total)}`} onclick={() => pick(row.year, null, row.total)}>{row.total === null ? '' : (row.total * 100).toFixed(0)}</button></td>
			</tr>
		{/each}
	</tbody>
</table>
{#if picked}
	<p class="pick">
		<b>{picked.label}</b>: {pct(picked.r)}{#if rel} {tx('к рынку', 'vs market')}{/if}
		{#if picked.b !== null} · {market} {pct(picked.b)} · {tx('к рынку', 'vs market')} {pct(picked.o)}{/if}
		{#if picked.m && onpick}<button class="link" onclick={() => onpick?.(picked!.m!)}>{tx('на графике', 'on the chart')}</button>{/if}
	</p>
{/if}

<style>
	.bar {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
	}
	.seg {
		flex: 1;
		display: flex;
		gap: 2px;
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
	.mz {
		width: 100%;
		border-collapse: separate;
		border-spacing: 2px;
		table-layout: fixed;
	}
	.mz th {
		font-size: 10px;
		font-weight: 500;
		color: var(--muted);
		text-align: center;
		padding: 0;
	}
	.mz thead th:first-child,
	.mz tbody th {
		width: 1.6em;
	}
	.mz thead th:last-child {
		width: 2.4em;
	}
	td {
		padding: 0;
	}
	td button {
		display: block;
		width: 100%;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 3px;
		font-size: 10px;
		color: var(--text);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}
	.q td button {
		height: 24px;
		font-size: 11px;
	}
	td button:disabled {
		background: var(--bg) !important;
		cursor: default;
	}
	td button.held {
		box-shadow: inset 0 0 0 1.5px var(--text);
	}
	.yr button {
		font-weight: 600;
	}
	.yr button.partial {
		font-style: italic;
		opacity: 0.8;
	}
	.pick {
		margin: 6px 0 0;
		font-size: var(--fs-xs);
	}
	.link {
		margin-left: 6px;
		border: none;
		background: none;
		color: var(--accent);
		font-size: var(--fs-xs);
		cursor: pointer;
		padding: 0;
	}
</style>
