<script lang="ts">
	import Fold from '#lib/Fold.svelte';
	import ChartBar from '@lucide/svelte/icons/chart-bar-big';
	import ChartPie from '@lucide/svelte/icons/chart-pie';
	import HelpIcon from '../HelpIcon.svelte';
	import { allocate, METRICS, METRIC_LABEL, SCOPED, type AllocPosition, type AllocRow, type Metric, type Scope } from '../allocation.js';
	import { tx } from '../i18n.js';
	import { money } from '../portfolio.js';

	/**
	 * Section 19 «Распределение», widened (owner's request 19.11.2026): one measure at a time — chips above —
	 * as bars or as a pie; the choice of both is remembered on the device.
	 */
	interface Props {
		positions: AllocPosition[];
		cash: number;
		currency: string;
	}
	let { positions, cash, currency }: Props = $props();

	const read = (k: string, d: string) => {
		try {
			return localStorage.getItem(k) ?? d;
		} catch {
			return d;
		}
	};
	const keep = (k: string, v: string) => {
		try {
			localStorage.setItem(k, v);
		} catch {
			/* private mode */
		}
	};
	let metric = $state<Metric>((METRICS as string[]).includes(read('alloc-metric', 'security')) ? (read('alloc-metric', 'security') as Metric) : 'security');
	let pie = $state(read('alloc-view', 'bars') === 'pie');
	const setMetric = (m: Metric) => ((metric = m), keep('alloc-metric', m), (open = null));
	const setPie = (on: boolean) => ((pie = on), keep('alloc-view', on ? 'pie' : 'bars'));
	// owner 28.11.2026: the stocks only or the funds only; a tap on a slice lists who is in it
	let scope = $state<Scope>((['all', 'stock', 'etf'] as string[]).includes(read('alloc-scope', 'all')) ? (read('alloc-scope', 'all') as Scope) : 'all');
	const setScope = (s: Scope) => ((scope = s), keep('alloc-scope', s), (open = null));
	let open = $state<string | null>(null);
	const toggle = (k: string) => ((open = open === k ? null : k), (hover = open));

	const labels = $derived(METRIC_LABEL(tx));
	const a = $derived(allocate(metric, positions, cash, tx, scope));
	// colour follows the row's place among the coloured rows; grey rows (cash, others, no data) stay grey
	const colorOf = (i: number, muted: boolean) => (muted ? 'var(--series-muted)' : `var(--series-${(i % 8) + 1})`);
	const rows = $derived(
		(() => {
			let n = 0;
			return a.rows.map((r) => ({ ...r, color: colorOf(r.muted ? 0 : n++, r.muted) }));
		})()
	);

	// the pie: a ring of arcs with a 2px gap of the surface between them
	const R = 70;
	const r0 = 44;
	const arcs = $derived(
		(() => {
			let at = -Math.PI / 2;
			return rows
				.filter((r) => r.pct > 0)
				.map((r) => {
					const span = (r.pct / 100) * Math.PI * 2;
					const from = at;
					at += span;
					return { ...r, d: arc(from, at) };
				});
		})()
	);
	function arc(a0: number, a1: number) {
		if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
		const large = a1 - a0 > Math.PI ? 1 : 0;
		const p = (r: number, a: number) => `${(R + r * Math.cos(a)).toFixed(2)} ${(R + r * Math.sin(a)).toFixed(2)}`;
		return `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
	}
	let hover = $state<string | null>(null);
	const hovered = $derived(rows.find((r) => r.key === hover) ?? null);
</script>

{#snippet who(r: AllocRow)}
	{#if r.members.length}
		<ul class="who">
			{#each r.members as m (m.symbol)}
				<li>
					{#if m.securityId}<a href="/security/{m.securityId}">{m.symbol}</a>{:else}<b>{m.symbol}</b>{/if}
					<span class="wv">{money(Math.round(m.value), currency)}</span>
					<span class="wp">{Math.round((m.value / r.value) * 100)}% {tx('куска', 'of it')}</span>
					{#if m.part < 0.995}<span class="wf">{tx(`${Math.round(m.part * 100)}% фонда`, `${Math.round(m.part * 100)}% of the fund`)}</span>{/if}
				</li>
			{/each}
		</ul>
	{:else if r.key === 'cash'}
		<p class="note">{tx('Деньги на счёте.', 'Cash in the account.')}</p>
	{/if}
{/snippet}

<Fold key="portfolio-allocation" remind="portfolio.allocation" title={tx('Распределение', 'Allocation')} summary={labels[metric]}>
	{#snippet aside()}
		<HelpIcon topicKey="portfolio.allocation" label={tx('распределение', 'allocation')} />
		<div class="view" role="radiogroup" aria-label={tx('Вид графика', 'Chart view')}>
			<button role="radio" aria-checked={!pie} class:on={!pie} onclick={() => setPie(false)} title={tx('Полосы', 'Bars')} aria-label={tx('Полосы', 'Bars')}><ChartBar size={16} /></button>
			<button role="radio" aria-checked={pie} class:on={pie} onclick={() => setPie(true)} title={tx('Круг', 'Pie')} aria-label={tx('Круг', 'Pie')}><ChartPie size={16} /></button>
		</div>
	{/snippet}

	<div class="metrics" role="radiogroup" aria-label={tx('Мера распределения', 'Allocation measure')}>
		{#each METRICS as m (m)}
			<button role="radio" aria-checked={metric === m} class:on={metric === m} onclick={() => setMetric(m)}>{labels[m]}</button>
		{/each}
	</div>

	{#if SCOPED.includes(metric)}
		<div class="scope" role="radiogroup" aria-label={tx('Что считать', 'What to count')}>
			{#each [['all', 'Все', 'All'], ['stock', 'Только акции', 'Stocks only'], ['etf', 'Только фонды', 'Funds only']] as [k, ru, en] (k)}
				<button role="radio" aria-checked={scope === k} class:on={scope === k} onclick={() => setScope(k as Scope)}>{tx(ru, en)}</button>
			{/each}
		</div>
	{/if}


	{#if pie}
		<div class="pie">
			<svg viewBox="0 0 {R * 2} {R * 2}" role="img" aria-label="{labels[metric]}: {rows.map((r) => `${r.label} ${Math.round(r.pct)}%`).join(', ')}">
				{#each arcs as s (s.key)}
					<path
						d={s.d}
						fill={s.color}
						class:dim={hover !== null && hover !== s.key}
						role="presentation"
						onpointerenter={() => (hover = s.key)}
						onpointerleave={() => (hover = null)}
						onclick={() => toggle(s.key)}
					/>
				{/each}
				<text x={R} y={R - 4} class="c1">{hovered ? `${Math.round(hovered.pct)}%` : money(a.total, currency)}</text>
				<text x={R} y={R + 12} class="c2">{hovered ? hovered.label.slice(0, 18) : tx('всего', 'total')}</text>
			</svg>
		</div>
		<ul class="legend">
			{#each rows as r (r.key)}
				<li class:hl={hover === r.key || open === r.key}>
					<button onclick={() => toggle(r.key)} aria-expanded={open === r.key}>
						<i style:background={r.color}></i><span class="bl">{r.label}</span><span class="bv">{money(Math.round(r.value), currency)}</span><span class="bp">{r.pct < 1 && r.pct > 0 ? '<1' : Math.round(r.pct)}%</span>
					</button>
					{#if open === r.key}{@render who(r)}{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="bars">
			{#each rows as r (r.key)}
				<li title="{r.label}: {money(Math.round(r.value), currency)}" class:hl={open === r.key}>
					<button class="brow" onclick={() => toggle(r.key)} aria-expanded={open === r.key}>
						<span class="bl">{r.label}</span>
						<span class="bp">{r.pct < 1 && r.pct > 0 ? '<1' : Math.round(r.pct)}%</span>
						<span class="bar"><span style:width="{Math.max(1, r.pct)}%" style:background={r.color}></span></span>
					</button>
					{#if open === r.key}{@render who(r)}{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if a.unknown && metric !== 'security' && metric !== 'market' && metric !== 'currency' && metric !== 'result' && metric !== 'type'}
		<p class="note">{tx('«Нет данных» — профиль бумаги ещё не загружен (обычно в течение нескольких минут) или его нет у поставщика.', '«No data» — the security profile is not loaded yet (usually within minutes) or the provider does not have it.')}</p>
	{/if}
	<p class="note">{tx('Тап по куску — какие бумаги в нём.', 'Tap a slice — which securities are in it.')}{#if scope !== 'all' && SCOPED.includes(metric)} {tx('Проценты — от акций или фондов, без денег.', 'Percents — of the stocks or the funds, cash aside.')}{/if}</p>
	{#if metric === 'sector' && positions.some((p) => p.profile?.sectorWeights)}
		<p class="note">{tx('Фонды разложены по секторам по своему составу.', 'Funds are split across sectors by what they hold.')}</p>
	{/if}
</Fold>

<style>
	.scope {
		display: flex;
		gap: 4px;
		margin: calc(-1 * var(--s2)) 0 var(--s3);
	}
	.scope button {
		flex: 1;
		min-height: 30px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.scope button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.who {
		list-style: none;
		margin: 4px 0 8px;
		padding: 6px 10px;
		border-radius: var(--r2);
		background: var(--surface-2);
		font-size: var(--fs-xs);
	}
	.who li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		padding: 3px 0;
	}
	.who a {
		min-width: 4.5em;
		font-weight: 700;
		color: var(--link);
		text-decoration: none;
	}
	.wv {
		font-variant-numeric: tabular-nums;
	}
	.wp,
	.wf {
		color: var(--muted);
	}
	.brow {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: 1fr auto;
		row-gap: 3px;
		column-gap: var(--s2);
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.bars .who {
		grid-column: 1 / -1;
	}
	.view {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		overflow: hidden;
	}
	.view button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 32px;
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.view button.on {
		background: var(--text);
		color: var(--bg);
	}
	.metrics {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		margin: var(--s3) calc(-1 * var(--s4)) var(--s3);
		padding: 0 var(--s4) 2px;
		scrollbar-width: none;
	}
	.metrics button {
		flex: none;
		min-height: 34px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.metrics button.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
	}
	.bars,
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.bars {
		gap: 10px;
	}
	/* the label and the share on one line, the bar under them: long sector names stay whole */
	.bars li {
		display: grid;
		grid-template-columns: 1fr auto;
		row-gap: 3px;
		column-gap: var(--s2);
		font-size: var(--fs-s);
	}
	.bars .bar {
		grid-column: 1 / -1;
	}
	.bl {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bar {
		height: 10px;
		border-radius: 5px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		border-radius: 5px;
	}
	.bp,
	.bv {
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.pie {
		display: flex;
		justify-content: center;
		margin-bottom: var(--s3);
	}
	.pie svg {
		width: 180px;
		height: 180px;
	}
	.pie path {
		stroke: var(--surface);
		stroke-width: 2;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.pie path.dim {
		opacity: 0.35;
	}
	.c1,
	.c2 {
		text-anchor: middle;
		fill: var(--text);
	}
	.c1 {
		font-size: 14px;
		font-weight: 700;
	}
	.c2 {
		font-size: 9px;
		fill: var(--muted);
	}
	.legend button {
		display: grid;
		grid-template-columns: 12px 1fr auto 40px;
		align-items: center;
		gap: var(--s2);
		width: 100%;
		min-height: 30px;
		padding: 0 4px;
		border: none;
		border-radius: var(--r1);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		text-align: left;
		cursor: pointer;
	}
	.legend li.hl button {
		background: var(--surface-2);
	}
	.legend i {
		width: 12px;
		height: 12px;
		border-radius: 3px;
	}
	.note {
		margin: var(--s3) 0 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
