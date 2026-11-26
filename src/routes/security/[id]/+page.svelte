<script lang="ts">
	import { tl, tx } from '#lib/i18n.js';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TopBar from '#lib/TopBar.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Fold from '#lib/Fold.svelte';
	import RecentCards, { rememberCard } from '#lib/RecentCards.svelte';
	import StatsGrid from '#lib/StatsGrid.svelte';
	import { keepScroll } from '#lib/scroll.js';
	import RiskLabel from '#lib/RiskLabel.svelte';
	import Pct from '#lib/Pct.svelte';
	import PositionCard from '#lib/portfolio/PositionCard.svelte';
	import Feed from '#lib/journal/Feed.svelte';
	import History from '#lib/journal/History.svelte';
	import DecisionForm from '#lib/journal/DecisionForm.svelte';
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
		variant: 'A' | 'B' | 'C' | 'D' | 'G';
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
		score: number | null;
		months: (number | null)[];
		own: { mean: number | null; median: number | null; up: number; years: number };
		sma10: number | null;
		trendOk: boolean;
		reasons: { earnings: boolean | null; dividend: boolean | null; sector: boolean };
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
		security: { id: number; symbol: string; name: string; exchange: string; currency: string; priceUnit: string; type?: string };
		benchmark: { id: number; label: string } | null;
		points: { date: string; value: number }[];
		sma: Record<"20" | "50" | "200", { date: string; value: number }[]> | null;
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
	const modelVariant = $derived(((['A', 'B', 'C', 'D', 'G'] as const).find((v) => v === page.url.searchParams.get('model')) ?? null) as 'A' | 'B' | 'C' | 'D' | 'G' | null);
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
	const VARIANT_NAME: Record<string, [string, string]> = {
		A: ['А. Рост цены', 'A. Price rise'],
		B: ['Б. Против рынка', 'B. Against the market'],
		C: ['В. Оценка', 'C. Score'],
		G: ['Г. С причиной', 'G. With a reason'],
		D: ['Д. Против тренда', 'D. Against its trend']
	};
	// T-018 (5): SMA 20, 50, 200 days on the chart — chosen on this device
	let smaOn = $state<string[]>([]);
	function toggleSma(n: string) {
		smaOn = smaOn.includes(n) ? smaOn.filter((x) => x !== n) : [...smaOn, n];
		try {
			localStorage.setItem('chart-sma', JSON.stringify(smaOn));
		} catch {
			/* ignore */
		}
	}
	// leveraged and inverse ETFs on the share, its industry, sector and indices (owner's request 20.11.2026)
	interface Lev {
		id: number;
		symbol: string;
		name: string;
		exchange: string;
		dir: 'long' | 'short';
		x: number;
		level: 'stock' | 'industry' | 'sector' | 'index';
		label: string;
		expenseRatio: number | null;
	}
	let lev = $state<Lev[] | null>(null);
	let levLoading = $state(0);
	let levSort = $state<'x' | 'fee'>('x');
	let levDir = $state<'long' | 'short'>('long');
	async function loadLev() {
		const r = await fetch(`/api/securities/${page.params.id}/leveraged`).catch(() => null);
		if (!r?.ok) return;
		const j = await r.json();
		lev = j.items;
		levLoading = j.loading;
		// the fees are being loaded: ask again once, a little later
		if (j.loading && !levRetried) {
			levRetried = true;
			setTimeout(loadLev, Math.min(60_000, 2000 + j.loading * 700));
		}
	}
	function setLevDir(d: 'long' | 'short') {
		levDir = d;
		try {
			localStorage.setItem('lev-dir', d);
		} catch {
			/* ignore */
		}
	}
	// T-022 «Почему двигается?»: the move split and the news of the share, its sector and its market
	type Role = 'stock' | 'sector' | 'market';
	interface NewsItem {
		id: number;
		url: string;
		title: string;
		publisher: string | null;
		provider: string;
		publishedAt: string;
		snippet: string | null;
		roles: Role[];
	}
	interface Attr {
		date: string;
		live: boolean;
		total: number;
		market: number | null;
		sector: number | null;
		own: number;
		sectorRef: { id: number; symbol: string; label: string } | null;
		benchLabel: string;
	}
	interface NewsView {
		attribution: Attr | null;
		items: NewsItem[];
		peers: string[];
		moves: { date: string; movePct: number }[];
		fetchedAt: string | null;
	}
	let news = $state<NewsView | null>(null);
	let newsBusy = $state(false);
	let newsRole = $state<Role>('stock');
	let newsDays = $state(7);
	let newsDay = $state<string | null>(null);
	let peersEdit = $state<string | null>(null);
	let newsLimit = $state(15);
	async function loadNews(how: 'GET' | 'POST' = 'GET') {
		newsBusy = true;
		const r = await fetch(`/api/securities/${page.params.id}/news?days=90`, { method: how }).catch(() => null);
		newsBusy = false;
		if (r?.ok) news = await r.json();
		// from the banner of a strong move: straight to the news
		if (how === 'GET' && location.hash === '#news') setTimeout(() => document.getElementById('news')?.scrollIntoView({ block: 'start' }), 300);
	}
	async function savePeers(v: string | null) {
		const r = await fetch(`/api/securities/${page.params.id}/news`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ peers: v }) }).catch(() => null);
		if (r?.ok) {
			news = await r.json();
			peersEdit = null;
			void loadNews('POST');
		}
	}
	const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
	const moveDays = $derived(new Set([...(news?.moves ?? []).map((x) => x.date), ...(news?.attribution && Math.abs(news.attribution.total) >= 3 ? [news.attribution.date] : [])]));
	const newsShown = $derived(
		(news?.items ?? []).filter((x) => x.roles.includes(newsRole) && (newsDay ? dayOf(x.publishedAt) === newsDay : Date.parse(x.publishedAt) > Date.now() - newsDays * 86_400_000))
	);
	const newsCount = (r: Role) => (news?.items ?? []).filter((x) => x.roles.includes(r) && Date.parse(x.publishedAt) > Date.now() - newsDays * 86_400_000).length;
	const ago = (iso: string) => {
		const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
		return m < 60 ? tx(`${m} мин`, `${m} min`) : m < 24 * 60 ? tx(`${Math.round(m / 60)} ч`, `${Math.round(m / 60)} h`) : new Date(iso).toLocaleDateString(tx('ru-RU', 'en-GB'), { day: 'numeric', month: 'short' });
	};
	const pp = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1).replace('.', tx(',', '.'))}%`);
	function openNewsDay(d: string) {
		newsDay = d;
		newsRole = 'stock';
		document.getElementById('news')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	let levRetried = false;
	// T-023: what this security does to each real portfolio's risk, and to all of them together (owner 26.11.2026)
	let riskLabels = $state<{ id: number | 'all'; name: string; currency: string; label: string; twin: string | null }[]>([]);
	const LEVELS: Lev['level'][] = ['stock', 'industry', 'sector', 'index'];
	const feeText = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(2).replace('.', tx(',', '.'))}%`);
	const byFee = (a: Lev, b: Lev) => (a.expenseRatio ?? 9) - (b.expenseRatio ?? 9) || b.x - a.x;
	const levelName = (l: Lev) =>
		l.level === 'stock' ? tx(`На саму ${l.label}`, `On ${l.label} itself`) : l.level === 'industry' ? `${tx('Отрасль', 'Industry')}: ${l.label}` : l.level === 'sector' ? `${tx('Сектор', 'Sector')}: ${sectorName(l.label, tx)}` : `${tx('Индекс', 'Index')}: ${l.label}`;
	const xText = (x: number) => `×${String(x).replace('.', tx(',', '.'))}`;

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
		rememberCard({ id: c!.security.id, symbol: c!.security.symbol });
		// a model's candidate opened from the model is picked by that (owner 26.11.2026)
		if (modelVariant && !picked) void setPicked(true, `модель ${modelVariant} Q${page.url.searchParams.get('q') ?? ''}`);
		void scroll.restore();
	}
	const scroll = keepScroll(() => `security:${page.params.id}`);
	// T-032 11б: «Не покупаю» / «Отложить»
	let deciding = $state<'skip' | 'defer' | null>(null);
	// T-030: the positions of this security open here, «Моя позиция» on top — the one opened from first
	const wanted = $derived(Number(page.url.searchParams.get('position')) || null);
	// the one opened from is drawn at once, before the chart's data come
	const myIds = $derived([...new Set([...(wanted ? [wanted] : []), ...(c?.positions ?? []).filter((p) => p.stage !== 'closed').map((p) => p.id)])]);
	const pastPositions = $derived((c?.positions ?? []).filter((p) => !myIds.includes(p.id)));
	// ☆ — picked: first in the model's list, compared on «Отмеченные»
	let picked = $state(false);
	async function setPicked(on: boolean, origin = 'карточка') {
		picked = on;
		await fetch('/api/shortlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ securityId: Number(page.params.id), on, origin }) }).catch(() => null);
	}
	let stats = $state<Record<string, number | string | boolean | null> | null>(null);
	let statsLoaded = $state(false);
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
		loadLev();
		loadNews();
		void fetch('/api/shortlist').then((r) => r.json()).then((r) => (picked = (r.items ?? []).some((x: { id: number }) => x.id === Number(page.params.id)))).catch(() => {});
		void fetch(`/api/ratios?ids=${page.params.id}`).then((r) => r.json()).then((r) => ((stats = r.items?.[String(page.params.id)]?.stats ?? null), (statsLoaded = true))).catch(() => (statsLoaded = true));
		void fetch(`/api/risk/labels?each=1&ids=${page.params.id}`)
			.then((r) => r.json())
			.then((r) => (riskLabels = r?.items ?? []))
			.catch(() => {});
		try {
			const v = JSON.parse(localStorage.getItem('chart-sma') ?? '[]');
			if (Array.isArray(v)) smaOn = v.filter((x) => ['20', '50', '200'].includes(x));
		} catch {
			/* ignore */
		}
		try {
			if (localStorage.getItem('lev-dir') === 'short') levDir = 'short';
		} catch {
			/* ignore */
		}
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
					...(['20', '50', '200'] as const)
						.filter((n) => smaOn.includes(n) && c!.sma?.[n]?.length)
						.map((n, i) => ({ key: `sma${n}`, label: `SMA${n}`, points: c!.sma![n], color: css(`--series-${i + 5}`) || css('--accent') })),
					...(cmp?.refs ?? [])
						.filter((r) => shown.includes(r.id) && refLines[r.id]?.length && !c!.monthly)
						.map((r, i) => ({ key: `ref${r.id}`, label: r.symbol, points: scaled(refLines[r.id]), color: css(`--series-${(i % 6) + 2}`), dashed: true }))
				]
			: []
	);
	// T-022: a day with news about the share — a small mark above the line (a weekend's news on the next trading day)
	const newsMarks = $derived.by<Mark[]>(() => {
		if (!c || c.monthly || !news) return [];
		const dates = c.points.map((p) => p.date);
		if (!dates.length) return [];
		const count = new Map<string, number>();
		for (const n of news.items) {
			if (!n.roles.includes('stock')) continue;
			const d = dayOf(n.publishedAt);
			const at = dates.find((x) => x >= d);
			if (at) count.set(at, (count.get(at) ?? 0) + 1);
		}
		return [...count].map(([date, n]) => ({
			id: `news:${date}`,
			date,
			price: 0,
			kind: 'news' as const,
			color: moveDays.has(date) ? css('--warn') || css('--accent') : css('--muted'),
			text: moveDays.has(date) ? String(n) : undefined
		}));
	});
	const marks = $derived<Mark[]>(
		c
			? c.markers.map((m): Mark => ({
					id: m.id,
					date: m.date,
					price: m.price,
					kind: m.kind,
					color: m.kind === 'buy' ? css('--up') : m.kind === 'sell' ? css('--down') : colorOf(m.sourceId ?? 0),
					text: m.kind === 'buy' || m.kind === 'sell' ? undefined : m.label.slice(0, 14)
				})).concat(newsMarks).sort((x, y) => x.date.localeCompare(y.date))
			: []
	);
	function onmarker(id: string) {
		if (id.startsWith('news:')) return openNewsDay(id.slice(5));
		const m = c?.markers.find((x) => x.id === id);
		if (!m) return;
		if (m.hypothesisId) goto(`/?open=${m.hypothesisId}`);
		else if (m.positionId) {
			const p = c!.positions.find((x) => x.id === m.positionId);
			void p;
			goto(`/security/${page.params.id}?position=${m.positionId}`).then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
		}
	}
	const sources = $derived([...new Map((c?.markers ?? []).filter((m) => m.sourceId).map((m) => [m.sourceId!, m.label.slice(2)])).entries()]);
</script>

<svelte:head><title>{c?.security.symbol ?? tx('Бумага', 'Security')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={c?.security.symbol ?? tx('Бумага', 'Security')} subtitle={c ? `${c.security.name} · ${c.security.exchange.replace('_', ' ')}` : undefined} help="security.chart" />

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

<RecentCards current={Number(page.params.id)} />

{#each myIds as id (id)}
	<section class="mypos">
		<PositionCard positionId={id} compact onchange={load} ondeleted={load} />
	</section>
{/each}

{#if c}
	{#if model}
		<Fold key="sec-model" title={`${tx('Квартальная модель', 'Quarterly model')} · ${tx(...VARIANT_NAME[model.variant])} · Q${model.quarter} ${model.forYear}`} summary={model.rank ? tx(`Кандидат №${model.rank}`, `Candidate №${model.rank}`) : undefined}>
			{#snippet aside()}<HelpIcon topicKey="model.quarterly" label={tx('как считается', 'how it is computed')} />{/snippet}
			<div class="model">
			<p class="muted small">
				{#if model.rank}{tx(`Кандидат №${model.rank}`, `Candidate №${model.rank}`)}{:else if model.passed}{tx('Прошла фильтр, но не вошла из-за ограничений по сектору и рынку', 'Passed the filter but left out by the sector and market caps')}{:else if model.inUniverse && model.variant === 'C'}{tx(`Не вошла в первые по баллу: балл ${model.score?.toFixed(1) ?? '—'}`, `Not among the top by score: score ${model.score?.toFixed(1) ?? '—'}`)}{:else if model.inUniverse}{tx(`Не прошла фильтр: ${model.up} из ${model.years.length} лет при K = ${model.params.k}`, `Did not pass: ${model.up} of ${model.years.length} years at K = ${model.params.k}`)}{:else}{tx('Не в выборке модели: нет 10 лет истории, мало оборота или цена ниже порога', 'Not in the model universe: no 10-year history, little turnover or the price below the threshold')}{/if}
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
				{#if model.score !== null}{tx('Балл', 'Score')} <b>{model.score.toFixed(1)}</b> <HelpIcon topicKey="model.score" label={tx('балл', 'score')} /> · {/if}{tx(model.variant === 'A' ? 'Рост' : 'Сверх рынка', model.variant === 'A' ? 'Rise' : 'Over the market')}: {tx('лет', 'years')} {model.up}/{model.years.length} · {tx('среднее', 'mean')} <b>{pctText(model.mean)}</b> · {tx('медиана', 'median')} {pctText(model.median)} · {tx('худший год', 'worst year')} {pctText(model.worst)}
			</p>
			{#if model.own.mean !== null && model.variant !== 'D'}
				<p class="sum small" class:trendwarn={Math.abs(model.own.mean) < 1 || model.own.up < 6}>
					Q{model.quarter} {tx('против обычного квартала', 'against the usual quarter')}: <b>{model.own.mean > 0 ? '+' : ''}{model.own.mean.toFixed(1).replace('.', tx(',', '.'))} {tx('п.п.', 'pp')}</b> ({tx('медиана', 'median')} {model.own.median! > 0 ? '+' : ''}{model.own.median?.toFixed(1).replace('.', tx(',', '.'))}) · {tx('выше в', 'above in')} {model.own.up} {tx('из', 'of')} {model.own.years} {tx('лет', 'years')}
					{#if Math.abs(model.own.mean) < 1 || model.own.up < 6}<br />{tx('Рост, скорее, от тренда, а не от сезона.', 'The rise is likely from the trend, not the season.')}{/if}
					<HelpIcon topicKey="model.own_quarter" label={tx('обычный квартал', 'usual quarter')} />
				</p>
			{/if}
			<p class="sum small">
				{tx('Метки причины', 'Reason labels')}: {[model.reasons.earnings ? tx('отчёт в этом квартале', 'a report in this quarter') : '', model.reasons.dividend ? tx('дивиденд в этом квартале', 'a dividend in this quarter') : '', model.reasons.sector ? tx('сектор сезонен', 'the sector is seasonal') : ''].filter(Boolean).join(' · ') || (model.reasons.earnings === null ? tx('календарь отчётов ещё не загружен', 'the report calendar is not loaded yet') : tx('нет', 'none'))}
				<HelpIcon topicKey="model.reason" label={tx('метки причины', 'reason labels')} />
			</p>
			<p class="sum small">
				{tx('По месяцам квартала, в среднем', 'By month of the quarter, mean')}: {model.months.map((m, i) => `${tx('м', 'm')}${i + 1} ${pctText(m)}`).join(' · ')} <HelpIcon topicKey="model.months" label={tx('по месяцам', 'by month')} />
				{#if model.sma10 !== null}<br />{tx('Последнее месячное закрытие', 'The last monthly close')} {model.sma10 >= 0 ? tx('выше', 'above') : tx('ниже', 'below')} SMA 10 {tx('мес.', 'mo')} {tx('на', 'by')} {Math.abs(model.sma10).toFixed(1).replace('.', tx(',', '.'))}%{#if !model.trendOk}{' · '}{tx('фильтр тренда не пройден', 'the trend filter is not passed')}{/if}{/if}
			</p>
			</div>
		</Fold>
	{/if}

	<div class="head">
		<b class="price">{#if c.security.priceUnit === 'ILA'}{priceText((c.today?.price ?? c.last?.close ?? 0) / 100, 'ILS')}{:else}{priceText(c.today?.price ?? c.last?.close, c.security.priceUnit)}{/if}</b>
		{#if c.security.priceUnit === 'ILA'}<span class="muted small">{priceText(c.today?.price ?? c.last?.close, 'ILA')}</span>{/if}
		<TvLink exchange={c.security.exchange} symbol={c.security.symbol} />
		<button class="star" class:on={picked} aria-pressed={picked} aria-label={picked ? tx('Снять отметку', 'Unpick') : tx('Отметить', 'Pick')} title={tx('Отмеченные — первыми в модели и в сравнении', 'Picked — first in the model and in the comparison')} onclick={() => setPicked(!picked)}>{picked ? '★' : '☆'}</button>
		{#if c.today}<span class="day"><Pct value={c.today.dayPct} /> <span class="muted small">{c.today.date >= new Date().toISOString().slice(0, 10) ? tx('за день', 'today') : `${tx('за', 'on')} ${short(c.today.date, true)}`}</span></span>
		{:else if c.last}<span class="muted small">{tx('закрытие', 'close')} {short(c.last.date, true)}</span>{/if}
		<span class="grow"></span>
		<span class="chg">{PERIODS.find((p) => p[0] === period)?.[1]}: <Pct value={c.change} />{#if c.benchmark && c.benchChange !== null} <span class="muted small">{c.benchmark.label} <Pct value={c.benchChange} plain /></span>{/if}</span>
	</div>

	{#if riskLabels.length}
		{@const cur = c.security.priceUnit === 'ILA' || c.security.currency === 'ILS' ? 'ILS' : 'USD'}
		<div class="risks small">
			<span class="muted">{tx('Для риска', 'For the risk of')}:</span>
			{#each [...riskLabels].sort((a, b) => (a.id === 'all' ? 1 : b.id === 'all' ? -1 : (b.currency === cur ? 1 : 0) - (a.currency === cur ? 1 : 0))) as r (r.id)}
				<a class="rk" href="/portfolio/risk?p={r.id}&add={c.security.id}">{r.id === 'all' ? tx('все вместе', 'all together') : r.name} <RiskLabel small label={r.label} twin={r.twin} /></a>
			{/each}
		</div>
	{/if}
	{#if c.profile && (c.profile.sector || c.profile.capUsd)}
		<p class="muted small facts">
			{#if c.profile.sector}<a class="seclink" href="/sector?sector={c.profile.sector}&country={c.security.exchange === 'TASE' ? 'IL' : 'US'}">{sectorName(c.profile.sector, tx)}</a>{/if}{#if c.profile.industry}{' · '}<a class="seclink" href="/sector?{c.profile.sector ? `sector=${c.profile.sector}&` : ''}industry={encodeURIComponent(c.profile.industry)}&country={c.security.exchange === 'TASE' ? 'IL' : 'US'}">{c.profile.industry}</a>{/if}{[c.profile.capUsd ? `${tx('капитализация', 'market cap')} ${capText(c.profile.capUsd)}` : '', c.profile.country ?? ''].filter(Boolean).map((x) => ` · ${x}`).join('')}
		</p>
	{/if}

	<Fold key="sec-chart" title={tx('График', 'Chart')} summary={PERIODS.find((p) => p[0] === period)?.[1]}>
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
		{#if c.sma}
			<div class="smas" role="group" aria-label={tx('Скользящие средние', 'Moving averages')}>
				{#each ['20', '50', '200'] as n (n)}
					<button class:on={smaOn.includes(n)} aria-pressed={smaOn.includes(n)} onclick={() => toggleSma(n)}>SMA {n}</button>
				{/each}
				<HelpIcon topicKey="chart.sma" label={tx('скользящие средние', 'moving averages')} />
			</div>
		{/if}
		<button class="hl" class:on={!!highlight} aria-pressed={!!highlight} onclick={toggleHighlight}>{highlight ? tx(`Подсвечен Q${highlight} — снять`, `Q${highlight} shaded — clear`) : tx('Подсветить квартал', 'Shade the quarter')}</button>
		<p class="muted small keys">
			● {tx('вход гипотезы', 'hypothesis entry')} · ■ {tx('выход', 'exit')} · <span class="up">▲</span> {tx('купил', 'bought')} · <span class="down">▼</span> {tx('продал', 'sold')}{#if newsMarks.length} · <span class="newsdot">●</span> {tx('новости (тап — новости дня)', 'news (tap — the day\'s news)')}{/if}{#if sources.length} · {#each sources as [id, name] (id)}<span class="src"><i style:background={colorOf(id)}></i>{tl(name)}</span>{/each}{/if}
		</p>
	{/if}
	</Fold>

	<!-- T-032 Д-20: the history — hypotheses, observations, decisions and conclusions on one line with the price -->
	<Fold key="sec-history" title={tx('История', 'History')} open={false}>
		{#snippet aside()}<HelpIcon topicKey="decision.history" label={tx('история', 'history')} />{/snippet}
		{#key page.params.id}<History securityId={Number(page.params.id)} />{/key}
	</Fold>

	<!-- T-032 Д-08: the diary of the security; an ETF or an index sees its shares' entries too -->
	<Fold key="sec-journal" title={tx('Дневник', 'Diary')}>
		{#snippet aside()}<HelpIcon topicKey="journal.inherit" label={tx('дневник бумаги', 'the security\'s diary')} />{/snippet}
		{#key page.params.id}
			<Feed
				scope={`security:${page.params.id}`}
				links={[{ type: 'security', id: String(page.params.id), label: c.security.symbol }, ...(wanted ? [{ type: 'position', id: String(wanted), label: tx('позиция', 'position') }] : [])]}
				inheritToggle={c.security.type !== undefined && c.security.type !== 'stock'}
			/>
		{/key}
	</Fold>

	{#if statsLoaded}
		<Fold key="sec-stats" title={tx('Показатели', 'Ratios')} summary={stats ? [stats.pe !== null && stats.pe !== undefined ? `P/E ${Number(stats.pe).toFixed(1)}` : '', stats.ps ? `P/S ${Number(stats.ps).toFixed(1)}` : '', stats.beta !== null && stats.beta !== undefined ? `${tx('бета', 'beta')} ${Number(stats.beta).toFixed(2)}` : ''].filter(Boolean).join(' · ') : tx('нет данных', 'no data')}>
			{#snippet aside()}<HelpIcon topicKey="security.stats" label={tx('показатели', 'ratios')} />{/snippet}
			{#if stats}<StatsGrid s={stats} />{:else}<p class="muted small">{tx('У провайдера нет показателей этой бумаги.', 'The provider has no ratios for this security.')}</p>{/if}
		</Fold>
	{/if}

	{#if news}
		{@const at = news.attribution}
		<div id="news"></div>
		<Fold key="sec-news" title={tx('Почему двигается', 'Why it moves')} summary={at ? tx(`${pp(at.total)}: рынок ${pp(at.market)} · сектор ${pp(at.sector)} · сама ${pp(at.own)}`, `${pp(at.total)}: market ${pp(at.market)} · sector ${pp(at.sector)} · itself ${pp(at.own)}`) : undefined}>
			{#snippet aside()}<HelpIcon topicKey="stock.news" label={tx('новости', 'news')} />{/snippet}
			{#if at}
				{@const parts = [
					{ k: 'market', label: `${tx('Рынок', 'Market')} · ${at.benchLabel}`, v: at.market },
					{ k: 'sector', label: `${tx('Сектор', 'Sector')}${at.sectorRef ? ` · ${at.sectorRef.symbol}` : ''}`, v: at.sector },
					{ k: 'own', label: tx('Сама бумага', 'The share itself'), v: at.own }
				]}
				{@const max = Math.max(1, ...parts.map((x) => Math.abs(x.v ?? 0)))}
				<p class="attr-head">
					<b>{pp(at.total)}</b>
					<span class="muted small">{at.live ? tx('сегодня', 'today') : `${tx('за', 'on')} ${short(at.date, true)}`}</span>
					<HelpIcon topicKey="stock.move_attribution" label={tx('разложение движения', 'move split')} />
				</p>
				{#each parts as x (x.k)}
					<div class="attr" class:big={x.v !== null && Math.abs(x.v) === Math.max(...parts.map((y) => Math.abs(y.v ?? 0)))}>
						<span class="al">{x.label}</span>
						<span class="track"><span class="mid"></span><span class="b" class:neg={(x.v ?? 0) < 0} style:width="{(Math.abs(x.v ?? 0) / max) * 50}%"></span></span>
						<span class="av">{pp(x.v)}</span>
					</div>
				{/each}
				{#if at.sector === null}<p class="muted small">{tx('Секторного ETF с ценами нет — сектор не выделен, он внутри «сама бумага».', 'No sector ETF with prices — the sector is not split out, it is inside «the share itself».')}</p>{/if}
			{/if}
			<div class="newsbar">
				<button class="primary" disabled={newsBusy} onclick={() => loadNews('POST')}>{newsBusy ? tx('Собираю…', 'Collecting…') : tx('Что происходит?', 'What is going on?')}</button>
				{#if news.fetchedAt}<span class="muted small">{tx('собрано', 'collected')} {ago(news.fetchedAt)} {tx('назад', 'ago')}</span>{/if}
			</div>
			<div class="levseg" role="radiogroup" aria-label={tx('Круг новостей', 'News circle')}>
				{#each [['stock', tx('Бумага', 'Share')], ['sector', tx('Сектор', 'Sector')], ['market', tx('Рынок', 'Market')]] as [r, l] (r)}
					<button role="radio" aria-checked={newsRole === r} class:on={newsRole === r} onclick={() => ((newsRole = r as Role), (newsLimit = 15))}>{l} · {newsCount(r as Role)}</button>
				{/each}
			</div>
			<p class="levsort muted small">
				{#if newsDay}
					{tx('День', 'Day')} <b>{short(newsDay, true)}</b> <button onclick={() => (newsDay = null)}>{tx('показать все', 'show all')}</button>
				{:else}
					{#each [[1, tx('день', 'day')], [7, tx('неделя', 'week')], [30, tx('месяц', 'month')]] as [d, l] (d)}
						<button class:on={newsDays === d} aria-pressed={newsDays === d} onclick={() => ((newsDays = Number(d)), (newsLimit = 15))}>{l}</button>
					{/each}
				{/if}
			</p>
			{#if newsRole === 'sector'}
				<p class="muted small">
					{#if peersEdit === null}
						{tx('Соседи', 'Neighbours')}: {news.peers.join(' · ') || tx('не найдены', 'none found')} <button class="textbtn" onclick={() => (peersEdit = news!.peers.join(', '))}>{tx('изменить', 'edit')}</button>
					{:else}
						<input class="peers" bind:value={peersEdit} placeholder="AMD, AVGO, TSM" aria-label={tx('Соседи через запятую', 'Neighbours, comma separated')} />
						<button class="textbtn" onclick={() => savePeers(peersEdit)}>{tx('сохранить', 'save')}</button>
						<button class="textbtn" onclick={() => savePeers(null)}>{tx('пять крупнейших', 'the five largest')}</button>
					{/if}
				</p>
			{/if}
			{#if !newsShown.length}
				<p class="muted small">{newsBusy ? tx('Собираю новости…', 'Collecting the news…') : tx('Новостей за этот период нет.', 'No news for this period.')}</p>
			{/if}
			<ul class="newslist">
				{#each newsShown.slice(0, newsLimit) as n (n.id)}
					<li class:hl={moveDays.has(dayOf(n.publishedAt))}>
						<a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
						<span class="muted small">{ago(n.publishedAt)}{n.publisher ? ` · ${n.publisher}` : ''}</span>
						{#if n.snippet}<span class="small snip">{n.snippet}</span>{/if}
						<a class="small rec" href="/new?url={encodeURIComponent(n.url)}&security={c.security.id}&signal=news">{tx('Записать гипотезу', 'Record a hypothesis')}</a>
					</li>
				{/each}
			</ul>
			{#if newsShown.length > newsLimit}<button class="more" onclick={() => (newsLimit += 15)}>{tx(`Показать ещё — осталось ${newsShown.length - newsLimit}`, `Show more — ${newsShown.length - newsLimit} left`)}</button>{/if}
			<p class="muted small">{tx('Новость объясняет прошлое. Вопрос один: сломан ли мой тезис?', 'News explains the past. One question: is my thesis broken?')}</p>
		</Fold>
	{/if}

	{#if cmp && cmp.refs.length}
		<Fold key="sec-compare" title={tx('С чем сравнить', 'Compare with')} summary={cmp.refs.map((r) => r.symbol).join(' · ')}>
			{#snippet aside()}<HelpIcon topicKey="security.compare" label={tx('сравнение', 'comparison')} />{/snippet}
			<div class="cmp">
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
			</div>
		</Fold>
	{/if}

	{#if lev && lev.length}
		{@const ups = lev.filter((l) => l.dir === 'long')}
		{@const downs = lev.filter((l) => l.dir === 'short')}
		{@const list = levDir === 'long' ? ups : downs}
		<Fold key="sec-lev" title={tx('ETF с плечом и на падение', 'Leveraged and inverse ETFs')} summary={tx(`${ups.length} на рост · ${downs.length} на падение`, `${ups.length} up · ${downs.length} down`)}>
			{#snippet aside()}<HelpIcon topicKey="security.leveraged" label={tx('плечо', 'leverage')} />{/snippet}
			<div class="levseg" role="radiogroup" aria-label={tx('Направление', 'Direction')}>
				<button role="radio" aria-checked={levDir === 'long'} class:on={levDir === 'long'} onclick={() => setLevDir('long')}>▲ {tx('На рост', 'Up')} · {ups.length}</button>
				<button role="radio" aria-checked={levDir === 'short'} class:on={levDir === 'short'} onclick={() => setLevDir('short')}>▼ {tx('На падение', 'Down')} · {downs.length}</button>
			</div>
			<p class="levsort muted small">
				{tx('Порядок:', 'Order:')}
				<button class:on={levSort === 'x'} aria-pressed={levSort === 'x'} onclick={() => (levSort = 'x')}>{tx('по плечу', 'by leverage')}</button>
				<button class:on={levSort === 'fee'} aria-pressed={levSort === 'fee'} onclick={() => (levSort = 'fee')}>{tx('по комиссии', 'by fee')}</button>
				· {tx('комиссия — в год', 'fee — a year')}
			</p>
			{#if !list.length}<p class="muted small">{levDir === 'long' ? tx('ETF на рост с плечом не нашлось.', 'No leveraged ETFs up.') : tx('ETF на падение не нашлось.', 'No inverse ETFs.')}</p>{/if}
			{#each LEVELS as level (level)}
				{@const rows = list.filter((l) => l.level === level).sort(levSort === 'fee' ? byFee : (a, b) => b.x - a.x || (a.expenseRatio ?? 9) - (b.expenseRatio ?? 9))}
				{#each [...new Set(rows.map((r) => r.label))] as label (label)}
					{@const group = rows.filter((r) => r.label === label)}
					<p class="levhead muted small">{levelName(group[0])}</p>
					<ul class="levlist">
						{#each group as l (l.id)}
							<li>
								<span class="x" class:up={l.dir === 'long'} class:down={l.dir === 'short'}>{l.dir === 'long' ? '▲' : '▼'} {xText(l.x)}</span>
								<a href="/security/{l.id}"><b>{l.symbol}</b></a>
								<span class="muted small nm">{l.name}</span>
								<span class="fee" title={tx('комиссия фонда в год', 'the fund\'s annual fee')}>{feeText(l.expenseRatio)}</span>
								<TvLink exchange={l.exchange} symbol={l.symbol} />
							</li>
						{/each}
					</ul>
				{/each}
			{/each}
			{#if levLoading}<p class="muted small">{tx(`Комиссии ${levLoading} фондов загружаются — появятся через минуту.`, `The fees of ${levLoading} funds are loading — they appear in a minute.`)}</p>{/if}
			<p class="muted small">{tx('Плечо — дневное: за один день фонд движется как акция ×N (на падение — против неё). За недели и месяцы итог расходится с ×N, тем сильнее, чем сильнее колебания. Это инструменты для коротких сделок.', 'The leverage is daily: over one day the fund moves as the share ×N (inverse — against it). Over weeks and months the result drifts from ×N, the more so the stronger the swings. These are tools for short trades.')}</p>
		</Fold>
	{/if}

	<div class="buttons">
		<a href="/portfolio?add={c.security.id}&kind=watch{mq}">{tx('Наблюдаю', 'Watching')}</a>
		<a href="/portfolio?add={c.security.id}&kind=plan_buy{mq}">{tx('Хочу купить', 'Want to buy')}</a>
		<a href="/portfolio?add={c.security.id}&kind=buy{mq}">{tx('Купил', 'Bought')}</a>
		<a href="/new">{tx('Гипотеза', 'Hypothesis')}</a>
		<button onclick={() => (deciding = 'skip')}>{tx('Не покупаю', 'Not buying')}</button>
		<button onclick={() => (deciding = 'defer')}>{tx('Отложить', 'Defer')}</button>
	</div>
	{#if deciding}<DecisionForm securityId={c.security.id} symbol={c.security.symbol} type={deciding} onclose={() => (deciding = null)} />{/if}

	{#if c.hypotheses.length}
		<Fold key="sec-hyps" title={tx('Гипотезы', 'Hypotheses')} summary={String(c.hypotheses.length)}>
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
		</Fold>
	{/if}
	{#if pastPositions.length}
		<Fold key="sec-positions" title={tx('Закрытые позиции', 'Closed positions')} summary={pastPositions.map((p) => p.portfolio).join(' · ')}>
		<ul class="list">
			{#each pastPositions as p (p.id)}
				<li>
					<a href="/security/{page.params.id}?position={p.id}" onclick={() => window.scrollTo({ top: 0 })}><span>{p.portfolio}</span><span class="muted small">{STAGE_LABEL[p.stage]}</span></a>
				</li>
			{/each}
		</ul>
		</Fold>
	{/if}
	{#if loadMs !== null}<p class="muted tiny">{tx('данные графика', 'chart data')} — {loadMs} {tx('мс', 'ms')}</p>{/if}
{:else if !problem}
	<div class="skeleton"></div>
{/if}

<style>
	.mypos {
		margin: 0 0 var(--s3);
		padding: var(--s3) var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}

	.levseg {
		display: flex;
		gap: var(--s2);
		margin: 0 0 var(--s2);
	}
	.levseg {
		flex-wrap: wrap;
	}
	.levseg button {
		white-space: nowrap;
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		cursor: pointer;
	}
	.levseg button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.levhead {
		margin: var(--s3) 0 var(--s1);
	}
	.levlist {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.levlist li {
		display: grid;
		grid-template-columns: 4.2em auto 1fr auto auto;
		align-items: center;
		gap: var(--s2);
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
	}
	.levlist .x {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		white-space: nowrap;
	}
	.levlist .x.up {
		color: var(--up);
	}
	.levlist .x.down {
		color: var(--down);
	}
	.levlist .fee {
		font-variant-numeric: tabular-nums;
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.attr-head {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin: 0 0 var(--s1);
	}
	.attr-head b {
		font-size: var(--fs-l);
	}
	.attr {
		display: grid;
		grid-template-columns: 9.5em 1fr 4em;
		align-items: center;
		gap: var(--s2);
		padding: 3px 0;
		font-size: var(--fs-s, 0.9rem);
	}
	.attr.big .al,
	.attr.big .av {
		font-weight: 700;
	}
	.attr .av {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.attr .track {
		position: relative;
		height: 10px;
	}
	.attr .mid {
		position: absolute;
		left: 50%;
		top: -2px;
		bottom: -2px;
		width: 1px;
		background: var(--line);
	}
	.attr .b {
		position: absolute;
		left: 50%;
		top: 0;
		height: 100%;
		border-radius: 0 3px 3px 0;
		background: var(--up);
	}
	.attr .b.neg {
		left: auto;
		right: 50%;
		border-radius: 3px 0 0 3px;
		background: var(--down);
	}
	.newsbar {
		display: flex;
		align-items: center;
		gap: var(--s3);
		margin: var(--s3) 0 var(--s2);
	}
	.newsbar .primary {
		white-space: nowrap;
		min-height: 40px;
		padding: 0 var(--s4);
		border: none;
		border-radius: var(--r-pill);
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.newslist {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.newslist li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s2) 0;
		border-bottom: 1px solid var(--line);
	}
	.newslist li.hl {
		border-left: 3px solid var(--accent);
		padding-left: var(--s2);
	}
	.newslist a {
		color: var(--text);
		text-decoration: none;
		font-weight: 500;
	}
	.newslist .snip {
		color: var(--muted);
	}
	.newslist a.rec {
		color: var(--link);
		font-weight: 400;
		align-self: flex-start;
	}
	.smas {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin: var(--s2) 0;
	}
	.smas button {
		min-height: 32px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.smas button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.trendwarn {
		color: var(--down);
	}
	.star {
		border: none;
		background: none;
		font-size: 1.4rem;
		line-height: 1;
		color: var(--muted);
		cursor: pointer;
		padding: 0 4px;
	}
	.star.on {
		color: var(--warn-text, #b8860b);
	}
	.risks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin: 0 0 var(--s2);
	}
	.risks .rk {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text);
		text-decoration: none;
		padding: 2px 6px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
	}
	.newsdot {
		color: var(--muted);
		font-size: 0.7em;
	}
	.textbtn {
		border: none;
		background: none;
		padding: 0 4px;
		color: var(--link);
		cursor: pointer;
		font: inherit;
	}
	.peers {
		width: 12em;
		min-height: 32px;
		padding: 0 var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
	}
	.levsort button {
		border: none;
		background: none;
		padding: 2px 4px;
		color: var(--link);
		cursor: pointer;
		font: inherit;
	}
	.levsort button.on {
		color: var(--text);
		font-weight: 600;
	}
	.levlist .nm {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
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
		margin: 0;
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
	.seclink {
		color: var(--link);
		text-decoration: none;
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
	.buttons a,
	.buttons button {
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
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
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
