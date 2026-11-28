<script lang="ts">
	import { lang, loc, tx } from './i18n.js';
	import HelpIcon from './HelpIcon.svelte';
	import { sortedTerms, termById } from './glossary.js';

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
	// owner 27.11.2026: a tap on a ratio's name — its short line from the glossary under it; the glossary with a search below
	let openRow = $state<string | null>(null);
	let q = $state('');
	let glossaryOpen = $state(false);
	const L = $derived(lang() === 'en' ? 1 : 0);
	const found = $derived.by(() => {
		const all = sortedTerms(lang() === 'en' ? 'en' : 'ru');
		const w = q.trim().toLowerCase();
		return w ? all.filter((t) => `${t.term[0]} ${t.term[1]} ${t.aka} ${t.group[0]} ${t.group[1]}`.toLowerCase().includes(w)) : all;
	});
	const num = (x: unknown, d = 1) => (typeof x === 'number' ? x.toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d }) : null);
	const pct = (x: unknown, d = 1) => (typeof x === 'number' ? `${(x * 100).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d })}%` : null);
	const big = (x: unknown) => (typeof x === 'number' ? (x >= 1e9 ? `${num(x / 1e9, 0)} ${tx('млрд', 'B')}` : `${num(x / 1e6, 0)} ${tx('млн', 'M')}`) : null);
	const REC: Record<string, [string, string]> = { strong_buy: ['активно покупать', 'strong buy'], buy: ['покупать', 'buy'], hold: ['держать', 'hold'], underperform: ['хуже рынка', 'underperform'], sell: ['продавать', 'sell'] };
	type F = (x: S) => string | null;
	const ROWS: { t: string; help: string; rows: [string, F, string][] }[] = $derived([
		{
			t: tx('Качество (Quality)', 'Quality'),
			help: 'security.quality',
			rows: [
				[tx('Чистая маржа (NPM)', 'Net margin (NPM)'), (x) => pct(x.profitMargin), 'margin_net'],
				[tx('Операционная маржа (OPM)', 'Operating margin (OPM)'), (x) => pct(x.operatingMargin), 'margin_op'],
				[tx('Валовая маржа (GM)', 'Gross margin (GM)'), (x) => pct(x.grossMargin), 'margin_gross'],
				[tx('ROE (рентабельность капитала)', 'ROE (return on equity)'), (x) => pct(x.roe), 'roe'],
				[tx('ROA (рентабельность активов)', 'ROA (return on assets)'), (x) => pct(x.roa), 'roa'],
				[tx('Долг / капитал (D/E)', 'Debt / equity (D/E)'), (x) => (typeof x.debtToEquity === 'number' ? pct(x.debtToEquity / 100, 0) : null), 'de'],
				[tx('Текущая ликвидность (CR)', 'Current ratio (CR)'), (x) => num(x.currentRatio, 2), 'current_ratio']
			]
		},
		{
			t: tx('Рост, год к году (Growth YoY)', 'Growth, year on year (YoY)'),
			help: 'security.growth',
			rows: [
				[tx('Выручка (Rev YoY)', 'Revenue (Rev YoY)'), (x) => pct(x.revenueGrowth), 'growth_rev'],
				[tx('Прибыль (EPS YoY)', 'Earnings (EPS YoY)'), (x) => pct(x.earningsGrowth), 'growth_eps']
			]
		},
		{
			t: tx('Оценка (Valuation)', 'Valuation'),
			help: 'security.valuation',
			rows: [
				['P/E', (x) => num(x.pe), 'pe'],
				[tx('P/E прогноз (Fwd P/E)', 'Forward P/E (Fwd P/E)'), (x) => num(x.forwardPe), 'pe_fwd'],
				['P/S', (x) => num(x.ps), 'ps'],
				['P/B', (x) => num(x.pb), 'pb'],
				['EV/EBITDA', (x) => num(x.evEbitda), 'ev_ebitda'],
				['PEG', (x) => num(x.peg, 2), 'peg']
			]
		},
		{
			t: tx('Риск (Risk)', 'Risk'),
			help: 'security.risk',
			rows: [
				[tx('Колебания за год, % в год (HV 1Y)', 'Volatility, a year, % a year (HV 1Y)'), (x) => pct(x.vol1y, 0), 'vol'],
				[tx('Колебания за 3 мес., % в год (HV 3M)', 'Volatility, 3 months, % a year (HV 3M)'), (x) => pct(x.vol3m, 0), 'vol'],
				[tx('Дневной размах (ATR 14)', 'Daily range (ATR 14)'), (x) => pct(x.atrPct), 'atr'],
				[tx('Ниже максимума года (Off 52W High)', 'Under the year\'s high (Off 52W High)'), (x) => pct(x.ddNow, 0), 'drawdown'],
				[tx('Худшая просадка за год (MDD 1Y)', 'Worst drawdown, a year (MDD 1Y)'), (x) => pct(x.ddMax, 0), 'drawdown'],
				[tx('Бета к рынку (β)', 'Beta vs market (β)'), (x) => num(x.beta, 2), 'beta'],
				[tx('Бета за 3 года (β 3Y)', '3-year beta (β 3Y)'), (x) => num(x.beta3y, 2), 'beta'],
				[tx('Шорт, % акций (SI % Float)', 'Short, % of float (SI % Float)'), (x) => pct(x.shortFloat), 'short']
			]
		},
		{
			t: tx('Доход и владельцы (Income & Ownership)', 'Income and holders (Income & Ownership)'),
			help: 'security.income',
			rows: [
				[tx('Дивидендная доходность (DY)', 'Dividend yield (DY)'), (x) => pct(x.dy12 ?? x.dividendYield, 2), 'div_yield'],
				[tx('Рост дивиденда подряд, лет', 'Dividend growth in a row, years'), (x) => (typeof x.divGrowthYears === 'number' ? String(x.divGrowthYears) : null), 'div_growth'],
				[tx('Рост дивиденда за 5 лет, в год (5Y DGR)', 'Dividend growth, 5 years, a year (5Y DGR)'), (x) => pct(x.divCagr5, 1), 'div_growth'],
				[tx('Доля прибыли на дивиденды (Payout Ratio)', 'Payout ratio (Payout Ratio)'), (x) => pct(x.payoutRatio, 0), 'payout'],
				[tx('У инсайдеров (Insider Own.)', 'Insiders (Insider Own.)'), (x) => pct(x.insiders, 0), 'insiders'],
				[tx('У фондов (Inst. Own.)', 'Institutions (Inst. Own.)'), (x) => pct(x.institutions, 0), 'institutions']
			]
		},
		{
			t: tx('Аналитики (Analysts)', 'Analysts'),
			help: 'security.analysts',
			rows: [
				[tx('Цель, средняя (PT)', 'Mean target (PT)'), (x) => num(x.target, 2), 'target_analysts'],
				[tx('Цель, разброс (PT Low–High)', 'Target range (PT Low–High)'), (x) => (typeof x.targetLow === 'number' && typeof x.targetHigh === 'number' ? `${num(x.targetLow, 0)}–${num(x.targetHigh, 0)}` : null), 'target_analysts'],
				[tx('Мнение (Consensus Rating)', 'Opinion (Consensus Rating)'), (x) => (typeof x.recommendation === 'string' ? tx(...(REC[x.recommendation] ?? [x.recommendation, x.recommendation])) : null), 'rating'],
				[tx('Аналитиков (# Analysts)', 'Analysts (# Analysts)'), (x) => num(x.analysts, 0), 'rating']
			]
		},
		{
			t: tx('Фонд (Fund)', 'Fund'),
			help: 'security.fund',
			rows: [
				[tx('Активы (AUM)', 'Assets (AUM)'), (x) => big(x.totalAssets), 'aum'],
				[tx('С начала года (YTD)', 'Year to date (YTD)'), (x) => pct(x.ytd), 'ytd'],
				[tx('3 года, в год (3Y CAGR)', '3 years, a year (3Y CAGR)'), (x) => pct(x.threeYear), 'cagr']
			]
		}
	]);
	const groups = $derived(
		ROWS.map((g) => ({ t: g.t, help: g.help, rows: g.rows.map(([k, f, id]) => [k, f(s), now ? f(now) : null, id] as [string, string | null, string | null, string]).filter((r) => r[1] !== null) as [string, string, string | null, string][] })).filter((g) => g.rows.length)
	);
</script>

<div class="grid" class:cmp={!!now}>
	{#if now}<div class="r head"><span></span><b>{tx('тогда', 'then')}</b><b>{tx('сейчас', 'now')}</b></div>{/if}
	{#each groups as g (g.t)}
		<div class="g">
			<div class="gt"><span>{g.t}</span> <HelpIcon topicKey={g.help} label={g.t} /></div>
			{#each g.rows as [k, val, nowVal, id] (k)}
				{@const t = termById(id)}
				<button type="button" class="r" class:on={openRow === k} aria-expanded={openRow === k} onclick={() => (openRow = openRow === k ? null : k)}><span>{k}</span><b>{val}</b>{#if now}<b class="now" class:same={nowVal === val}>{nowVal ?? '—'}</b>{/if}</button>
				{#if openRow === k && t}<p class="tip">{t.what[L]} <i>{t.how[L]}</i></p>{/if}
			{/each}
		</div>
	{/each}
</div>
{#if !now}
	<div class="gl">
		<button type="button" class="glt" aria-expanded={glossaryOpen} onclick={() => (glossaryOpen = !glossaryOpen)}>{glossaryOpen ? '▾' : '▸'} {tx('Словарь показателей от А до Я', 'Glossary of ratios, A to Z')} · {found.length}</button>
		<HelpIcon topicKey="security.stats" label={tx('показатели', 'ratios')} />
	</div>
	{#if glossaryOpen}
		<input class="gq" type="search" bind:value={q} placeholder={tx('Найти: бета, ATR, P/E, просадка…', 'Find: beta, ATR, P/E, drawdown…')} />
		<dl class="terms">
			{#each found as t (t.id)}
				<dt>{t.term[L]} <span class="grp">{t.group[L]}</span></dt>
				<dd>{t.what[L]} <b>{tx('Как пользоваться', 'How to use')}:</b> {t.how[L]}{#if t.where} <span class="grp">{tx('Где', 'Where')}: {t.where[L]}</span>{/if}</dd>
			{/each}
			{#if !found.length}<dd class="muted">{tx('Не нашёл — попробуй другое написание.', 'Not found — try another spelling.')}</dd>{/if}
		</dl>
	{/if}
{/if}
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
	button.r {
		width: 100%;
		background: none;
		border: none;
		border-bottom: 1px solid var(--line);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		text-align: left;
		cursor: pointer;
	}
	button.r.on {
		background: var(--surface-2, rgba(127, 127, 127, 0.08));
	}
	.tip {
		margin: 2px 0 6px;
		font-size: var(--fs-xs);
		line-height: 1.4;
		color: var(--muted);
	}
	.tip i {
		color: var(--text);
	}
	.gl {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-top: var(--s3);
	}
	.glt {
		background: none;
		border: none;
		padding: 6px 0;
		color: var(--link);
		font: inherit;
		font-size: var(--fs-s);
		cursor: pointer;
		text-align: left;
	}
	.gq {
		width: 100%;
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
		margin: 4px 0 var(--s2);
		box-sizing: border-box;
	}
	.terms {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	.terms dt {
		font-weight: 600;
		margin-top: var(--s2);
	}
	.terms dd {
		margin: 2px 0 0;
		color: var(--text);
	}
	.grp {
		font-weight: 400;
		color: var(--muted);
		font-size: var(--fs-xs);
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
