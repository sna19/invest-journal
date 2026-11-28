<script lang="ts">
	import Fold from '../Fold.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import SortHead from '../SortHead.svelte';
	import { TableSort } from '../tablesort.svelte.js';
	import { loc, tx } from '../i18n.js';
	import { money, priceText } from '../portfolio.js';

	/**
	 * Owner 28.11.2026, «Дивиденды»: what each held security paid this year (by the exchange's history and the shares
	 * held before each ex-date, before tax), the yearly income to expect, the yield on today's price and on the purchase,
	 * the years of growth and a cut, the next ex-dates, and the total return — the price and the dividends together.
	 */
	let { portfolioId, version = 0 }: { portfolioId: number; version?: number } = $props();
	type Row = {
		positionId: number;
		securityId: number;
		symbol: string;
		qty: number;
		priceUnit: string;
		received: number;
		recorded: number;
		payments: { date: string; perShare: number; shares: number; value: number }[];
		ttm: number;
		payments12: number;
		yieldNow: number | null;
		yieldOnCost: number | null;
		annualIncome: number;
		growthYears: number;
		cut: boolean;
		next: string | null;
		nextGuessed: boolean;
		nextValue: number | null;
		priceReturn: number | null;
		totalReturn: number | null;
	};
	type V = { year: string; currency: string; rows: Row[]; received: number; recorded: number; income: number; portfolioYield: number | null; soon: { symbol: string; securityId: number; date: string; guessed: boolean; value: number | null }[] };
	let v = $state<V | null>(null);
	let open = $state<number | null>(null);
	$effect(() => {
		void version;
		fetch(`/api/portfolios/${portfolioId}/dividends`)
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => (v = j))
			.catch(() => (v = null));
	});
	const sort = new TableSort<string>('received');
	const rows = $derived(v ? sort.rows(v.rows, (r, k) => (k === 'symbol' ? r.symbol : (r[k as keyof Row] as number | null))) : []);
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
	const p = (x: number | null, sign = false) => (x === null ? '—' : `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`);
</script>

{#if v && v.rows.length}
	<Fold key="portfolio-dividends" remind="portfolio.dividends" title={tx(`Дивиденды ${v.year}`, `Dividends ${v.year}`)} summary={`${money(Math.round(v.received), v.currency)} · ${tx('в год', 'a year')} ${money(Math.round(v.income), v.currency)}`}>
		{#snippet aside()}<HelpIcon topicKey="portfolio.dividends" label={tx('дивиденды', 'dividends')} />{/snippet}
		<div class="sum">
			<div><span class="k">{tx(`Получено в ${v.year}`, `Received in ${v.year}`)}</span><b>{money(Math.round(v.received), v.currency)}</b>{#if v.recorded > 0}<span class="k">{tx('записано', 'recorded')} {money(Math.round(v.recorded), v.currency)}</span>{/if}</div>
			<div><span class="k">{tx('Ожидается за год', 'Expected a year')}</span><b>{money(Math.round(v.income), v.currency)}</b>{#if v.portfolioYield !== null}<span class="k">{p(v.portfolioYield)} {tx('от позиций', 'of the positions')}</span>{/if}</div>
		</div>
		{#if v.soon.length}
			<p class="soon">
				<span class="k">{tx('Ближайшие выплаты', 'Next payments')}:</span>
				{#each v.soon as s (s.symbol)}<span class="chip"><a href="/security/{s.securityId}">{s.symbol}</a> {s.guessed ? '≈' : ''}{d(s.date)}{#if s.value !== null} · {money(Math.round(s.value), v.currency)}{/if}</span>{/each}
			</p>
		{/if}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th><SortHead s={sort} k="symbol" desc={false}>{tx('Бумага', 'Security')}</SortHead></th>
						<th><SortHead s={sort} k="received">{tx(`В ${v.year}`, `In ${v.year}`)}</SortHead></th>
						<th><SortHead s={sort} k="annualIncome">{tx('В год', 'A year')}</SortHead></th>
						<th><SortHead s={sort} k="yieldNow" title={tx('дивиденды за 12 мес. / цена сейчас', 'dividends of 12 months / price now')}>DY</SortHead></th>
						<th><SortHead s={sort} k="yieldOnCost" title={tx('дивиденды за 12 мес. / цена покупки', 'dividends of 12 months / purchase price')}>YoC</SortHead></th>
						<th><SortHead s={sort} k="growthYears" title={tx('лет подряд дивиденд рос', 'years in a row the dividend grew')}>{tx('Рост, лет', 'Growth, y')}</SortHead></th>
						<th><SortHead s={sort} k="priceReturn">{tx('Цена', 'Price')}</SortHead></th>
						<th><SortHead s={sort} k="totalReturn" title={tx('цена и полученные дивиденды вместе', 'the price and the dividends received together')}>{tx('С дивид.', 'With div.')}</SortHead></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.positionId)}
						<tr class:cut={r.cut} onclick={() => (open = open === r.positionId ? null : r.positionId)}>
							<th><a href="/security/{r.securityId}" onclick={(e) => e.stopPropagation()}>{r.symbol}</a>{#if r.cut}<span class="flag" title={tx('дивиденд урезан', 'the dividend was cut')}>✂</span>{/if}{#if r.qty <= 0}<span class="sub">{tx('продана', 'sold')}</span>{/if}</th>
							<td>{r.received ? money(Math.round(r.received), v.currency) : '—'}</td>
							<td>{r.annualIncome ? money(Math.round(r.annualIncome), v.currency) : '—'}</td>
							<td>{p(r.yieldNow)}</td>
							<td>{p(r.yieldOnCost)}</td>
							<td>{r.growthYears || '—'}</td>
							<td class:up={(r.priceReturn ?? 0) > 0} class:down={(r.priceReturn ?? 0) < 0}>{p(r.priceReturn, true)}</td>
							<td class:up={(r.totalReturn ?? 0) > 0} class:down={(r.totalReturn ?? 0) < 0}><b>{p(r.totalReturn, true)}</b></td>
						</tr>
						{#if open === r.positionId}
							<tr class="det">
								<td colspan="8">
									{#each r.payments as x (x.date)}<span class="pay">{d(x.date)}: {priceText(x.perShare, r.priceUnit)} × {Math.round(x.shares * 100) / 100} = <b>{money(Math.round(x.value), v.currency)}</b></span>{/each}
									{#if !r.payments.length}<span class="pay">{tx(`В ${v.year} выплат по бумаге при тебе не было.`, `No payment in ${v.year} while you held it.`)}</span>{/if}
									<span class="pay muted">{tx(`За 12 мес. ${priceText(r.ttm, r.priceUnit)} на акцию, выплат: ${r.payments12}.`, `12 months: ${priceText(r.ttm, r.priceUnit)} a share, payments: ${r.payments12}.`)}{#if r.next}&nbsp;{tx('Следующая', 'Next')}: {r.nextGuessed ? '≈' : ''}{d(r.next)}{#if r.nextValue !== null} ≈ {money(Math.round(r.nextValue), v.currency)}{/if}.{/if}{#if r.recorded} {tx('Записано в деньгах портфеля', 'Recorded in the portfolio\'s money')}: {money(Math.round(r.recorded), v.currency)}.{/if}{#if r.cut} {tx('Последняя выплата заметно меньше прежней — дивиденд урезан: перечитай тезис.', 'The last payment is well under the one before — the dividend was cut: re-read the thesis.')}{/if}</span>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small">{tx('По истории выплат биржи и количеству акций в день перед датой отсечки; до налога (в Израиле 25%, на американские дивиденды обычно удерживается 25%). «С дивид.» — цена с покупки плюс полученные дивиденды. Тап по строке — выплаты.', 'By the exchange\'s payment history and the shares held the day before each ex-date; before tax (25% in Israel, usually 25% withheld on US dividends). «With div.» — the price since the purchase plus the dividends received. Tap a row — the payments.')}</p>
	</Fold>
{/if}

<style>
	.sum {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s3) var(--s4);
		margin-bottom: var(--s2);
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
	.soon {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		margin: 0 0 var(--s2);
		font-size: var(--fs-xs);
	}
	.chip {
		padding: 3px 8px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
	}
	.chip a,
	th a {
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 5px 6px;
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
		position: sticky;
		left: 0;
		background: var(--surface);
	}
	tbody tr {
		cursor: pointer;
	}
	tr.cut th a {
		color: var(--down);
	}
	.flag {
		margin-left: 4px;
		color: var(--down);
	}
	.sub {
		margin-left: 4px;
		font-weight: 400;
		color: var(--muted);
	}
	.det td {
		text-align: left;
		white-space: normal;
		background: var(--surface-2);
	}
	.pay {
		display: block;
		padding: 2px 0;
		/* the detail stays on the screen while the table scrolls sideways */
		max-width: calc(100vw - 72px);
		position: sticky;
		left: 6px;
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
