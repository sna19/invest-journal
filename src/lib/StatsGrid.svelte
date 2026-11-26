<script lang="ts">
	import { loc, tx } from './i18n.js';

	/** a security's ratios (owner's request 26.11.2026), grouped; an empty value is not shown */
	interface Props {
		s: Record<string, number | string | boolean | null>;
	}
	let { s }: Props = $props();
	const num = (x: unknown, d = 1) => (typeof x === 'number' ? x.toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d }) : null);
	const pct = (x: unknown, d = 1) => (typeof x === 'number' ? `${(x * 100).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d })}%` : null);
	const big = (x: unknown) => (typeof x === 'number' ? (x >= 1e9 ? `${num(x / 1e9, 0)} ${tx('млрд', 'B')}` : `${num(x / 1e6, 0)} ${tx('млн', 'M')}`) : null);
	const REC: Record<string, [string, string]> = { strong_buy: ['активно покупать', 'strong buy'], buy: ['покупать', 'buy'], hold: ['держать', 'hold'], underperform: ['хуже рынка', 'underperform'], sell: ['продавать', 'sell'] };
	const groups = $derived(
		[
			{
				t: tx('Оценка', 'Valuation'),
				rows: [
					['P/E', num(s.pe)],
					[tx('P/E прогноз', 'Forward P/E'), num(s.forwardPe)],
					['P/S', num(s.ps)],
					['P/B', num(s.pb)],
					['EV/EBITDA', num(s.evEbitda)],
					['PEG', num(s.peg, 2)]
				]
			},
			{
				t: tx('Риск', 'Risk'),
				rows: [
					[tx('Бета (к рынку)', 'Beta (vs market)'), num(s.beta, 2)],
					[tx('Бета за 3 года', '3-year beta'), num(s.beta3y, 2)],
					[tx('Шорт, % акций', 'Short, % of float'), pct(s.shortFloat)]
				]
			},
			{
				t: tx('Качество', 'Quality'),
				rows: [
					[tx('Чистая маржа', 'Net margin'), pct(s.profitMargin)],
					[tx('Операционная маржа', 'Operating margin'), pct(s.operatingMargin)],
					[tx('Валовая маржа', 'Gross margin'), pct(s.grossMargin)],
					['ROE', pct(s.roe)],
					['ROA', pct(s.roa)],
					[tx('Долг / капитал', 'Debt / equity'), typeof s.debtToEquity === 'number' ? pct(s.debtToEquity / 100, 0) : null],
					[tx('Текущая ликвидность', 'Current ratio'), num(s.currentRatio, 2)]
				]
			},
			{
				t: tx('Рост (год к году)', 'Growth (year on year)'),
				rows: [
					[tx('Выручка', 'Revenue'), pct(s.revenueGrowth)],
					[tx('Прибыль', 'Earnings'), pct(s.earningsGrowth)]
				]
			},
			{
				t: tx('Доход и владельцы', 'Income and holders'),
				rows: [
					[tx('Дивидендная доходность', 'Dividend yield'), pct(s.dividendYield, 2)],
					[tx('Доля прибыли на дивиденды', 'Payout ratio'), pct(s.payoutRatio, 0)],
					[tx('У инсайдеров', 'Insiders'), pct(s.insiders, 0)],
					[tx('У фондов', 'Institutions'), pct(s.institutions, 0)]
				]
			},
			{
				t: tx('Аналитики', 'Analysts'),
				rows: [
					[tx('Цель, средняя', 'Mean target'), num(s.target, 2)],
					[tx('Цель, разброс', 'Target range'), s.targetLow !== null && s.targetHigh !== null ? `${num(s.targetLow, 0)}–${num(s.targetHigh, 0)}` : null],
					[tx('Мнение', 'Opinion'), typeof s.recommendation === 'string' ? tx(...(REC[s.recommendation] ?? [s.recommendation, s.recommendation])) : null],
					[tx('Аналитиков', 'Analysts'), num(s.analysts, 0)]
				]
			},
			{
				t: tx('Фонд', 'Fund'),
				rows: [
					[tx('Активы', 'Assets'), big(s.totalAssets)],
					[tx('С начала года', 'Year to date'), pct(s.ytd)],
					[tx('3 года, в год', '3 years, a year'), pct(s.threeYear)]
				]
			}
		]
			.map((g) => ({ ...g, rows: g.rows.filter((r) => r[1] !== null) as [string, string][] }))
			.filter((g) => g.rows.length)
	);
</script>

<div class="grid">
	{#each groups as g (g.t)}
		<div class="g">
			<p class="gt">{g.t}</p>
			{#each g.rows as [k, val] (k)}
				<div class="r"><span>{k}</span><b>{val}</b></div>
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
		margin: 0 0 4px;
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
	.note {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
