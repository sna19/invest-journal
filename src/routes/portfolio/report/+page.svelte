<script lang="ts">
	import SortHead from '#lib/SortHead.svelte';
	import { TableSort } from '#lib/tablesort.svelte.js';
	const monthSort = new TableSort<'month' | 'pct' | 'benchPct' | 'gain'>();
	const kindSort = new TableSort<'n' | 'beat' | 'profitPc'>();
	import Fold from '#lib/Fold.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import TopBar from '#lib/TopBar.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Pct from '#lib/Pct.svelte';
	import TvLink from '#lib/TvLink.svelte';
	import { loc, tl, tx } from '#lib/i18n.js';
	import { money } from '#lib/portfolio.js';

	/**
	 * The portfolio's report (owner's request 20.11.2026): A — the months, the return against the market and what the
	 * gain was made of; B — the closed trades, each against the market over the same days, and what came after.
	 */
	interface Month {
		month: string;
		pct: number | null;
		benchPct: number | null;
		valueStart: number;
		valueEnd: number;
		flows: number;
		gain: number;
		realized: number;
		dividends: number;
		costs: number;
		unrealized: number;
	}
	interface Trade {
		positionId: number;
		symbol: string;
		name: string;
		exchange: string;
		buyDate: string;
		sellDate: string;
		days: number;
		qty: number;
		returnPct: number;
		profitPc: number;
		benchPct: number | null;
		excess: number | null;
		afterPct: number | null;
		kind: 'hypothesis' | 'model' | 'own' | 'transfer';
		fromTransfer: boolean;
	}
	interface Report {
		portfolio: { id: number; name: string; currency: string };
		from: string | null;
		benchLabel: string;
		months: Month[];
		total: { pct: number | null; benchPct: number | null };
		trades: Trade[];
		summary: {
			n: number;
			profitPc: number;
			wins: number;
			beat: number;
			withBench: number;
			avgWinPct: number | null;
			avgLossPct: number | null;
			avgDaysWin: number | null;
			avgDaysLoss: number | null;
			soldEarly: number;
			kinds: { kind: Trade['kind']; n: number; profitPc: number; beat: number }[];
		};
	}
	let r = $state<Report | null>(null);
	let problem = $state<string | null>(null);
	let openMonth = $state<string | null>(null);
	const id = Number(page.url.searchParams.get('p'));
	onMount(async () => {
		const res = await fetch(`/api/portfolios/${id}/report`).catch(() => null);
		if (!res?.ok) return void (problem = tx('Отчёт не загрузился.', 'The report did not load.'));
		r = await res.json();
	});
	const cur = $derived(r?.portfolio.currency ?? 'ILS');
	const monthName = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString(loc(), { month: 'short', year: '2-digit' });
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: '2-digit' });
	const pp = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} ${tx('п.п.', 'pp')}`);
	const KIND: Record<Trade['kind'], [string, string]> = {
		hypothesis: ['по гипотезе', 'from a hypothesis'],
		model: ['по модели', 'from the model'],
		own: ['своя идея', 'own idea'],
		transfer: ['перенесённая', 'carried over']
	};
	const kindName = (k: Trade['kind']) => tx(...KIND[k]);
	// the bars: both series on one scale, zero in the middle
	const scale = $derived(r ? Math.max(3, ...r.months.flatMap((m) => [Math.abs(m.pct ?? 0), Math.abs(m.benchPct ?? 0)])) : 3);
</script>

<svelte:head><title>{tx('Отчёт', 'Report')} · {r?.portfolio.name ?? ''}</title></svelte:head>

<TopBar title={tx('Отчёт', 'Report')} subtitle={r?.portfolio.name} help="portfolio.report" back={{ href: `/portfolio?p=${id}`, label: tx('Портфель', 'Portfolio') }} />

{#if problem}<p class="warn">{problem}</p>{/if}

{#if r}
	{#if !r.from}
		<p class="muted">{tx('В портфеле ещё нет денег и сделок — отчёту не из чего считать.', 'No money or trades in the portfolio yet — nothing to report.')}</p>
	{:else}
		<Fold key="report-months" remind="portfolio.report" title={tx('По месяцам', 'By month')} summary={r.total.pct !== null ? `${tx('портфель', 'portfolio')} ${r.total.pct > 0 ? '+' : ''}${r.total.pct}% · ${r.benchLabel} ${(r.total.benchPct ?? 0) > 0 ? '+' : ''}${r.total.benchPct ?? '—'}%` : undefined}>
			<p class="muted small">
				{tx('С', 'Since')} {d(r.from)}: {tx('портфель', 'portfolio')} <Pct value={r.total.pct} /> · {r.benchLabel} <Pct value={r.total.benchPct} plain />
				{#if r.total.pct !== null && r.total.benchPct !== null} · <b>{pp(r.total.pct - r.total.benchPct)}</b>{/if}
			</p>
			<div class="bars" role="img" aria-label={tx('Доходность по месяцам: портфель и рынок', 'Monthly return: portfolio and market')}>
				{#each r.months as m (m.month)}
					<div class="col" title="{monthName(m.month)}: {m.pct ?? '—'}% · {r.benchLabel} {m.benchPct ?? '—'}%">
						<div class="half up">
							{#if (m.pct ?? 0) > 0}<span class="b p" style:height="{((m.pct ?? 0) / scale) * 100}%"></span>{:else}<span class="b p0"></span>{/if}
							{#if (m.benchPct ?? 0) > 0}<span class="b k" style:height="{((m.benchPct ?? 0) / scale) * 100}%"></span>{:else}<span class="b k0"></span>{/if}
						</div>
						<div class="half down">
							{#if (m.pct ?? 0) < 0}<span class="b p neg" style:height="{(-(m.pct ?? 0) / scale) * 100}%"></span>{:else}<span class="b p0"></span>{/if}
							{#if (m.benchPct ?? 0) < 0}<span class="b k" style:height="{(-(m.benchPct ?? 0) / scale) * 100}%"></span>{:else}<span class="b k0"></span>{/if}
						</div>
						<span class="ml">{monthName(m.month).slice(0, 3)}</span>
					</div>
				{/each}
			</div>
			<p class="legend small"><i class="lp"></i>{tx('портфель', 'portfolio')} <i class="lk"></i>{r.benchLabel}</p>

			<table class="months">
				<thead><tr><th><SortHead s={monthSort} k="month">{tx('Месяц', 'Month')}</SortHead></th><th><SortHead s={monthSort} k="pct">{tx('Портфель', 'Portfolio')}</SortHead></th><th><SortHead s={monthSort} k="benchPct">{tx('Рынок', 'Market')}</SortHead></th><th><SortHead s={monthSort} k="gain">{tx('Доход', 'Gain')}</SortHead></th></tr></thead>
				<tbody>
					{#each monthSort.rows([...r.months].reverse(), (m, k) => m[k]) as m (m.month)}
						<tr class="mrow" class:open={openMonth === m.month} onclick={() => (openMonth = openMonth === m.month ? null : m.month)}>
							<td>{monthName(m.month)}</td>
							<td><Pct value={m.pct} /></td>
							<td><Pct value={m.benchPct} plain /></td>
							<td class:pos={m.gain > 0} class:neg={m.gain < 0}>{money(m.gain, cur, true)}</td>
						</tr>
						{#if openMonth === m.month}
							<tr class="detail">
								<td colspan="4">
									<dl>
										<dt>{tx('Реализовано (продажи)', 'Realized (sales)')}</dt><dd>{money(m.realized, cur, true)}</dd>
										<dt>{tx('Дивиденды', 'Dividends')}</dt><dd>{money(m.dividends, cur, true)}</dd>
										<dt>{tx('Комиссии и налог', 'Fees and tax')}</dt><dd>{money(-m.costs, cur, true)}</dd>
										<dt>{tx('Переоценка того, что держишь', 'Revaluation of what you hold')}</dt><dd>{money(m.unrealized, cur, true)}</dd>
										<dt class="muted">{tx('Взносы и выводы (не доход)', 'Deposits and withdrawals (not gain)')}</dt><dd class="muted">{money(m.flows, cur, true)}</dd>
										<dt class="muted">{tx('Стоимость: начало → конец', 'Value: start → end')}</dt><dd class="muted">{money(m.valueStart, cur)} → {money(m.valueEnd, cur)}</dd>
									</dl>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
			<p class="muted small">{tx('Тап по месяцу — из чего сложился доход.', 'Tap a month to see what the gain was made of.')}</p>
		</Fold>

		<Fold key="report-trades" remind="portfolio.report" title={tx('Закрытые сделки', 'Closed trades')} summary={tx(`сделок: ${r.trades.length}`, `trades: ${r.trades.length}`)}>
			{#if !r.trades.length}
				<p class="muted">{tx('Продаж ещё не было.', 'No sales yet.')}</p>
			{:else}
				{@const s = r.summary}
				<div class="facts">
					<div><b>{s.n}</b><span>{tx('сделок', 'trades')} · {money(s.profitPc, cur, true)}</span></div>
					<div><b>{s.wins}/{s.n}</b><span>{tx('в плюсе', 'in profit')}</span></div>
					<div><b>{s.beat}/{s.withBench}</b><span>{tx('лучше рынка', 'beat the market')}</span></div>
					<div><b><Pct value={s.avgWinPct} /> / <Pct value={s.avgLossPct} /></b><span>{tx('средняя прибыльная / убыточная', 'average win / loss')}</span></div>
					<div><b>{s.avgDaysWin ?? '—'} / {s.avgDaysLoss ?? '—'}</b><span>{tx('дней держишь прибыльные / убыточные', 'days you hold winners / losers')}</span></div>
					<div><b>{s.soldEarly}</b><span>{tx('выросли после продажи больше чем на 10%', 'rose over 10% after the sale')}</span></div>
				</div>
				{#if s.avgDaysWin !== null && s.avgDaysLoss !== null && s.avgDaysLoss > s.avgDaysWin * 1.5}
					<p class="warn small">{tx('Убыточные держишь заметно дольше прибыльных: похоже, прибыль фиксируется рано, а убытки пересиживаются.', 'You hold losers much longer than winners: profits seem taken early and losses sat out.')}</p>
				{/if}
				{#if s.kinds.length > 1}
					<table class="kinds">
						<thead><tr><th>{tx('Откуда сделка', 'Where from')}</th><th><SortHead s={kindSort} k="n">{tx('Сделок', 'Trades')}</SortHead></th><th><SortHead s={kindSort} k="beat">{tx('Лучше рынка', 'Beat')}</SortHead></th><th><SortHead s={kindSort} k="profitPc">{tx('Прибыль', 'Profit')}</SortHead></th></tr></thead>
						<tbody>
							{#each kindSort.rows(s.kinds, (x, k) => x[k]) as k (k.kind)}
								<tr><td>{kindName(k.kind)}</td><td>{k.n}</td><td>{k.beat}</td><td>{money(k.profitPc, cur, true)}</td></tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<ul class="trades">
					{#each r.trades as t, i (i)}
						<li>
							<div class="t1">
								<b>{t.symbol}</b>
								<TvLink exchange={t.exchange} symbol={t.symbol} />
								<span class="grow"></span>
								<Pct value={t.returnPct} />
								<span class="money" class:pos={t.profitPc > 0} class:neg={t.profitPc < 0}>{money(t.profitPc, cur, true)}</span>
							</div>
							<div class="t2 muted small">
								{d(t.buyDate)} → {d(t.sellDate)} · {t.days} {tx('дн.', 'd')} · {kindName(t.kind)}{t.fromTransfer ? ` · ${tx('от даты переноса', 'since carry-over')}` : ''}
							</div>
							<div class="t2 small">
								{tl(t.exchange === 'TASE' ? 'ТА-125' : 'S&P 500')} <Pct value={t.benchPct} plain />
								{#if t.excess !== null} · <b class:pos={t.excess > 0} class:neg={t.excess < 0}>{t.excess > 0 ? tx('лучше рынка на', 'beat the market by') : tx('хуже рынка на', 'behind the market by')} {Math.abs(t.excess).toFixed(1)} {tx('п.п.', 'pp')}</b>{/if}
								{#if t.afterPct !== null} · <span class="muted">{tx('после продажи', 'after the sale')} <Pct value={t.afterPct} plain /></span>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Fold>
	{/if}
{:else if !problem}
	<p class="muted">{tx('Считаю…', 'Computing…')}</p>
{/if}

<style>
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.warn {
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.bars {
		display: flex;
		align-items: stretch;
		gap: 3px;
		height: 140px;
		margin: var(--s3) 0 0;
		overflow-x: auto;
	}
	.col {
		flex: 1 0 18px;
		display: flex;
		flex-direction: column;
		min-width: 18px;
	}
	.half {
		flex: 1;
		display: flex;
		gap: 2px;
		justify-content: center;
	}
	.half.up {
		align-items: flex-end;
		border-bottom: 1px solid var(--line);
	}
	.half.down {
		align-items: flex-start;
	}
	.b {
		width: 6px;
		border-radius: 2px;
	}
	.b.p {
		background: var(--series-1);
	}
	.b.p.neg {
		background: var(--series-2);
	}
	.b.k {
		background: var(--series-muted);
	}
	.b.p0,
	.b.k0 {
		height: 0;
	}
	.ml {
		text-align: center;
		font-size: 9px;
		color: var(--muted);
	}
	.legend {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--muted);
	}
	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.lp {
		background: var(--series-1);
	}
	.lk {
		background: var(--series-muted);
		margin-left: 8px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-s);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 7px 4px;
		border-bottom: 1px solid var(--line);
		text-align: right;
	}
	th:first-child,
	td:first-child {
		text-align: left;
	}
	th {
		font-weight: 600;
		color: var(--muted);
		font-size: var(--fs-xs);
	}
	.mrow {
		cursor: pointer;
	}
	.mrow.open td {
		border-bottom: none;
	}
	.detail td {
		background: var(--bg);
		text-align: left;
	}
	dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px 12px;
		margin: 0;
		font-size: var(--fs-xs);
	}
	dd {
		margin: 0;
		text-align: right;
	}
	.pos {
		color: var(--up);
	}
	.neg {
		color: var(--down);
	}
	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s2);
		margin-bottom: var(--s3);
	}
	.facts div {
		display: flex;
		flex-direction: column;
		padding: var(--s2);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.facts span {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.kinds {
		margin-bottom: var(--s3);
	}
	.trades {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.trades li {
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.t1 {
		display: flex;
		align-items: center;
		gap: var(--s2);
	}
	.grow {
		flex: 1;
	}
	.money {
		min-width: 80px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.t2 {
		margin-top: 2px;
	}
</style>
