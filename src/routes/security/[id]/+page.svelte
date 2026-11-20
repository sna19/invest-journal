<script lang="ts">
	import { tl, tx } from '#lib/i18n.js';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TopBar from '#lib/TopBar.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Pct from '#lib/Pct.svelte';
	import TvLink from '#lib/TvLink.svelte';
	import LineChart, { colorOf, type Line, type Mark } from '#lib/charts/LineChart.svelte';
	import { SIGNAL, short } from '#lib/HypothesisCard.svelte';
	import { priceText, STAGE_LABEL, type Stage } from '#lib/portfolio.js';
	import { sectorName } from '#lib/allocation.js';

	/**
	 * Spec section 19 — the security card: the price with the benchmark brought to the same start, the marks of
	 * hypotheses (entry ●, exit ■, colour by source) and of the owner's trades (▲ bought, ▼ sold); periods
	 * 1М…10Л. A tap on a mark opens the hypothesis or the position.
	 */
	interface ModelBlock {
		variant: 'A' | 'B';
		quarter: number;
		forYear: number;
		years: number[];
		results: (number | null)[];
		price: (number | null)[];
		bench: (number | null)[];
		up: number;
		mean: number | null;
		median: number | null;
		worst: number | null;
		inUniverse: boolean;
		passed: boolean;
		rank: number | null;
		params: { k: number; years: number; compareWith: string };
		versionId: number | null;
		/** the screen's parameters differ from the saved ones */
		preview: boolean;
	}
	interface Chart {
		monthly: boolean;
		today: { price: number; dayPct: number; date: string; live: boolean } | null;
		profile: { sector: string | null; industry: string | null; country: string | null; capUsd: number | null; kind: string | null } | null;
		security: { id: number; symbol: string; name: string; exchange: string; currency: string; priceUnit: string };
		benchmark: { id: number; label: string } | null;
		points: { date: string; value: number }[];
		bench: { date: string; value: number }[];
		markers: { id: string; date: string; price: number; kind: Mark['kind']; label: string; sourceId?: number; hypothesisId?: number; positionId?: number; direction?: string }[];
		change: number | null;
		benchChange: number | null;
		last: { date: string; close: number } | null;
		hypotheses: { id: number; direction: string; signalType: string; status: string; sourceId: number; sourceName: string; entryPriceDate: string | null; horizonDate: string; excessPct: number | null; outcome: string | null }[];
		positions: { id: number; stage: Stage; portfolioId: number; portfolio: string; kind: string; auto: number | null }[];
	}
	const PERIODS = [
		['1M', '1М', '1M'],
		['3M', '3М', '3M'],
		['6M', '6М', '6M'],
		['1Y', '1Г', '1Y'],
		['5Y', '5Л', '5Y'],
		['10Y', '10Л', '10Y']
	] as const;
	const KEY = 'security-period';

	let period = $state<string>('1Y');
	let c = $state<Chart | null>(null);
	let problem = $state<string | null>(null);
	let loadMs = $state<number | null>(null);
	let allHyps = $state(false);
	// T-020: opened from the quarterly model — its block on top, the trade linked to the model
	const modelVariant = $derived((page.url.searchParams.get('model') === 'B' ? 'B' : page.url.searchParams.get('model') === 'A' ? 'A' : null) as 'A' | 'B' | null);
	let model = $state<ModelBlock | null>(null);
	let highlight = $state<number | null>(null);
	async function loadModel() {
		if (!modelVariant) return;
		const qs = new URLSearchParams([...page.url.searchParams.entries()].filter(([k]) => k !== 'model' && k !== 'q'));
		qs.set('variant', modelVariant);
		const q = page.url.searchParams.get('q');
		if (q) qs.set('quarter', q);
		const r = await fetch(`/api/model/security/${page.params.id}?${qs}`).catch(() => null);
		if (r?.ok) model = await r.json();
	}
	/** the chosen quarter shaded in every year of the chart */
	const bands = $derived(
		highlight
			? Array.from({ length: 16 }, (_, i) => new Date().getFullYear() - i).map((y) => ({
					from: `${y}-${String((highlight! - 1) * 3 + 1).padStart(2, '0')}-01`,
					to: new Date(Date.UTC(y, highlight! * 3, 0)).toISOString().slice(0, 10)
				}))
			: []
	);
	function toggleHighlight() {
		const q = model?.quarter ?? (Number(page.url.searchParams.get('q')) || Math.floor(new Date().getMonth() / 3) + 1);
		highlight = highlight ? null : q;
		if (highlight && period !== '10Y') setPeriod('10Y');
	}
	const capText = (x: number) => (x >= 1e12 ? `${(x / 1e12).toFixed(1)} ${tx('трлн $', 'T $')}` : x >= 1e9 ? `${Math.round(x / 1e9)} ${tx('млрд $', 'B $')}` : `${Math.round(x / 1e6)} ${tx('млн $', 'M $')}`);
	const pctText = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}%`);
	const maxAbs = $derived(model ? Math.max(5, ...model.price.map((x) => Math.abs(x ?? 0)), ...model.bench.map((x) => Math.abs(x ?? 0))) : 5);
	const mq = $derived(modelVariant ? `&model=${modelVariant}` : '');

	// «С чем сравнить» (20.11.2026): the sector, industry and index ETFs, their returns, lines on the chart
	interface CmpRef {
		role: 'sector' | 'industry' | 'index';
		label: string;
		id: number;
		symbol: string;
		name: string;
		exchange: string;
		returns: Record<string, number | null>;
		loaded: boolean;
	}
	let cmp = $state<{ periods: string[]; security: Record<string, number | null>; refs: CmpRef[] } | null>(null);
	let shown = $state<number[]>([]);
	let refLines = $state<Record<number, { date: string; value: number }[]>>({});
	async function loadCompare() {
		const r = await fetch(`/api/securities/${page.params.id}/compare`).catch(() => null);
		if (r?.ok) cmp = await r.json();
	}
	async function loadRefLine(id: number) {
		const r = await fetch(`/api/securities/${id}/chart?period=${period}`).catch(() => null);
		if (!r?.ok) return;
		const j = await r.json();
		refLines = { ...refLines, [id]: j.points };
	}
	function toggleRef(id: number) {
		shown = shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id];
		if (shown.includes(id)) void loadRefLine(id);
	}
	const ROLE: Record<CmpRef['role'], [string, string]> = { sector: ['Сектор', 'Sector'], industry: ['Отрасль', 'Industry'], index: ['Индекс', 'Index'] };
	const refLabel = (r: CmpRef) => (r.role === 'sector' ? sectorName(r.label, tx) : r.label);
	/** a reference line brought to the security's first close of the period: both start at one point */
	function scaled(points: { date: string; value: number }[]) {
		if (!c?.points.length || !points.length) return [];
		const start = c.points[0];
		const base = [...points].reverse().find((p) => p.date <= start.date) ?? points[0];
		return points.filter((p) => p.date >= start.date).map((p) => ({ date: p.date, value: Math.round((p.value / base.value) * start.value * 10000) / 10000 }));
	}

	async function load() {
		const t0 = performance.now();
		const r = await fetch(`/api/securities/${page.params.id}/chart?period=${period}`).catch(() => null);
		if (!r?.ok) return (problem = r?.status === 404 ? tx('Нет такой бумаги.', 'No such security.') : tx('Нет связи с сервером.', 'No connection to the server.'));
		c = await r.json();
		loadMs = Math.round(performance.now() - t0);
		problem = null;
	}
	onMount(() => {
		try {
			period = localStorage.getItem(KEY) ?? '1Y';
		} catch {
			/* ignore */
		}
		// from the model: ten years with its quarter shaded, without changing the remembered period
		if (modelVariant) {
			highlight = Number(page.url.searchParams.get('q')) || null;
			if (highlight) period = '10Y';
		}
		load();
		loadModel();
		loadCompare();
	});
	function setPeriod(p: string) {
		period = p;
		refLines = {};
		for (const id of shown) void loadRefLine(id);
		try {
			localStorage.setItem(KEY, p);
		} catch {
			/* ignore */
		}
		load();
	}

	const css = (n: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(n).trim());
	const lines = $derived<Line[]>(
		c
			? [
					{ key: 'sec', label: c.security.symbol, points: c.points, main: true },
					...(c.benchmark && c.bench.length ? [{ key: 'bench', label: tl(c.benchmark.label), points: c.bench, color: css('--muted'), dashed: true }] : []),
					...(cmp?.refs ?? [])
						.filter((r) => shown.includes(r.id) && refLines[r.id]?.length && !c!.monthly)
						.map((r, i) => ({ key: `ref${r.id}`, label: r.symbol, points: scaled(refLines[r.id]), color: css(`--series-${(i % 6) + 2}`), dashed: true }))
				]
			: []
	);
	const marks = $derived<Mark[]>(
		c
			? c.markers.map((m) => ({
					id: m.id,
					date: m.date,
					price: m.price,
					kind: m.kind,
					color: m.kind === 'buy' ? css('--up') : m.kind === 'sell' ? css('--down') : colorOf(m.sourceId ?? 0),
					text: m.kind === 'buy' || m.kind === 'sell' ? undefined : m.label.slice(0, 14)
				}))
			: []
	);
	function onmarker(id: string) {
		const m = c?.markers.find((x) => x.id === id);
		if (!m) return;
		if (m.hypothesisId) goto(`/?open=${m.hypothesisId}`);
		else if (m.positionId) {
			const p = c!.positions.find((x) => x.id === m.positionId);
			goto(`/portfolio?p=${p?.portfolioId ?? ''}&position=${m.positionId}`);
		}
	}
	const sources = $derived([...new Map((c?.markers ?? []).filter((m) => m.sourceId).map((m) => [m.sourceId!, m.label.slice(2)])).entries()]);
</script>

<svelte:head><title>{c?.security.symbol ?? tx('Бумага', 'Security')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={c?.security.symbol ?? tx('Бумага', 'Security')} subtitle={c ? `${c.security.name} · ${c.security.exchange.replace('_', ' ')}` : undefined} help="security.chart" />

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if c}
	{#if model}
		<section class="model">
			<h2>
				{tx('Квартальная модель', 'Quarterly model')} · {model.variant === 'A' ? tx('А. Рост цены', 'A. Price rise') : tx('Б. Против рынка', 'B. Against the market')} · Q{model.quarter} {model.forYear}
				<HelpIcon topicKey="model.quarterly" label={tx('как считается', 'how it is computed')} />
			</h2>
			<p class="muted small">
				{#if model.rank}{tx(`Кандидат №${model.rank}`, `Candidate №${model.rank}`)}{:else if model.passed}{tx('Прошла фильтр, но не вошла из-за ограничений по сектору и рынку', 'Passed the filter but left out by the sector and market caps')}{:else if model.inUniverse}{tx(`Не прошла фильтр: ${model.up} из ${model.years.length} лет при K = ${model.params.k}`, `Did not pass: ${model.up} of ${model.years.length} years at K = ${model.params.k}`)}{:else}{tx('Не в выборке модели: нет 10 лет истории, мало оборота или цена ниже порога', 'Not in the model universe: no 10-year history, little turnover or the price below the threshold')}{/if}
				· {model.preview ? tx('параметры предпросмотра, не сохранены', 'preview parameters, not saved') : model.versionId ? tx(`версия параметров №${model.versionId}`, `parameters version №${model.versionId}`) : tx('параметры ещё не записаны версией', 'the parameters are not a version yet')}
			</p>
			<div class="yr head2 muted small"><span></span><span></span><span class="v">{c.security.symbol}</span><span class="v">{tx('рынок', 'market')}</span></div>
			{#each model.years as y, j (y)}
				{@const r = model.price[j]}
				{@const b = model.bench[j]}
				<div class="yr">
					<span class="y">{y}</span>
					<span class="track">
						<span class="mid"></span>
						<span class="b sec" class:neg={(r ?? 0) < 0} style:width="{(Math.abs(r ?? 0) / maxAbs) * 50}%"></span>
						<span class="b mkt" class:neg={(b ?? 0) < 0} style:width="{(Math.abs(b ?? 0) / maxAbs) * 50}%"></span>
					</span>
					<span class="v">{pctText(r)}</span>
					<span class="v muted">{pctText(b)}</span>
				</div>
			{/each}
			<p class="sum small">
				{tx(model.variant === 'A' ? 'Рост' : 'Сверх рынка', model.variant === 'A' ? 'Rise' : 'Over the market')}: {tx('лет', 'years')} {model.up}/{model.years.length} · {tx('среднее', 'mean')} <b>{pctText(model.mean)}</b> · {tx('медиана', 'median')} {pctText(model.median)} · {tx('худший год', 'worst year')} {pctText(model.worst)}
			</p>
		</section>
	{/if}

	<div class="head">
		<b class="price">{priceText(c.today?.price ?? c.last?.close, c.security.priceUnit)}</b>
		<TvLink exchange={c.security.exchange} symbol={c.security.symbol} />
		{#if c.today}<span class="day"><Pct value={c.today.dayPct} /> <span class="muted small">{c.today.date >= new Date().toISOString().slice(0, 10) ? tx('за день', 'today') : `${tx('за', 'on')} ${short(c.today.date, true)}`}</span></span>
		{:else if c.last}<span class="muted small">{tx('закрытие', 'close')} {short(c.last.date, true)}</span>{/if}
		<span class="grow"></span>
		<span class="chg">{PERIODS.find((p) => p[0] === period)?.[1]}: <Pct value={c.change} />{#if c.benchmark && c.benchChange !== null} <span class="muted small">{c.benchmark.label} <Pct value={c.benchChange} plain /></span>{/if}</span>
	</div>

	{#if c.profile && (c.profile.sector || c.profile.capUsd)}
		<p class="muted small facts">
			{[c.profile.sector ? sectorName(c.profile.sector, tx) : '', c.profile.industry ?? '', c.profile.capUsd ? `${tx('капитализация', 'market cap')} ${capText(c.profile.capUsd)}` : '', c.profile.country ?? ''].filter(Boolean).join(' · ')}
		</p>
	{/if}

	<div class="periods" role="radiogroup" aria-label={tx('Период', 'Period')}>
		{#each PERIODS as [k, ru, en] (k)}
			<button role="radio" aria-checked={period === k} class:on={period === k} onclick={() => setPeriod(k)}>{tx(ru, en)}</button>
		{/each}
	</div>

	{#if c.points.length < 2}
		<p class="muted center">{tx('За этот период цен нет: бумага не в кругах загрузки или история ещё грузится.', 'No prices for this period: the security is not in the load rings or its history is still loading.')}</p>
	{:else}
		{#if c.monthly}<p class="muted small center">{tx('Месячные закрытия: дневная история бумаги загружается, откройте карточку чуть позже.', 'Monthly closes: the daily history is loading, open the card again a little later.')}</p>{/if}
		<LineChart {lines} {marks} {onmarker} {bands} format={(v) => priceText(v, c!.security.priceUnit)} />
		<button class="hl" class:on={!!highlight} aria-pressed={!!highlight} onclick={toggleHighlight}>{highlight ? tx(`Подсвечен Q${highlight} — снять`, `Q${highlight} shaded — clear`) : tx('Подсветить квартал', 'Shade the quarter')}</button>
		<p class="muted small keys">
			● {tx('вход гипотезы', 'hypothesis entry')} · ■ {tx('выход', 'exit')} · <span class="up">▲</span> {tx('купил', 'bought')} · <span class="down">▼</span> {tx('продал', 'sold')}{#if sources.length} · {#each sources as [id, name] (id)}<span class="src"><i style:background={colorOf(id)}></i>{tl(name)}</span>{/each}{/if}
		</p>
	{/if}

	{#if cmp && cmp.refs.length}
		<section class="cmp">
			<h2>{tx('С чем сравнить', 'Compare with')} <HelpIcon topicKey="security.compare" label={tx('сравнение', 'comparison')} /></h2>
			<div class="scroll"><table>
				<thead><tr><th></th>{#each cmp.periods as p (p)}<th>{tx(PERIODS.find((x) => x[0] === p)?.[1] ?? p, p)}</th>{/each}</tr></thead>
				<tbody>
					<tr class="me"><td><b>{c.security.symbol}</b></td>{#each cmp.periods as p (p)}<td>{pctText(cmp.security[p])}</td>{/each}</tr>
					{#each cmp.refs as r (r.id)}
						<tr>
							<td>
								<label class="refname">
									<input type="checkbox" checked={shown.includes(r.id)} disabled={!r.loaded || c.monthly} onchange={() => toggleRef(r.id)} aria-label={tx('на график', 'on the chart')} />
									<span><span class="muted small">{tx(...ROLE[r.role])}</span><br />{refLabel(r)} · <a href="/security/{r.id}">{r.symbol}</a></span>
								</label>
							</td>
							{#each cmp.periods as p (p)}
								{@const me = cmp.security[p]}
								{@const x = r.returns[p]}
								<td>
									{pctText(x)}
									{#if me !== null && x !== null}<br /><small class:pos={me - x > 0} class:neg={me - x < 0}>{me - x > 0 ? '+' : me - x < 0 ? '−' : ''}{Math.abs(me - x).toFixed(1)}</small>{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table></div>
			<p class="muted small">
				{tx(`Под доходностью ориентира — на сколько п.п. ${c.security.symbol} была лучше (+) или хуже (−). Галочка — линия на графике.`, `Under a reference's return — by how many pp ${c.security.symbol} did better (+) or worse (−). The tick puts its line on the chart.`)}
				{#if cmp.refs.some((r) => !r.loaded)}{tx(' Часть ориентиров ещё загружается — откройте карточку позже.', ' Some references are still loading — open the card later.')}{/if}
			</p>
		</section>
	{/if}

	<div class="buttons">
		<a href="/portfolio?add={c.security.id}&kind=watch{mq}">{tx('Наблюдаю', 'Watching')}</a>
		<a href="/portfolio?add={c.security.id}&kind=plan_buy{mq}">{tx('Хочу купить', 'Want to buy')}</a>
		<a href="/portfolio?add={c.security.id}&kind=buy{mq}">{tx('Купил', 'Bought')}</a>
		<a href="/new">{tx('Гипотеза', 'Hypothesis')}</a>
	</div>

	{#if c.hypotheses.length}
		<h2>{tx('Гипотезы', 'Hypotheses')}</h2>
		<ul class="list">
			{#each allHyps ? [...c.hypotheses].reverse() : [...c.hypotheses].reverse().slice(0, 10) as h (h.id)}
				<li>
					<a href="/?open={h.id}">
						<span><i class="dot" style:background={colorOf(h.sourceId)}></i>{tl(h.sourceName)} · {tl(SIGNAL[h.signalType])} · {h.direction === 'long' ? tx('▲ рост', '▲ up') : tx('▼ падение', '▼ down')}</span>
						<span class="muted small">
							{h.status === 'open' ? `${tx('до', 'until')} ${short(h.horizonDate, true)}` : h.outcome === 'hit' ? tx('сработала', 'came true') : tx('не сработала', 'failed')}{#if h.excessPct !== null} · <Pct value={h.excessPct} />{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
		{#if c.hypotheses.length > 10 && !allHyps}<button class="more" onclick={() => (allHyps = true)}>{tx('Показать все', 'Show all')} — {c.hypotheses.length}</button>{/if}
	{/if}
	{#if c.positions.length}
		<h2>{tx('В портфелях', 'In portfolios')}</h2>
		<ul class="list">
			{#each c.positions as p (p.id)}
				<li>
					<a href="/portfolio?p={p.portfolioId}&position={p.id}"><span>{p.portfolio}</span><span class="muted small">{STAGE_LABEL[p.stage]}</span></a>
				</li>
			{/each}
		</ul>
	{/if}
	{#if loadMs !== null}<p class="muted tiny">{tx('данные графика', 'chart data')} — {loadMs} {tx('мс', 'ms')}</p>{/if}
{:else if !problem}
	<div class="skeleton"></div>
{/if}

<style>
	.cmp {
		margin: var(--s4) 0;
		padding: var(--s3) var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	.cmp h2 {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 0 var(--s2);
		font-size: var(--fs-m);
	}
	.cmp .scroll {
		overflow-x: auto;
	}
	.cmp table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.cmp th,
	.cmp td {
		padding: 6px 3px;
		border-bottom: 1px solid var(--line);
		text-align: right;
		vertical-align: top;
	}
	.cmp th:first-child,
	.cmp td:first-child {
		text-align: left;
	}
	.cmp tr.me td {
		font-weight: 600;
	}
	.refname {
		min-width: 120px;
		display: flex;
		gap: 6px;
		align-items: flex-start;
	}
	.refname input {
		margin-top: 2px;
	}
	.cmp small.pos {
		color: var(--up);
	}
	.cmp small.neg {
		color: var(--down);
	}
	.model {
		margin: 0 0 var(--s4);
		padding: var(--s3) var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	.model h2 {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin: 0 0 4px;
		font-size: var(--fs-m);
	}
	.yr {
		display: grid;
		grid-template-columns: 38px 1fr 58px 58px;
		align-items: center;
		gap: 6px;
		min-height: 22px;
		font-size: var(--fs-xs);
	}
	.yr .v {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.track {
		position: relative;
		height: 12px;
	}
	.track .mid {
		position: absolute;
		left: 50%;
		top: -2px;
		bottom: -2px;
		width: 1px;
		background: var(--line);
	}
	.track .b {
		position: absolute;
		left: 50%;
		height: 5px;
		border-radius: 0 2px 2px 0;
	}
	.track .b.sec {
		top: 0;
		background: var(--series-1);
	}
	.track .b.mkt {
		top: 6px;
		background: var(--series-muted);
	}
	.track .b.neg {
		left: auto;
		right: 50%;
		border-radius: 2px 0 0 2px;
	}
	.track .b.sec.neg {
		background: var(--series-2);
	}
	.sum {
		margin: 6px 0 0;
	}
	.facts {
		margin: 0 0 var(--s2);
	}
	.day {
		white-space: nowrap;
	}
	.hl {
		display: block;
		margin: 6px 0 0 auto;
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.hl.on {
		border-color: var(--text);
	}
	.head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--s2);
		margin-bottom: var(--s2);
	}
	.price {
		font-size: var(--fs-xl);
	}
	.grow {
		flex: 1;
	}
	.more {
		width: 100%;
		min-height: var(--tap);
		margin-top: var(--s2);
		border: none;
		background: none;
		color: var(--link);
		cursor: pointer;
	}
	.chg {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px var(--s2);
		align-items: baseline;
	}
	.periods {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin-bottom: var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.periods button {
		flex: 1;
		min-height: 36px;
		border: none;
		border-radius: var(--r1);
		background: none;
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.periods button.on {
		background: var(--surface);
		font-weight: 600;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
	}
	.keys {
		display: flex;
		flex-wrap: wrap;
		gap: 4px var(--s2);
		align-items: center;
	}
	.src {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.src i,
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-right: 4px;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.buttons {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--s2);
		margin: var(--s3) 0;
	}
	.buttons a {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	h2 {
		margin: var(--s4) 0 var(--s2);
		font-size: var(--fs-m);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.list a {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3) var(--s4);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.tiny {
		font-size: var(--fs-xs);
		text-align: right;
	}
	.center {
		text-align: center;
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 300px;
		border-radius: var(--r3);
		background: var(--surface);
	}
</style>
