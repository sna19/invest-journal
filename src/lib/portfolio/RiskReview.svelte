<script lang="ts">
	import SortHead from '../SortHead.svelte';
	import { TableSort } from '../tablesort.svelte.js';
	const yearSort = new TableSort<'portfolio' | 'sales' | 'gain' | 'loss' | 'net'>();
	import { onMount } from 'svelte';
	import Fold from '../Fold.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import { loc, tl, tx } from '../i18n.js';
	import { money } from '../portfolio.js';
	import { showToast } from '../toast.svelte.js';
	import { journalVersion } from '../journal/screen.svelte.js';

	/**
	 * T-016 on the portfolio screen: «Разбор позиций» (three answers per open position, «нет» → «держу без тезиса»), the
	 * job's industry against its limit, the speculation budget, «А если бы в индекс», the disposition effect, the year.
	 */
	let { portfolioId, currency }: { portfolioId: number; currency: string } = $props();
	interface Row {
		positionId: number;
		securityId: number;
		symbol: string;
		weight: number | null;
		unrealizedPct: number | null;
		last: { date: string; thesis: string | null; wouldBuy: number; exitCondition: string | null } | null;
		noThesis: boolean;
		suggest: { thesis: string; exit: string };
	}
	interface R {
		limits: { industryPct: number; specPct: number; specLossPct: number };
		work: { employer: string | null; industry: string | null; sharePct: number | null; limitPct: number; positions: { symbol: string; inIndustryPc: number; pct: number }[] } | null;
		speculation: { value: number; loss: number; sharePct: number | null; lossPct: number | null; positions: { id: number; symbol: string; valuePc: number; stop: number | null }[] };
		counterfactual: { from: string | null; bought: number; trades: number; rows: { index: string; mirror: number; held: number; diff: number; pp: number | null }[] } | null;
		disposition: { realizedGain: number; realizedLoss: number; openGain: number; openLoss: number; soldWinnersDays: number | null; soldLosersDays: number | null; heldWinnersDays: number | null; heldLosersDays: number | null; concentration: { n: number; of: number; symbols: string[]; pct: number } | null } | null;
		reviews: { rows: Row[]; lastFull: string | null } | null;
	}
	let r = $state<R | null>(null);
	let year = $state<{ year: number; items: { portfolio: string; currency: string; sales: number; gain: number; loss: number; net: number; dividends: number; fees: number; tax: number }[] } | null>(null);
	let open = $state<number | null>(null);
	let form = $state<{ thesis: string; wouldBuy: boolean | null; exit: string }>({ thesis: '', wouldBuy: null, exit: '' });

	async function load() {
		r = await fetch(`/api/portfolios/${portfolioId}/riskreport`).then((x) => x.json()).catch(() => null);
		year = await fetch('/api/year').then((x) => x.json()).catch(() => null);
	}
	onMount(load);
	let seen = journalVersion.n;
	$effect(() => {
		if (journalVersion.n !== seen) ((seen = journalVersion.n), load());
	});

	function start(x: Row) {
		open = x.positionId;
		form = { thesis: x.suggest.thesis, wouldBuy: null, exit: x.suggest.exit };
	}
	async function save(x: Row) {
		const res = await fetch(`/api/positions/${x.positionId}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) }).catch(() => null);
		const j = await res?.json().catch(() => ({}));
		if (!res?.ok) return showToast(tl(j?.message) || tx('Не сохранилось', 'Not saved'));
		open = null;
		showToast(j.noThesis ? tx(`${x.symbol}: держу без тезиса`, `${x.symbol}: held without a thesis`) : tx(`${x.symbol}: разбор записан`, `${x.symbol}: review saved`));
		journalVersion.n++;
	}
	const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`);
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
	const stale = $derived(!r?.reviews?.lastFull || Date.now() - Date.parse(r.reviews.lastFull) > 91 * 86_400_000);
</script>

{#if r}
	{#if r.reviews?.rows.length}
		<Fold key="portfolio-review" title={tx('Разбор позиций', 'Position review')} summary={r.reviews.lastFull ? `${tx('полный', 'full')} ${d(r.reviews.lastFull)}` : tx('ещё не проводился', 'not done yet')} open={stale} remind="portfolio.review">
			{#snippet aside()}<HelpIcon topicKey="portfolio.review" label={tx('разбор позиций', 'position review')} />{/snippet}
			{#if stale}<p class="warn small">{tx('Пора пройти разбор: по каждой позиции — тезис, «купил бы сегодня?» и условие выхода. Раз в квартал.', 'Time for the review: for each position — the thesis, «would I buy it today?» and the exit condition. Once a quarter.')} <HelpIcon topicKey="portfolio.review" label={tx('разбор позиций', 'position review')} /></p>{/if}
			<ul class="rows">
				{#each r.reviews.rows as x (x.positionId)}
					<li>
						<div class="top">
							<a href="/position/{x.positionId}"><b>{x.symbol}</b></a>
							<span class="muted small">{x.weight}% · {pct(x.unrealizedPct)}</span>
							{#if x.noThesis}<span class="flag">{tx('держу без тезиса', 'held without a thesis')}</span>{/if}
							<span class="grow"></span>
							<span class="muted small">{x.last ? d(x.last.date) : tx('не разбиралась', 'not reviewed')}</span>
							{#if open !== x.positionId}<button class="lnk" onclick={() => start(x)}>{x.last ? tx('ещё раз', 'again') : tx('разобрать', 'review')}</button>{/if}
						</div>
						{#if x.noThesis && open !== x.positionId}
							<div class="acts"><a href="/position/{x.positionId}">{tx('Продал', 'Sold')}</a><a href="/position/{x.positionId}">{tx('Задать условие выхода', 'Set the exit condition')}</a></div>
						{/if}
						{#if open === x.positionId}
							<div class="form">
								<label><span>{tx('Тезис — почему держу', 'Thesis — why I hold it')}</span><input bind:value={form.thesis} /></label>
								<span class="lbl">{tx('Купил бы сегодня по этой цене?', 'Would I buy it today at this price?')}</span>
								<div class="chips">
									<button type="button" class:on={form.wouldBuy === true} onclick={() => (form.wouldBuy = true)}>{tx('Да', 'Yes')}</button>
									<button type="button" class:on={form.wouldBuy === false} onclick={() => (form.wouldBuy = false)}>{tx('Нет', 'No')}</button>
								</div>
								<label><span>{tx('Условие выхода', 'Exit condition')}</span><input bind:value={form.exit} placeholder={tx('стоп, цель, дата или событие', 'a stop, a target, a date or an event')} /></label>
								<div class="acts">
									<button class="main" disabled={form.wouldBuy === null} onclick={() => save(x)}>{tx('Записать', 'Save')}</button>
									<button class="ghost" onclick={() => (open = null)}>{tx('Отмена', 'Cancel')}</button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</Fold>
	{/if}

	{#if r.work?.industry}
		{@const over = (r.work.sharePct ?? 0) > r.work.limitPct}
		<Fold key="portfolio-workrisk" title={tx('Риск работы', 'Job risk')} summary={`${r.work.industry} ${r.work.sharePct}% / ${r.work.limitPct}%`} open={over} remind="portfolio.work_risk">
			{#snippet aside()}<HelpIcon topicKey="portfolio.work_risk" label={tx('риск работы', 'job risk')} />{/snippet}
			<p>{tx('Отрасль работы', 'The job\'s industry')} ({r.work.employer}): <b>{r.work.industry}</b> — <b class:down={over}>{r.work.sharePct}%</b> {tx('портфеля, лимит', 'of the portfolio, limit')} {r.work.limitPct}%</p>
			<div class="meter"><span style:width="{Math.min(100, ((r.work.sharePct ?? 0) / Math.max(r.work.limitPct * 1.5, r.work.sharePct ?? 0)) * 100)}%" class:over></span><i style:left="{(r.work.limitPct / Math.max(r.work.limitPct * 1.5, r.work.sharePct ?? 0)) * 100}%"></i></div>
			<p class="muted small"><b>{tx('Портфель + работа', 'Portfolio + job')}:</b> {tx(`${r.work.sharePct}% портфеля и зарплата зависят от одной отрасли — плохой год для неё ударит дважды.`, `${r.work.sharePct}% of the portfolio and the salary depend on one industry — a bad year for it hits twice.`)}</p>
			{#if r.work.positions.length}<p class="small">{r.work.positions.map((p) => `${p.symbol} ${p.pct}%`).join(' · ')}</p>{/if}
			<p class="muted small">{tx('Фонды — через состав: отраслевой фонд целиком, остальные — по крупнейшим бумагам. Работодатель — на экране «Риск», лимит — в «Настройках».', 'Funds are looked through: an industry fund whole, the others by their top holdings. The employer is set on «Risk», the limit — in «Settings».')}</p>
		</Fold>
	{/if}

	<Fold key="portfolio-spec" remind="portfolio.speculation" title={tx('Спекуляции', 'Speculation')} summary={`${r.speculation.sharePct ?? 0}% / ${r.limits.specPct}%`} open={(r.speculation.sharePct ?? 0) > r.limits.specPct}>
		{#snippet aside()}<HelpIcon topicKey="portfolio.speculation" label={tx('спекуляции', 'speculation')} />{/snippet}
		{#if r.speculation.positions.length}
			<p>{tx('Доля', 'Share')} <b class:down={(r.speculation.sharePct ?? 0) > r.limits.specPct}>{r.speculation.sharePct}%</b> {tx('при бюджете', 'of a budget of')} {r.limits.specPct}% · {tx('можно потерять', 'may lose')} <b class:down={(r.speculation.lossPct ?? 0) > r.limits.specLossPct}>{money(r.speculation.loss, currency)}</b> ({r.speculation.lossPct}% {tx('при допустимых', 'of the allowed')} {r.limits.specLossPct}%)</p>
			<p class="small">{r.speculation.positions.map((p) => `${p.symbol} ${money(p.valuePc, currency)}${p.stop === null ? ` (${tx('без стопа', 'no stop')})` : ''}`).join(' · ')}</p>
		{:else}
			<p class="muted small">{tx('Позиций вида «Спекуляция» нет. Вид сделки задаётся в «Купил».', 'No positions of the kind «Speculation». The kind of trade is set in «Bought».')}</p>
		{/if}
	</Fold>

	{#if r.counterfactual?.rows.length}
		{@const c = r.counterfactual}
		<Fold key="portfolio-counter" remind="portfolio.counterfactual" title={tx('А если бы в индекс', 'What if into the index')} summary={c.rows.map((x) => `${x.index} ${x.diff >= 0 ? '+' : ''}${money(x.diff, currency)}`).join(' · ')} open={false}>
			{#snippet aside()}<HelpIcon topicKey="portfolio.counterfactual" label={tx('а если бы в индекс', 'what if into the index')} />{/snippet}
			{#each c.rows as x (x.index)}
				<p>{tx('Бумаги сейчас', 'The securities now')} <b>{money(x.held, currency)}</b> · {tx('те же деньги в', 'the same money in')} {x.index}: <b>{money(x.mirror, currency)}</b> → <b class:up={x.diff > 0} class:down={x.diff < 0}>{x.diff >= 0 ? '+' : ''}{money(x.diff, currency)}</b> ({pct(x.pp)} {tx('п.п. к сумме покупок', 'pp of the sum bought')})</p>
			{/each}
			<p class="muted small">{tx(`С ${c.from ? d(c.from) : '—'}: ${c.trades} сделок, куплено на ${money(c.bought, currency)}. Каждая покупка (и перенос) — покупка индекса на ту же сумму в тот же день, продажа — продажа; деньги на счёте одинаковы. Индекс без дивидендов.`, `Since ${c.from ? d(c.from) : '—'}: ${c.trades} trades, ${money(c.bought, currency)} bought. Each purchase (and a carry-over) buys the index for the same sum on the same day, a sale sells it; the cash is the same. The index without dividends.`)}</p>
		</Fold>
	{/if}

	{#if r.disposition}
		{@const x = r.disposition}
		<Fold key="portfolio-disposition" title={tx('Эффект диспозиции', 'Disposition effect')} summary={x.concentration ? tx(`${x.concentration.n} поз. — ${x.concentration.pct}% убытка`, `${x.concentration.n} pos. — ${x.concentration.pct}% of the loss`) : undefined} open={false} remind="portfolio.disposition">
			{#snippet aside()}<HelpIcon topicKey="portfolio.disposition" label={tx('эффект диспозиции', 'disposition effect')} />{/snippet}
			<p>{tx('Реализованная прибыль', 'Profit taken')} <b class="up">{money(x.realizedGain, currency, true)}</b> · {tx('висящий убыток', 'loss left open')} <b class="down">{money(x.openLoss, currency, true)}</b></p>
			<p class="small">{tx('Держал', 'Held')}: {tx('прибыльные проданные', 'winners sold')} {x.soldWinnersDays ?? '—'} {tx('дн.', 'd')} · {tx('убыточные проданные', 'losers sold')} {x.soldLosersDays ?? '—'} · {tx('открытые в плюсе', 'open winners')} {x.heldWinnersDays ?? '—'} · {tx('открытые в минусе', 'open losers')} {x.heldLosersDays ?? '—'}</p>
			{#if x.concentration}<p><b>{tx(`${x.concentration.n} из ${x.concentration.of} убыточных позиций дают ${x.concentration.pct}% убытка`, `${x.concentration.n} of ${x.concentration.of} losing positions make ${x.concentration.pct}% of the loss`)}</b>: {x.concentration.symbols.join(', ')}</p>{/if}
		</Fold>
	{/if}

	{#if year?.items.length}
		<Fold key="portfolio-year" remind="portfolio.year" title={`${tx('Итог года', 'The year')} ${year.year}`} summary={year.items.map((y) => `${y.portfolio} ${money(y.net, y.currency, true)}`).join(' · ')} open={false}>
			{#snippet aside()}<HelpIcon topicKey="portfolio.year" label={tx('итог года', 'the year')} />{/snippet}
			<table>
				<thead><tr><th><SortHead s={yearSort} k="portfolio" desc={false}>{tx('Портфель', 'Portfolio')}</SortHead></th><th><SortHead s={yearSort} k="sales">{tx('продаж', 'sales')}</SortHead></th><th><SortHead s={yearSort} k="gain">{tx('прибыль', 'gain')}</SortHead></th><th><SortHead s={yearSort} k="loss">{tx('убыток', 'loss')}</SortHead></th><th><SortHead s={yearSort} k="net">{tx('итого', 'net')}</SortHead></th></tr></thead>
				<tbody>
					{#each yearSort.rows(year.items, (y, k) => y[k]) as y (y.portfolio)}
						<tr><td>{y.portfolio}</td><td>{y.sales}</td><td>{money(y.gain, y.currency, true)}</td><td>{money(y.loss, y.currency, true)}</td><td><b>{money(y.net, y.currency, true)}</b></td></tr>
					{/each}
				</tbody>
			</table>
			<p class="muted small">{tx('Реализованный результат продаж за календарный год (FIFO, в валюте портфеля), реальные портфели. Оценка, не налоговый расчёт.', 'The realized result of the year\'s sales (FIFO, in the portfolio\'s currency), real portfolios. An estimate, not a tax calculation.')}{#if year.items.some((y) => y.dividends || y.tax)} {tx('Дивиденды', 'Dividends')}: {year.items.map((y) => money(y.dividends, y.currency)).join(', ')}.{/if}</p>
		</Fold>
	{/if}
{/if}

<style>
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.top {
		display: flex;
		align-items: center;
		gap: var(--s2);
		flex-wrap: wrap;
	}
	.top a {
		color: var(--text);
	}
	.grow {
		flex: 1;
	}
	.flag {
		font-size: var(--fs-xs);
		padding: 0 var(--s2);
		border-radius: var(--r-pill);
		background: var(--down);
		color: #fff;
	}
	.lnk {
		border: none;
		background: none;
		color: var(--link);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.acts {
		display: flex;
		gap: var(--s3);
		margin-top: var(--s1);
		font-size: var(--fs-s);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		margin-top: var(--s2);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.lbl {
		font-size: var(--fs-s);
		color: var(--muted);
	}
	input {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.chips {
		display: flex;
		gap: var(--s2);
	}
	.chips button,
	.main,
	.ghost {
		min-height: 36px;
		padding: 0 var(--s4);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
	}
	.chips button.on,
	.main {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.main:disabled {
		opacity: 0.5;
	}
	.meter {
		position: relative;
		height: 10px;
		border-radius: 5px;
		background: var(--surface-2);
		margin: var(--s2) 0;
	}
	.meter span {
		display: block;
		height: 100%;
		border-radius: 5px;
		background: var(--accent);
	}
	.meter span.over {
		background: var(--down);
	}
	.meter i {
		position: absolute;
		top: -3px;
		width: 2px;
		height: 16px;
		background: var(--text);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-s);
		font-variant-numeric: tabular-nums;
	}
	th {
		font-weight: 400;
		color: var(--muted);
		text-align: right;
	}
	td {
		text-align: right;
		padding: var(--s1) 0;
		border-top: 1px solid var(--line);
	}
	td:first-child,
	th:first-child {
		text-align: left;
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
		font-size: var(--fs-s);
	}
	.warn {
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	p {
		margin: var(--s1) 0;
	}
</style>
