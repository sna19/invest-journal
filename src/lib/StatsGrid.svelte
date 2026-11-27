<script lang="ts">
	import { loc, tx } from './i18n.js';
	import HelpIcon from './HelpIcon.svelte';

	/**
	 * A security's ratios (owner's request 26.11.2026), grouped; an empty value is not shown. With `now` (a diary snapshot,
	 * owner 26.11.2026: «смотреть и сравнивать») each value of then is shown with today's next to it.
	 */
	type S = Record<string, number | string | boolean | null>;
	interface Props {
		s: S;
		now?: S | null;
	}
	let { s, now = null }: Props = $props();
	const num = (x: unknown, d = 1) => (typeof x === 'number' ? x.toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d }) : null);
	const pct = (x: unknown, d = 1) => (typeof x === 'number' ? `${(x * 100).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d })}%` : null);
	const big = (x: unknown) => (typeof x === 'number' ? (x >= 1e9 ? `${num(x / 1e9, 0)} ${tx('млрд', 'B')}` : `${num(x / 1e6, 0)} ${tx('млн', 'M')}`) : null);
	const REC: Record<string, [string, string]> = { strong_buy: ['активно покупать', 'strong buy'], buy: ['покупать', 'buy'], hold: ['держать', 'hold'], underperform: ['хуже рынка', 'underperform'], sell: ['продавать', 'sell'] };
	type F = (x: S) => string | null;
	const ROWS: { t: string; help: string; rows: [string, F][] }[] = $derived([
		{
			t: tx('Качество', 'Quality'),
			help: 'security.quality',
			rows: [
				[tx('Чистая маржа', 'Net margin'), (x) => pct(x.profitMargin)],
				[tx('Операционная маржа', 'Operating margin'), (x) => pct(x.operatingMargin)],
				[tx('Валовая маржа', 'Gross margin'), (x) => pct(x.grossMargin)],
				['ROE', (x) => pct(x.roe)],
				['ROA', (x) => pct(x.roa)],
				[tx('Долг / капитал', 'Debt / equity'), (x) => (typeof x.debtToEquity === 'number' ? pct(x.debtToEquity / 100, 0) : null)],
				[tx('Текущая ликвидность', 'Current ratio'), (x) => num(x.currentRatio, 2)]
			]
		},
		{
			t: tx('Рост (год к году)', 'Growth (year on year)'),
			help: 'security.growth',
			rows: [
				[tx('Выручка', 'Revenue'), (x) => pct(x.revenueGrowth)],
				[tx('Прибыль', 'Earnings'), (x) => pct(x.earningsGrowth)]
			]
		},
		{
			t: tx('Оценка', 'Valuation'),
			help: 'security.valuation',
			rows: [
				['P/E', (x) => num(x.pe)],
				[tx('P/E прогноз', 'Forward P/E'), (x) => num(x.forwardPe)],
				['P/S', (x) => num(x.ps)],
				['P/B', (x) => num(x.pb)],
				['EV/EBITDA', (x) => num(x.evEbitda)],
				['PEG', (x) => num(x.peg, 2)]
			]
		},
		{
			t: tx('Риск', 'Risk'),
			help: 'security.risk',
			rows: [
				[tx('Колебания за год, % в год', 'Volatility, a year, % a year'), (x) => pct(x.vol1y, 0)],
				[tx('Колебания за 3 мес., % в год', 'Volatility, 3 months, % a year'), (x) => pct(x.vol3m, 0)],
				[tx('Дневной размах (ATR 14)', 'Daily range (ATR 14)'), (x) => pct(x.atrPct)],
				[tx('Бета (к рынку)', 'Beta (vs market)'), (x) => num(x.beta, 2)],
				[tx('Бета за 3 года', '3-year beta'), (x) => num(x.beta3y, 2)],
				[tx('Шорт, % акций', 'Short, % of float'), (x) => pct(x.shortFloat)]
			]
		},
		{
			t: tx('Доход и владельцы', 'Income and holders'),
			help: 'security.income',
			rows: [
				[tx('Дивидендная доходность', 'Dividend yield'), (x) => pct(x.dividendYield, 2)],
				[tx('Доля прибыли на дивиденды', 'Payout ratio'), (x) => pct(x.payoutRatio, 0)],
				[tx('У инсайдеров', 'Insiders'), (x) => pct(x.insiders, 0)],
				[tx('У фондов', 'Institutions'), (x) => pct(x.institutions, 0)]
			]
		},
		{
			t: tx('Аналитики', 'Analysts'),
			help: 'security.analysts',
			rows: [
				[tx('Цель, средняя', 'Mean target'), (x) => num(x.target, 2)],
				[tx('Цель, разброс', 'Target range'), (x) => (typeof x.targetLow === 'number' && typeof x.targetHigh === 'number' ? `${num(x.targetLow, 0)}–${num(x.targetHigh, 0)}` : null)],
				[tx('Мнение', 'Opinion'), (x) => (typeof x.recommendation === 'string' ? tx(...(REC[x.recommendation] ?? [x.recommendation, x.recommendation])) : null)],
				[tx('Аналитиков', 'Analysts'), (x) => num(x.analysts, 0)]
			]
		},
		{
			t: tx('Фонд', 'Fund'),
			help: 'security.fund',
			rows: [
				[tx('Активы', 'Assets'), (x) => big(x.totalAssets)],
				[tx('С начала года', 'Year to date'), (x) => pct(x.ytd)],
				[tx('3 года, в год', '3 years, a year'), (x) => pct(x.threeYear)]
			]
		}
	]);
	const groups = $derived(
		ROWS.map((g) => ({ t: g.t, help: g.help, rows: g.rows.map(([k, f]) => [k, f(s), now ? f(now) : null] as [string, string | null, string | null]).filter((r) => r[1] !== null) as [string, string, string | null][] })).filter((g) => g.rows.length)
	);
</script>

<div class="grid" class:cmp={!!now}>
	{#if now}<div class="r head"><span></span><b>{tx('тогда', 'then')}</b><b>{tx('сейчас', 'now')}</b></div>{/if}
	{#each groups as g (g.t)}
		<div class="g">
			<div class="gt"><span>{g.t}</span> <HelpIcon topicKey={g.help} label={g.t} /></div>
			{#each g.rows as [k, val, nowVal] (k)}
				<div class="r"><span>{k}</span><b>{val}</b>{#if now}<b class="now" class:same={nowVal === val}>{nowVal ?? '—'}</b>{/if}</div>
			{/each}
		</div>
	{/each}
</div>
{#if s.priceRatiosHidden}<p class="note">{tx('Для бумаг TASE Yahoo делит цену в агоротах на результаты в долларах — оценочные коэффициенты (P/E, P/S, P/B, цели) скрыты, чтобы не вводить в заблуждение.', 'For TASE securities Yahoo divides a price in agorot by results in dollars — the price ratios (P/E, P/S, P/B, targets) are hidden so as not to mislead.')}</p>{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--s3);
	}
	.gt {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: 0 0 4px;
	}
	.gt > span {
		font-size: var(--fs-xs);
		color: var(--muted);
		font-weight: 600;
	}
	.r {
		display: flex;
		justify-content: space-between;
		gap: var(--s2);
		font-size: var(--fs-xs);
		padding: 2px 0;
		border-bottom: 1px solid var(--line);
	}
	.r b {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.grid.cmp {
		grid-template-columns: 1fr;
		gap: var(--s2);
	}
	.cmp .r {
		display: grid;
		grid-template-columns: 1fr auto 72px;
		gap: var(--s2);
		text-align: right;
	}
	.cmp .r span {
		text-align: left;
	}
	.r.head b {
		font-weight: 400;
		color: var(--muted);
	}
	.now {
		font-weight: 400;
		color: var(--link);
	}
	.now.same {
		color: var(--muted);
	}
	.note {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
