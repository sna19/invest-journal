<script lang="ts">
	import Fold from './Fold.svelte';
	import HelpIcon from './HelpIcon.svelte';
	import { loc, tx } from './i18n.js';
	import { priceText } from './portfolio.js';

	/**
	 * Owner 28.11.2026: a security's dividend history — each year a share with the change against the year before (a
	 * growing payment or a falling one), the years in a row it grew, the cuts, the average growth over 5 and 10 years,
	 * and the payments of the last two years.
	 */
	let { securityId, priceUnit }: { securityId: number; priceUnit: string } = $props();
	type H = {
		years: { year: string; total: number; payments: number; partial: boolean; change: number | null }[];
		payments: { date: string; amount: number }[];
		growthYears: number;
		cuts: string[];
		cagr5: number | null;
		cagr10: number | null;
		ttm: number;
		yieldNow: number | null;
	};
	let h = $state<H | null>(null);
	$effect(() => {
		fetch(`/api/securities/${securityId}/dividends`)
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => (h = j))
			.catch(() => (h = null));
	});
	const max = $derived(h ? Math.max(...h.years.map((y) => y.total), 1e-9) : 1);
	const p = (x: number | null) => (x === null ? '' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`);
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: '2-digit' });
	const summary = $derived(
		h && h.years.length
			? [h.yieldNow !== null ? `DY ${h.yieldNow.toLocaleString(loc())}%` : '', h.growthYears ? tx(`растёт ${h.growthYears} г.`, `grows ${h.growthYears} y`) : '', h.cuts.length ? tx(`урезан в ${h.cuts.at(-1)}`, `cut in ${h.cuts.at(-1)}`) : ''].filter(Boolean).join(' · ')
			: undefined
	);
</script>

{#if h && h.years.length}
	<Fold key="sec-dividends" remind="portfolio.dividends" title={tx('Дивиденды по годам', 'Dividends by year')} {summary} open={false}>
		{#snippet aside()}<HelpIcon topicKey="portfolio.dividends" label={tx('дивиденды', 'dividends')} />{/snippet}
		<p class="small">
			{tx('За 12 мес.', '12 months')} <b>{priceText(h.ttm, priceUnit)}</b> {tx('на акцию', 'a share')}{#if h.yieldNow !== null} · DY <b>{h.yieldNow.toLocaleString(loc())}%</b>{/if}
			· {tx('рост подряд', 'growth in a row')}: <b>{h.growthYears} {tx('г.', 'y')}</b>
			{#if h.cagr5 !== null} · {tx('в среднем за 5 лет', 'a year over 5 years')} <b class:up={h.cagr5 > 0} class:down={h.cagr5 < 0}>{p(h.cagr5)}</b>{/if}
			{#if h.cagr10 !== null} · {tx('за 10 лет', 'over 10 years')} <b class:up={h.cagr10 > 0} class:down={h.cagr10 < 0}>{p(h.cagr10)}</b>{/if}
		</p>
		<ul class="years">
			{#each h.years as y (y.year)}
				<li class:partial={y.partial} class:cut={y.change !== null && y.change < -10 && !y.partial}>
					<span class="y">{y.year}{y.partial ? '*' : ''}</span>
					<span class="bar"><span style:width="{Math.max(2, (y.total / max) * 100)}%"></span></span>
					<span class="v">{priceText(y.total, priceUnit)}</span>
					<span class="c" class:up={(y.change ?? 0) > 0 && !y.partial} class:down={(y.change ?? 0) < 0 && !y.partial}>{y.partial ? tx(`${y.payments} выпл.`, `${y.payments} paid`) : p(y.change)}</span>
				</li>
			{/each}
		</ul>
		<p class="muted small">
			{tx('* — год ещё не закончен. Красным — годовой дивиденд меньше прошлого больше чем на 10% (урезан).', '* — the year is not over yet. Red — the yearly dividend more than 10% under the last one (cut).')}
			{#if h.payments.length}{tx('Последние выплаты', 'The last payments')}: {h.payments.slice(0, 6).map((x) => `${d(x.date)} ${priceText(x.amount, priceUnit)}`).join(' · ')}.{/if}
		</p>
	</Fold>
{/if}

<style>
	.years {
		list-style: none;
		margin: var(--s2) 0;
		padding: 0;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.years li {
		display: grid;
		grid-template-columns: 3.4em 1fr 5.5em 4.5em;
		align-items: center;
		gap: 8px;
		padding: 3px 0;
	}
	.bar {
		height: 10px;
		border-radius: 3px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--series-2, var(--accent));
	}
	.partial .bar span {
		opacity: 0.45;
	}
	.cut .bar span {
		background: var(--down);
	}
	.v,
	.c {
		text-align: right;
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
</style>
