<script lang="ts">
	import Fold from '#lib/Fold.svelte';
	import FlagChips from '#lib/path/FlagChips.svelte';
	import type { Flag } from '#lib/path.js';
	import Feed from '#lib/journal/Feed.svelte';
	import ToJournal from '#lib/journal/ToJournal.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import TopBar from '#lib/TopBar.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import TvLink from '#lib/TvLink.svelte';
	import RiskLabel from '#lib/RiskLabel.svelte';
	import RecentCards from '#lib/RecentCards.svelte';
	import ScreenSwitch from '#lib/ScreenSwitch.svelte';
	import CommodityFunds from '#lib/CommodityFunds.svelte';
	import { keepScroll } from '#lib/scroll.js';
	import { showToast } from '#lib/toast.svelte.js';
	import { loc, tx } from '#lib/i18n.js';
	import { sectorName } from '#lib/allocation.js';

	/** Spec section 21, T-009 — the quarterly model: parameters with «?», a live preview, the candidates. */
	type Variant = 'A' | 'B' | 'C' | 'D' | 'G';
	const isScored = (v: Variant) => v === 'C' || v === 'G';
	interface Params {
		years: number;
		k: number;
		count: number;
		perSector: number;
		perMarket: number;
		minTurnoverUsd: number;
		minPriceUsd: number;
		sort: 'mean' | 'median' | 'worst';
		compareWith: 'market' | 'sector';
		capMode: 'abs' | 'rel';
		capGroups: string[];
		capBounds: number[];
			commissionPct: number;
		commissionMinUsd: number;
		taxPct: number;
		trendFilter: 'none' | 'price_sma10' | 'sma3_sma10';
		trendExit: 'none' | 'sma3';
		lagThreshold: number;
	}
	interface Cand {
		id: number;
		symbol: string;
		name: string;
		exchange: string;
		market: 'US' | 'IL';
		sector: string | null;
		results: (number | null)[];
		up: number;
		mean: number;
		median: number;
		worst: number;
		capUsd: number | null;
		capGroup: string | null;
		score: number | null;
		months: (number | null)[];
		own: { mean: number | null; median: number | null; up: number; years: number };
		sma10: number | null;
		reasons: { earnings: boolean | null; dividend: boolean | null; sector: boolean };
	}
	interface Data {
		variant: Variant;
		pool?: 'stocks' | 'commodities';
		funds?: { symbol: string; name: string | null; group: 'precious' | 'energy' | 'industrial' | 'agriculture' | 'broad'; twin: string | null; years: number | null; firstMonth: string | null; excluded: 'levered' | 'unknown' | 'no_prices' | 'short' | null }[] | null;
		loading?: { missing: string[]; loading: boolean } | null;
		saved: Params;
		result: null | {
			quarter: number;
			forYear: number;
			years: number[];
			universe: number;
			noHistory: number;
			illiquid: number;
			capCounts: Record<string, number>;
			capOut: number;
			passed: number;
			expected: number;
			placebo: { runs: number; real: number; mean: number; share: number; verdict: 'signal' | 'unclear' | 'chance' };
			p: number;
			candidates: Cand[];
			trendOut: number;
			months: (number | null)[];
			capped: number;
			bench: { US: (number | null)[]; IL: (number | null)[] };
			walk: { year: number; picked: number; pickedMean: number | null; allMean: number | null; pickedUp: number }[];
			dataMonth: string;
		};
		upcoming: { year: number; quarter: number; key: string; days: number; ready: boolean };
		recorded: { variant: string; quarter: string; hypotheses: number; at: string }[];
		data: { stocks: number; shares: number; sectors: number; loads: { n: number; ok: number | null; at: string | null } };
		ms: number;
	}

	const read = (k: string, d: string) => {
		try {
			return localStorage.getItem(k) ?? d;
		} catch {
			return d;
		}
	};
	let variant = $state<Variant>('A');
	let quarter = $state<number | null>(null);
	let params = $state<Params | null>(null);
	const scroll = keepScroll(() => 'model');
	let data = $state<Data | null>(null);
	let problem = $state<string | null>(null);
	let busy = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	async function load(withParams: boolean) {
		const q = new URLSearchParams({ variant });
		if (pool === 'commodities') q.set('pool', pool);
		if (quarter) q.set('quarter', String(quarter));
		if (withParams && params) for (const [k, v] of Object.entries(params)) q.set(k, String(v));
		const my = ++seq;
		busy = true;
		const r = await fetch(`/api/model?${q}`).catch(() => null);
		if (my !== seq) return;
		busy = false;
		if (!r?.ok) return void (problem = tx('Нет связи с сервером.', 'No connection to the server.'));
		problem = null;
		data = await r.json();
		void scroll.restore();
		if (!withParams) params = { ...data!.saved };
		// a preview kept before a parameter was added: the new ones come from the saved
		else if (params) params = { ...data!.saved, ...params };
		void loadCosts(q, my);
		void loadTrend(q, my);
		void loadCompare();
		void loadRisk();
		void loadPicks();
		if (!quarter && data!.result) quarter = data!.result.quarter;
	}
	// T-012: the variant's portfolio over the last 12 quarters before and after the costs
	interface CostBook {
		cagr: number | null;
		fees: number;
		taxes: number;
		turnover: number;
		kept: number;
		endValue: number;
	}
	interface Costs {
		quarters: { label: string; picked: number; kept: number; gross: number | null; hold: number | null; noHold: number | null }[];
		years: number;
		start: number;
		gross: number | null;
		hold: CostBook;
		noHold: CostBook;
	}
	let costs = $state<{ costs: Costs | null; portfolios: { id: number; name: string; hold: number }[] } | null>(null);
	let costsBusy = $state(false);
	let quartersOpen = $state(false);
	async function loadCosts(q: URLSearchParams, my: number) {
		const c = new URLSearchParams(q);
		c.delete('quarter');
		costsBusy = true;
		const r = await fetch(`/api/model/costs?${c}`).catch(() => null);
		if (my !== seq) return;
		costsBusy = false;
		if (r?.ok) costs = await r.json();
	}
	// T-018: trend filter × exit, the laggards, the variants side by side
	interface TStats {
		excess: number | null;
		median: number | null;
		worst: number | null;
		maxDrawdown: number | null;
		avgCount: number;
		under5: number;
		years: number;
	}
	interface TRow {
		filter: string;
		exit: string;
		all: TStats;
		walk: TStats;
		placebo: { runs: number; mean: number | null; share: number; verdict: 'signal' | 'unclear' | 'chance' };
	}
	interface Lag {
		n: number;
		corr: number | null;
		all: { mean3: number | null; up3: number | null; excess3: number | null };
		lag: { n: number; mean3: number | null; up3: number | null; excess3: number | null };
		placebo: { runs: number; mean: number | null; share: number };
		verdict: 'catch_up' | 'no' | 'unclear';
		threshold: number;
	}
	let trend = $state<{ table: TRow[]; laggards: Lag | null; ms: number } | null>(null);
	let trendBusy = $state(false);
	let trendWalk = $state(false);
	async function loadTrend(q: URLSearchParams, my: number) {
		trendBusy = true;
		const r = await fetch(`/api/model/trend?${q}`).catch(() => null);
		if (my !== seq) return;
		trendBusy = false;
		if (r?.ok) trend = await r.json();
	}
	interface VRow {
		variant: Variant;
		passed: number;
		candidates: number;
		placebo: { real: number; mean: number; share: number; verdict: 'signal' | 'unclear' | 'chance' };
		walkVsAll: number | null;
		gross: number | null;
		afterCosts: number | null;
	}
	let compareV = $state<VRow[] | null>(null);
	// picked securities (owner 26.11.2026): first in the list, kept when the parameters change
	let picks = $state<{ id: number; symbol: string; name: string; origin: string | null }[]>([]);
	async function loadPicks() {
		const r = await fetch('/api/shortlist').then((x) => x.json()).catch(() => null);
		picks = r?.items ?? [];
	}
	async function togglePick(id: number, on: boolean) {
		await fetch('/api/shortlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ securityId: id, on, origin: `модель ${variant} Q${data?.result?.quarter ?? ''}` }) }).catch(() => null);
		void loadPicks();
	}
	const pickedSet = $derived(new Set(picks.map((p) => p.id)));
	const candsSorted = $derived(
		data?.result ? data.result.candidates.map((c, i) => ({ c, i })).sort((a, b) => Number(pickedSet.has(b.c.id)) - Number(pickedSet.has(a.c.id)) || a.i - b.i) : []
	);
	const picksOutside = $derived(picks.filter((p) => !data?.result?.candidates.some((c) => c.id === p.id)));
	// T-023 (4): what each candidate does to the largest real portfolio's risk
	let riskLabels = $state<Record<number, { label: string; twin: string | null }>>({});
	let riskPortfolio = $state<string | null>(null);
	async function loadRisk() {
		const ids = data?.result?.candidates.map((c) => c.id) ?? [];
		if (!ids.length) return;
		const r = await fetch(`/api/risk/labels?ids=${ids.join(',')}`).then((x) => x.json()).catch(() => null);
		riskLabels = r?.items ?? {};
		riskPortfolio = r?.portfolio?.name ?? null;
		// T-033: the marks of the return's path
		const f = await fetch(`/api/path?flags=${ids.join(',')}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
		pathFlags = f?.items ?? {};
	}
	let pathFlags = $state<Record<number, Flag[]>>({});
	async function loadCompare() {
		const q = quarter || data?.result?.quarter;
		if (!q) return;
		const r = await fetch(`/api/model/compare?quarter=${q}${pool === 'commodities' ? '&pool=commodities' : ''}`).catch(() => null);
		if (r?.ok) compareV = (await r.json()).items;
	}
	const VNAME: Record<Variant, [string, string]> = { A: ['А. Рост', 'A. Rise'], B: ['Б. Рынок', 'B. Market'], C: ['В. Оценка', 'C. Score'], D: ['Д. Тренд', 'D. Trend'], G: ['Г. Причина', 'G. Reason'] };
	const FNAME: Record<string, [string, string]> = { none: ['без фильтра', 'no filter'], price_sma10: ['цена > SMA10', 'price > SMA10'], sma3_sma10: ['SMA3 > SMA10', 'SMA3 > SMA10'] };
	const VERDICT: Record<string, [string, string]> = { signal: ['сигнал', 'signal'], unclear: ['неясно', 'unclear'], chance: ['случайность', 'chance'] };
	const LAG: Record<string, [string, string]> = { catch_up: ['отставшие догоняют', 'laggards catch up'], no: ['отставшие не догоняют', 'laggards do not catch up'], unclear: ['неясно', 'unclear'] };

	const usd = (x: number) => `${Math.round(x).toLocaleString(loc())} $`;

	// the screen is remembered on this device (owner's request 20.11.2026): the variant, the quarter and the
	// parameters tried but not saved — coming back from a card or another tab, nothing is set again
	type Kept = { variant?: Variant; quarter?: number; pool?: Pool; preview?: Partial<Record<string, Params>> };
	// T-031: the shares or the commodity funds — the commodities have the variants A and B, kept apart (cA, cB)
	type Pool = 'stocks' | 'commodities';
	let pool = $state<Pool>('stocks');
	const vkey = (v: Variant = variant) => (pool === 'commodities' ? `c${v}` : v);
	let kept: Kept = {};
	const keep = () => {
		try {
			localStorage.setItem('model-screen', JSON.stringify(kept));
		} catch {
			/* private mode */
		}
	};
	function open(v: Variant) {
		const pv = kept.preview?.[vkey(v)];
		if (pv) {
			params = { ...pv };
			void load(true);
		} else void load(false);
	}
	onMount(() => {
		try {
			kept = JSON.parse(localStorage.getItem('model-screen') ?? '{}') ?? {};
		} catch {
			kept = {};
		}
		variant = kept.variant ?? ((['A', 'B', 'C', 'D', 'G'] as const).find((v) => v === read('model-variant', 'A')) ?? 'A');
		pool = kept.pool === 'commodities' ? 'commodities' : 'stocks';
		if (pool === 'commodities' && variant !== 'A' && variant !== 'B') variant = 'A';
		if (kept.quarter && [1, 2, 3, 4].includes(kept.quarter)) quarter = kept.quarter;
		open(variant);
	});
	onDestroy(() => clearTimeout(timer));

	/** a parameter changed: the preview follows at once (a short pause while a stepper is tapped) */
	function set<K extends keyof Params>(k: K, v: Params[K]) {
		if (!params) return;
		params = { ...params, [k]: v };
		if (k === 'years' && params.k > params.years) params.k = params.years;
		kept.preview = { ...kept.preview, [vkey()]: params };
		keep();
		clearTimeout(timer);
		timer = setTimeout(() => void load(true), 200);
	}
	function setPool(p: Pool) {
		pool = p;
		kept.pool = p;
		if (p === 'commodities' && variant !== 'A' && variant !== 'B') variant = 'A';
		kept.variant = variant;
		keep();
		compareV = null;
		open(variant);
	}
	function setVariant(v: Variant) {
		variant = v;
		kept.variant = v;
		keep();
		open(v);
	}
	function setQuarter(q: number) {
		quarter = q;
		kept.quarter = q;
		keep();
		void load(true);
	}
	function forget() {
		if (kept.preview) delete kept.preview[vkey()];
		keep();
	}
	/** the parameters on screen, for the card: it shows the candidate as the preview found it */
	const previewQuery = () => new URLSearchParams(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])).toString();
	const changed = $derived(!!params && !!data && JSON.stringify(params) !== JSON.stringify(data.saved));
	async function save() {
		const r = await fetch('/api/model', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variant, pool, ...params }) }).catch(() => null);
		if (!r?.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		data = { ...data!, saved: (await r.json()).saved };
		forget();
		showToast(tx('Параметры сохранены — по ним модель запишет гипотезы квартала', 'Parameters saved — the model records the quarter by them'));
	}

	const res = $derived(data?.result ?? null);
	// T-010: the verdict comes from the placebo (100 runs with the quarters shuffled), not from the rough formula
	const verdict = $derived(!res ? null : res.passed === 0 ? 'none' : res.placebo.verdict);
	const pct = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}%`);
	const money = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1)} ${tx('млн $', 'M $')}` : `${Math.round(x / 1000)} ${tx('тыс. $', 'K $')}`);
	const label = $derived(tx('Q', 'Q'));

	const PARAMS: { key: keyof Params; help: string; ru: string; en: string; min: number; max: number; step: number }[] = [
		{ key: 'k', help: 'model.param.k', ru: 'Лет с ростом, не меньше (K)', en: 'Years with a rise, at least (K)', min: 1, max: 15, step: 1 },
		{ key: 'years', help: 'model.param.years', ru: 'Лет истории', en: 'Years of history', min: 5, max: 15, step: 1 },
		{ key: 'count', help: 'model.param.count', ru: 'Кандидатов', en: 'Candidates', min: 1, max: 30, step: 1 },
		{ key: 'perSector', help: 'model.param.per_sector', ru: 'Не больше из сектора', en: 'At most per sector', min: 1, max: 30, step: 1 },
		{ key: 'perMarket', help: 'model.param.per_market', ru: 'Не больше из рынка', en: 'At most per market', min: 1, max: 30, step: 1 },
		{ key: 'minPriceUsd', help: 'model.param.min_price', ru: 'Цена не ниже, $', en: 'Price at least, $', min: 0, max: 1000, step: 1 }
	];
	// T-012: the costs of the variant's portfolios
	const COST_PARAMS: { key: keyof Params; ru: string; en: string; min: number; max: number; step: number }[] = [
		{ key: 'commissionPct', ru: 'Комиссия, % сделки', en: 'Fee, % of a trade', min: 0, max: 2, step: 0.05 },
		{ key: 'commissionMinUsd', ru: 'Комиссия не меньше, $', en: 'Fee at least, $', min: 0, max: 50, step: 1 },
		{ key: 'taxPct', ru: 'Налог с прибыли, %', en: 'Tax on gains, %', min: 0, max: 50, step: 5 }
	];
	const round3 = (x: number) => Math.round(x * 1000) / 1000;
	// T-021: market cap groups
	const CAP_ABS = ['mega', 'large', 'mid', 'small', 'micro'];
	const CAP_REL = ['top', 'middle', 'bottom'];
	const CAP_NAME: Record<string, [string, string]> = {
		mega: ['крупнейшие', 'mega'],
		large: ['крупные', 'large'],
		mid: ['средние', 'mid'],
		small: ['малые', 'small'],
		micro: ['микро', 'micro'],
		top: ['верхние 20%', 'top 20%'],
		middle: ['середина', 'middle'],
		bottom: ['нижние 30%', 'bottom 30%']
	};
	const capName = (g: string | null) => (g && CAP_NAME[g] ? tx(...CAP_NAME[g]) : tx('нет данных', 'no data'));
	const bn = (x: number) => (x >= 1e9 ? `${+(x / 1e9).toFixed(1)}` : `${+(x / 1e9).toFixed(2)}`);
	const capText = (x: number | null) => (x === null ? '' : x >= 1e12 ? `${(x / 1e12).toFixed(1)} ${tx('трлн $', 'T $')}` : x >= 1e9 ? `${Math.round(x / 1e9)} ${tx('млрд $', 'B $')}` : `${Math.round(x / 1e6)} ${tx('млн $', 'M $')}`);
	/** the range of an absolute group by the bounds: «10–200 млрд $» */
	function capRange(g: string, b: number[]) {
		const i = CAP_ABS.indexOf(g);
		if (i === 0) return `> ${bn(b[0])}`;
		if (i === 4) return `< ${bn(b[3])}`;
		return `${bn(b[i])}–${bn(b[i - 1])}`;
	}
	function toggleCap(g: string) {
		if (!params) return;
		const all = params.capMode === 'rel' ? CAP_REL : CAP_ABS;
		const on = params.capGroups.length ? params.capGroups : all;
		let next = on.includes(g) ? on.filter((x) => x !== g) : [...on, g];
		if (!next.length || next.length === all.length) next = [];
		set('capGroups', next);
	}
	let boundsOpen = $state(false);
	function setBound(i: number, v: string) {
		if (!params) return;
		const n = Number(v.replace(',', '.')) * 1e9;
		if (!(n >= 0)) return;
		const b = [...params.capBounds];
		b[i] = n;
		if (b.every((x, j) => j === 0 || x < b[j - 1])) set('capBounds', b);
	}
	const TURNOVER = [0, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];
</script>

<svelte:head><title>{tx('Модель', 'Model')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Квартальная модель', 'Quarterly model')} help="model.guide" back={{ href: '/more', label: tx('Ещё', 'More') }} />

{#if data?.upcoming.ready}
	<p class="banner" role="status">
		{tx(`Кандидаты ${data.upcoming.key} готовы`, `Candidates for ${data.upcoming.key} are ready`)} — {tx(`до начала квартала ${data.upcoming.days} дн.`, `${data.upcoming.days} days to the quarter`)}
		{tx('В первый торговый день модель запишет гипотезы сама.', 'On the first trading day the model records the hypotheses itself.')}
	</p>
{/if}

{#if problem}<p class="err">{problem}</p>{/if}

{#if pool === 'commodities' && data?.loading?.missing.length}
	<p class="banner" role="status">{tx(`Месячные цены фондов загружаются: ${data.loading.missing.join(', ')}. Обновите экран через минуту.`, `Monthly prices of the funds are loading: ${data.loading.missing.join(', ')}. Refresh in a minute.`)}</p>
{/if}

{#if pool === 'stocks' && data && data.data.stocks < 500}
	<section class="card">
		<h2>{tx('Данные загружаются', 'Data are loading')}</h2>
		<p class="muted">
			{tx(`Месячные цены за 15 лет грузятся по ночам порциями: загружено ${data.data.stocks} из ${data.data.shares} акций. Модель заработает, когда их будет больше 500; полная загрузка — за одну-две ночи.`, `Monthly prices for 15 years load at night in portions: ${data.data.stocks} of ${data.data.shares} shares loaded. The model starts working at 500; the full load takes a night or two.`)}
		</p>
	</section>
{/if}

<ScreenSwitch />
<RecentCards />

<div class="seg" role="radiogroup" aria-label={tx('Выборка', 'Universe')}>
	<button role="radio" aria-checked={pool === 'stocks'} class:on={pool === 'stocks'} onclick={() => setPool('stocks')}>{tx('Акции', 'Shares')}</button>
	<button role="radio" aria-checked={pool === 'commodities'} class:on={pool === 'commodities'} onclick={() => setPool('commodities')}>{tx('Сырьё', 'Commodities')}</button>
	<HelpIcon topicKey="model.commodities" label={tx('сырьё', 'commodities')} />
</div>

<div class="seg" role="radiogroup" aria-label={tx('Вариант', 'Variant')}>
	<button role="radio" aria-checked={variant === 'A'} class:on={variant === 'A'} onclick={() => setVariant('A')}>{tx('А. Рост цены', 'A. Price rise')}</button>
	<button role="radio" aria-checked={variant === 'B'} class:on={variant === 'B'} onclick={() => setVariant('B')}>{pool === 'commodities' ? tx('Б. Против DBC', 'B. Against DBC') : tx('Б. Против рынка', 'B. Against the market')}</button>
	{#if pool === 'stocks'}
	<button role="radio" aria-checked={variant === 'C'} class:on={variant === 'C'} onclick={() => setVariant('C')}>{tx('В. Оценка', 'C. Score')}</button>
	<button role="radio" aria-checked={variant === 'G'} class:on={variant === 'G'} onclick={() => setVariant('G')}>{tx('Г. С причиной', 'G. With a reason')}</button>
	<button role="radio" aria-checked={variant === 'D'} class:on={variant === 'D'} onclick={() => setVariant('D')}>{tx('Д. Против тренда', 'D. Against its trend')}</button>
	{/if}
	<HelpIcon topicKey="model.variants" label={tx('варианты', 'variants')} />
</div>

<div class="quarters" role="radiogroup" aria-label={tx('Квартал', 'Quarter')}>
	{#each [1, 2, 3, 4] as q (q)}
		<button role="radio" aria-checked={quarter === q} class:on={quarter === q} onclick={() => setQuarter(q)}>{label}{q}</button>
	{/each}
</div>

{#if params}
	<Fold key="model-params" title={tx('Параметры', 'Parameters')} summary={`${isScored(variant) ? '' : `K ${params.k} · `}${tx(`${params.years} лет`, `${params.years} years`)} · ${tx(`${params.count} кандидатов`, `${params.count} candidates`)}${changed ? tx(' · не сохранены', ' · not saved') : ''}`}>
		{#snippet aside()}{#if busy}<span class="muted small">{tx('считаю…', 'computing…')}</span>{/if}{/snippet}
		{#each PARAMS.filter((f) => (!isScored(variant) || f.key !== 'k') && (pool === 'stocks' || f.key !== 'perMarket')) as f (f.key)}
			<div class="prow">
				<span class="pl">{pool === 'commodities' && f.key === 'perSector' ? tx('Не больше из группы', 'At most per group') : tx(f.ru, f.en)} <HelpIcon topicKey={f.help} label={tx(f.ru, f.en)} /></span>
				<span class="stepper">
					<button aria-label="−" disabled={Number(params[f.key]) <= f.min} onclick={() => set(f.key, Math.max(f.min, Number(params![f.key]) - f.step) as never)}>−</button>
					<b>{params[f.key]}</b>
					<button aria-label="+" disabled={Number(params[f.key]) >= (f.key === 'k' ? params.years : f.max)} onclick={() => set(f.key, Math.min(f.key === 'k' ? params!.years : f.max, Number(params![f.key]) + f.step) as never)}>+</button>
				</span>
			</div>
		{/each}
		<div class="prow">
			<span class="pl">{tx('Оборот в день, не меньше', 'Daily turnover, at least')} <HelpIcon topicKey="model.param.min_turnover" label={tx('оборот', 'turnover')} /></span>
			<select value={params.minTurnoverUsd} onchange={(e) => set('minTurnoverUsd', Number(e.currentTarget.value))}>
				{#each TURNOVER as t (t)}<option value={t}>{t ? money(t) : tx('без порога', 'no threshold')}</option>{/each}
			</select>
		</div>
		{#if !isScored(variant)}<div class="prow">
			<span class="pl">{tx('Сортировка', 'Sort by')} <HelpIcon topicKey="model.param.sort" label={tx('сортировка', 'sort')} /></span>
			<select value={params.sort} onchange={(e) => set('sort', e.currentTarget.value as Params['sort'])}>
				<option value="mean">{tx('по среднему', 'mean')}</option>
				<option value="median">{tx('по медиане', 'median')}</option>
				<option value="worst">{tx('по худшему году', 'worst year')}</option>
			</select>
		</div>{/if}
		{#if pool === 'stocks'}
		<div class="prow caprow">
			<span class="pl">{tx('Капитализация', 'Market cap')} <HelpIcon topicKey="model.param.market_cap" label={tx('капитализация', 'market cap')} /></span>
			<div class="seg2" role="radiogroup" aria-label={tx('Как делить', 'How to split')}>
				<button role="radio" aria-checked={params.capMode === 'abs'} class:on={params.capMode === 'abs'} onclick={() => (set('capMode', 'abs'), set('capGroups', []))}>{tx('в $', 'in $')}</button>
				<button role="radio" aria-checked={params.capMode === 'rel'} class:on={params.capMode === 'rel'} onclick={() => (set('capMode', 'rel'), set('capGroups', []))}>{tx('от рынка', 'by market')}</button>
			</div>
		</div>
		<div class="capchips">
			{#each params.capMode === 'rel' ? CAP_REL : CAP_ABS as g (g)}
				{@const on = !params.capGroups.length || params.capGroups.includes(g)}
				<button class:on aria-pressed={on} onclick={() => toggleCap(g)}>
					{capName(g)}{#if params.capMode === 'abs'}{' '}<small>{capRange(g, params.capBounds)}</small>{/if}{#if res?.capCounts?.[g] !== undefined}{' '}<small>· {res.capCounts[g]}</small>{/if}
				</button>
			{/each}
			{#if params.capMode === 'abs'}<button class="link" onclick={() => (boundsOpen = !boundsOpen)}>{tx('границы, млрд $', 'bounds, $B')}</button>{/if}
		</div>
		{#if boundsOpen && params.capMode === 'abs'}
			<div class="bounds">
				{#each [tx('крупнейшие от', 'mega from'), tx('крупные от', 'large from'), tx('средние от', 'mid from'), tx('малые от', 'small from')] as l, i (i)}
					<label>{l} <input inputmode="decimal" value={bn(params.capBounds[i])} onchange={(e) => setBound(i, e.currentTarget.value)} /></label>
				{/each}
			</div>
		{/if}
		{/if}
		<div class="prow">
			<span class="pl">{tx('Фильтр тренда', 'Trend filter')} <HelpIcon topicKey="model.trend_filter" label={tx('фильтр тренда', 'trend filter')} /></span>
			<select value={params.trendFilter} onchange={(e) => set('trendFilter', e.currentTarget.value as Params['trendFilter'])}>
				<option value="none">{tx('нет', 'none')}</option>
				<option value="price_sma10">{tx('цена выше SMA 10 мес.', 'price above SMA 10 mo')}</option>
				<option value="sma3_sma10">{tx('SMA 3 мес. выше SMA 10 мес.', 'SMA 3 mo above SMA 10 mo')}</option>
			</select>
		</div>
		<div class="prow">
			<span class="pl">{tx('Выход по тренду', 'Trend exit')} <HelpIcon topicKey="model.trend_exit" label={tx('выход по тренду', 'trend exit')} /></span>
			<select value={params.trendExit} onchange={(e) => set('trendExit', e.currentTarget.value as Params['trendExit'])}>
				<option value="none">{tx('нет', 'none')}</option>
				<option value="sma3">{tx('продать, если закрытие месяца ниже SMA 3 мес.', 'sell if a month closes below SMA 3 mo')}</option>
			</select>
		</div>
		{#if pool === 'stocks' && (variant === 'B' || isScored(variant))}
			<div class="prow">
				<span class="pl">{tx('Сравнивать', 'Compare with')} <HelpIcon topicKey="model.param.compare_with" label={tx('сравнение', 'comparison')} /></span>
				<select value={params.compareWith} onchange={(e) => set('compareWith', e.currentTarget.value as Params['compareWith'])}>
					<option value="market">{tx('с рынком', 'the market')}</option>
					<option value="sector">{tx('с сектором', 'the sector')}</option>
				</select>
			</div>
		{/if}
		<h3 class="sub">{tx('Издержки', 'Costs')} <HelpIcon topicKey="model.costs" label={tx('издержки', 'costs')} /></h3>
		{#each COST_PARAMS as f (f.key)}
			<div class="prow">
				<span class="pl">{tx(f.ru, f.en)}</span>
				<span class="stepper">
					<button aria-label="−" disabled={Number(params[f.key]) <= f.min} onclick={() => set(f.key, round3(Math.max(f.min, Number(params![f.key]) - f.step)) as never)}>−</button>
					<b>{String(params[f.key]).replace('.', loc() === 'ru-RU' ? ',' : '.')}</b>
					<button aria-label="+" disabled={Number(params[f.key]) >= f.max} onclick={() => set(f.key, round3(Math.min(f.max, Number(params![f.key]) + f.step)) as never)}>+</button>
				</span>
			</div>
		{/each}
		{#if changed}
			<div class="save">
				<button class="primary" onclick={save}>{tx('Сохранить параметры', 'Save the parameters')}</button>
				<button class="ghost" onclick={() => (forget(), (params = { ...data!.saved }), load(false))}>{tx('Вернуть сохранённые', 'Back to the saved')}</button>
			</div>
			<p class="muted small">{tx('Меняйте параметры не чаще раза в квартал и до его начала: новая версия параметров — новая строка в статистике.', 'Change the parameters at most once a quarter and before it starts: a new version is a new row in the stats.')}</p>
		{/if}
	</Fold>
{/if}

{#if pool === 'commodities' && data?.funds}
	<CommodityFunds rows={data.funds} minYears={params?.years ?? 10} onchange={() => load(true)} />
{/if}

{#if res}
	<Fold key="model-candidates" title={`${tx('Кандидаты', 'Candidates')} Q${res.quarter} ${res.forYear}`} summary={res.candidates.map((x) => x.symbol).join(' · ')}>
		{#snippet aside()}<HelpIcon topicKey="model.quarterly" label={tx('как считается', 'how it is computed')} />{/snippet}
		<p class="sum">
			{tx('Выборка', 'Universe')} <b>{res.universe}</b> {tx('акций', 'shares')} · {isScored(variant) ? tx('балл ≥ 2', 'score ≥ 2') : tx('прошли фильтр', 'passed')} <b>{res.passed}</b>{#if isScored(variant)} <HelpIcon topicKey="model.score" label={tx('балл', 'score')} />{/if}
		</p>
		<p class="placebo {res.placebo.verdict}">
			<span class="badge">{res.placebo.verdict === 'signal' ? tx('сигнал', 'signal') : res.placebo.verdict === 'unclear' ? tx('неясно', 'unclear') : tx('похоже на случайность', 'looks like chance')}</span>
			<span>
				{tx(`Настоящий расчёт нашёл ${res.placebo.real}, пустышка — в среднем ${res.placebo.mean}; не меньше нашли ${Math.round(res.placebo.share * 100)}% из ${res.placebo.runs} пустышек.`, `The real calculation found ${res.placebo.real}, the placebo — ${res.placebo.mean} on average; ${Math.round(res.placebo.share * 100)}% of ${res.placebo.runs} placebos found as many or more.`)}
			</span>
			<HelpIcon topicKey="model.placebo" label={tx('пустышка', 'placebo')} />
		</p>
		<p class="muted small">
			{tx(`Годы ${res.years[0]}–${res.years.at(-1)}, данные по ${res.dataMonth}; без 10 лет истории — ${res.noHistory}, мало оборота или дешевле порога — ${res.illiquid}; доля растущих кварталов ${Math.round(res.p * 100)}%.`, `Years ${res.years[0]}–${res.years.at(-1)}, data to ${res.dataMonth}; without the full history — ${res.noHistory}, too little turnover or too cheap — ${res.illiquid}; share of rising quarters ${Math.round(res.p * 100)}%.`)}
			{tx(`Грубая оценка по формуле — ≈ ${res.expected}.`, `The rough formula — ≈ ${res.expected}.`)} <HelpIcon topicKey="model.chance" label={tx('формула случайности', 'the chance formula')} />
			{#if data}· {data.ms} {tx('мс', 'ms')}{/if}
		</p>
		{#if verdict === 'chance'}
			<p class="warn">{tx('Пустышка находит столько же: кандидаты этого варианта не лучше случайных.', 'The placebo finds as many: these candidates are no better than random ones.')}</p>
		{:else if verdict === 'none'}
			<p class="warn">{isScored(variant) ? tx('Ни у одной бумаги балл не выше 2 — кандидаты ниже показаны по баллу, но уверенности нет.', 'No share has a score of 2 or more — the candidates below are ranked by score, without confidence.') : tx('Фильтр не прошла ни одна бумага — ослабьте K или пороги.', 'No share passed — lower K or the thresholds.')}</p>
		{/if}
		{#if riskPortfolio}<p class="muted small">{tx(`Метка риска — для портфеля «${riskPortfolio}», покупка на 5% из свободных денег.`, `The risk label — for the portfolio «${riskPortfolio}», a purchase of 5% from cash.`)} <HelpIcon topicKey="portfolio.whatif" label={tx('что если', 'what if')} /></p>{/if}
		{#if res.trendOut}<p class="muted small">{tx(`Фильтр тренда отсёк ${res.trendOut} из прошедших.`, `The trend filter left out ${res.trendOut} of those that passed.`)}</p>{/if}
		{#if res.candidates.length && res.months.some((m) => m !== null)}
			<p class="muted small">{tx('Рост кандидатов по месяцам квартала, в среднем за годы окна:', 'The candidates\' rise by month of the quarter, mean over the window:')} {res.months.map((m, i) => `${tx('м', 'm')}${i + 1} ${pct(m)}`).join(' · ')} <HelpIcon topicKey="model.months" label={tx('по месяцам', 'by month')} /></p>
		{/if}
		{#if res.candidates.length < 5 && params?.trendFilter !== 'none'}<p class="warn small">{tx('Кандидатов меньше 5 — риск концентрации.', 'Fewer than 5 candidates — a concentration risk.')}</p>{/if}
		{#if res.capOut}<p class="muted small">{tx(`Вне выбранной капитализации — ${res.capOut} акций.`, `${res.capOut} shares outside the chosen market cap.`)}</p>{/if}
		{#if res.capped}<p class="muted small">{tx(`Ещё ${res.capped} прошли, но не вошли из-за ограничений по сектору и рынку.`, `${res.capped} more passed but were left out by the sector and market caps.`)}</p>{/if}
		<ul class="cands">
			{#each candsSorted as { c, i } (c.id)}
				<li>
					<button class="crow" onclick={() => goto(`/security/${c.id}?model=${vkey()}&q=${res.quarter}&${previewQuery()}`)}>
						<span class="n">{i + 1}</span>
						<span class="who"><b>{c.symbol}</b>{#if pathFlags[c.id]} <FlagChips flags={pathFlags[c.id]} />{/if}<span class="muted small block name">{c.name}</span><span class="muted small block">{c.market === 'US' ? tx('США', 'US') : tx('Израиль', 'Israel')} {' · '}{c.sector ? sectorName(c.sector, tx) : tx('сектор неизвестен', 'sector unknown')}{#if c.capUsd}{' · '}{capText(c.capUsd)}, {capName(c.capGroup)}{/if}{' · '}{c.up}/{res.years.length}</span><span class="muted small block">{tx('по месяцам', 'by month')} {c.months.map((m) => pct(m)).join(' · ')}{#if c.sma10 !== null}{' · '}{c.sma10 >= 0 ? tx('над', 'above') : tx('под', 'below')} SMA10 {pct(c.sma10)}{/if}</span>{#if c.reasons.earnings || c.reasons.dividend || c.reasons.sector}<span class="reasons">{#if c.reasons.earnings}<i>{tx('отчёт', 'report')}</i>{/if}{#if c.reasons.dividend}<i>{tx('дивиденд', 'dividend')}</i>{/if}{#if c.reasons.sector}<i>{tx('сектор сезонен', 'sector seasonal')}</i>{/if}</span>{/if}{#if c.own.mean !== null && variant !== 'D'}<span class="muted small block" class:warnline={Math.abs(c.own.mean) < 1 || c.own.up < 6}>{tx('к обычному кварталу', 'vs usual quarter')} {pct(c.own.mean)} · {tx('выше в', 'above in')} {c.own.up}/{c.own.years}</span>{/if}</span>
						<span class="nums">{#if c.score !== null}<span class="score">{tx('балл', 'score')} {c.score.toFixed(1)}</span>{/if}<b class:up={c.mean > 0}>{pct(c.mean)}</b><span class="muted small block">{tx('мед.', 'med.')} {pct(c.median)}</span><span class="muted small block">{tx('худш.', 'worst')} {pct(c.worst)}</span></span>
					</button>
					<button class="pick" class:on={pickedSet.has(c.id)} aria-pressed={pickedSet.has(c.id)} aria-label={pickedSet.has(c.id) ? tx('Снять отметку', 'Unpick') : tx('Отметить', 'Pick')} onclick={() => togglePick(c.id, !pickedSet.has(c.id))}>{pickedSet.has(c.id) ? '★' : '☆'}</button>
					<span class="tvpos">{#if riskLabels[c.id]}<RiskLabel small label={riskLabels[c.id].label} twin={riskLabels[c.id].twin} />{/if}<TvLink exchange={c.exchange} symbol={c.symbol} /></span>
				</li>
			{/each}
		</ul>
		<ToJournal
			links={[{ type: 'model_run', id: `${variant}|${res.forYear}-Q${res.quarter}`, label: `${tx('Модель', 'Model')} ${variant} Q${res.quarter} ${res.forYear}` }]}
			snapshot={() => ({
				type: 'candidates',
				params: { variant, quarter: `${res!.forYear}-Q${res!.quarter}`, years: res!.years.length, params },
				data: { candidates: res!.candidates.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, sector: c.sector, mean: c.mean, median: c.median, worst: c.worst, up: c.up, score: c.score })) }
			})}
		/>
		{#if picksOutside.length}
			<p class="muted small">{tx('Отмеченные, которых нет в текущем списке:', 'Picked ones not in the current list:')}</p>
			<div class="outside">
				{#each picksOutside as p (p.id)}<a href="/security/{p.id}">★ {p.symbol}</a>{/each}
				<a class="all" href="/shortlist">{tx('все отмеченные →', 'all picked →')}</a>
			</div>
		{/if}
	</Fold>

	<!-- T-032 Д-08: the diary of this run (variant and quarter) — with the entries of its candidates -->
	<Fold key="model-journal" title={tx('Дневник прогона', 'Diary of the run')} open={false}>
		{#snippet aside()}<HelpIcon topicKey="journal.inherit" label={tx('дневник прогона', 'the run\'s diary')} />{/snippet}
		{#key `${variant}|${res.forYear}-Q${res.quarter}`}
			<Feed scope={`model_run:${variant}|${res.forYear}-Q${res.quarter}`} links={[{ type: 'model_run', id: `${variant}|${res.forYear}-Q${res.quarter}`, label: `${tx('Модель', 'Model')} ${variant} Q${res.quarter} ${res.forYear}` }]} />
		{/key}
	</Fold>

	{#if res.walk.length}
		<Fold key="model-walk" title={tx('Проверка без подглядывания', 'Check without peeking')} summary={res.walk.map((w) => `${w.year}: ${pct(w.pickedMean)}`).join(' · ')}>
			{#snippet aside()}<HelpIcon topicKey="model.walk" label={tx('проверка', 'check')} />{/snippet}
			<table class="walk">
				<thead><tr><th>{tx('Год', 'Year')}</th><th>{tx('Выбрано', 'Picked')}</th><th>{tx('Они', 'They')}</th><th>{tx('Все', 'All')}</th></tr></thead>
				<tbody>
					{#each res.walk as w (w.year)}
						<tr><td>{w.year}</td><td>{w.picked} ({w.pickedUp}▲)</td><td class:up={(w.pickedMean ?? 0) > (w.allMean ?? 0)}>{pct(w.pickedMean)}</td><td>{pct(w.allMean)}</td></tr>
					{/each}
				</tbody>
			</table>
			{#if params?.capGroups.length}<p class="warn small">{tx('Капитализация в прошлом — приблизительно: сегодняшнее число акций × цена тогда. Это подглядывание: компании, которые потом выросли, попадают в крупные задним числом.', 'The past market cap is approximate: today\'s number of shares × the price then. This peeks: companies that grew later count as large in hindsight.')}</p>{/if}
			<p class="muted small">{tx('Кандидаты выбраны по 7 годам до проверяемого и измерены в нём. Только для справки: в базе нет бумаг, исчезнувших за эти годы, поэтому прошлое выглядит лучше, чем было.', 'Candidates chosen on the 7 years before the tested one and measured in it. For reference only: shares that vanished in those years are not in the base, so the past looks better than it was.')}</p>
		</Fold>
	{/if}
{/if}

{#if costs?.costs}
	{@const c = costs.costs}
	<Fold key="model-costs" title={tx('Издержки и оборот', 'Costs and turnover')} summary={tx(`${pct(c.gross)} в год до издержек, ${pct(c.hold.cagr)} после`, `${pct(c.gross)} a year before costs, ${pct(c.hold.cagr)} after`)}>
		{#snippet aside()}{#if costsBusy}<span class="muted small">{tx('считаю…', 'computing…')}</span>{/if}<HelpIcon topicKey="model.costs" label={tx('издержки', 'costs')} />{/snippet}
		<p class="muted small">{tx(`Портфель варианта за последние ${c.quarters.length} кварталов: каждый квартал — его кандидаты поровну, ${usd(c.start)} на старте.`, `The variant's portfolio over the last ${c.quarters.length} quarters: each quarter its candidates in equal parts, ${usd(c.start)} at the start.`)}</p>
		<ul class="books">
			<li><span>{tx('До издержек', 'Before costs')}</span><b>{pct(c.gross)}</b><span class="muted small">{tx('в год', 'a year')}</span></li>
			{#each [[tx('После, с правилом «держать»', 'After, with «hold»'), c.hold, true], [tx('После, без правила', 'After, without the rule'), c.noHold, false]] as [label, bk, main] (label)}
				{@const x = bk as CostBook}
				<li class:main>
					<span>{label}</span><b>{pct(x.cagr)}</b><span class="muted small">{tx('в год', 'a year')}</span>
					<span class="muted small detail">{tx('комиссии', 'fees')} {usd(x.fees)} · {tx('налог', 'tax')} {usd(x.taxes)} · {tx('оборот', 'turnover')} {x.turnover}% {tx('в год', 'a year')}</span>
				</li>
			{/each}
		</ul>
		<p class="muted small">
			{tx(`Правило сберегло ${c.hold.kept} продаж и покупок: бумага снова попала в кандидаты следующего квартала. В конце всё продаётся — с комиссией и налогом.`, `The rule spared ${c.hold.kept} sales and purchases: the share was chosen again for the next quarter. At the end everything is sold — with the fee and the tax.`)}
			{tx('Только для справки: в базе нет бумаг, исчезнувших за эти годы.', 'For reference only: shares that vanished in those years are not in the base.')}
		</p>
		<button class="textlink" onclick={() => (quartersOpen = !quartersOpen)}>{quartersOpen ? tx('Скрыть кварталы', 'Hide the quarters') : tx('По кварталам', 'By quarter')}</button>
		{#if quartersOpen}
			<div class="scroll">
				<table class="walk costs">
					<thead><tr><th>{tx('Квартал', 'Quarter')}</th><th>{tx('Бумаг', 'Shares')}</th><th>{tx('До', 'Before')}</th><th>{tx('Держать', 'Hold')}</th><th>{tx('Без', 'Without')}</th></tr></thead>
					<tbody>
						{#each c.quarters as x (x.label)}
							<tr><td>{x.label}</td><td>{x.picked}{#if x.kept}{' '}({x.kept}↻){/if}</td><td>{pct(x.gross)}</td><td>{pct(x.hold)}</td><td>{pct(x.noHold)}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="muted small">{tx('↻ — сколько бумаг было и в прошлом квартале. Квартал с налогом — последний в году.', '↻ — how many shares were in the quarter before too. The tax is paid in the last quarter of a year.')}</p>
		{/if}
		{#if costs.portfolios.length}
			<p class="small">{tx('Виртуальные портфели варианта ведутся с теми же издержками:', 'The variant\'s virtual portfolios are kept with the same costs:')} {#each costs.portfolios as pf (pf.id)}<a href="/portfolio?p={pf.id}">«{pf.name}»</a>{' '}{/each}</p>
		{/if}
	</Fold>
{/if}

{#if trend?.table.length}
	{@const rows = trend.table}
	<Fold key="model-trend" title={tx('Фильтр и выход по тренду', 'Trend filter and exit')} summary={tx('6 сочетаний: превышение, просадка, пустышка', '6 combinations: excess, drawdown, placebo')}>
		{#snippet aside()}{#if trendBusy}<span class="muted small">{tx('считаю…', 'computing…')}</span>{/if}<HelpIcon topicKey="model.trend_filter" label={tx('фильтр тренда', 'trend filter')} />{/snippet}
		<div class="seg small-seg" role="radiogroup" aria-label={tx('Годы', 'Years')}>
			<button role="radio" aria-checked={!trendWalk} class:on={!trendWalk} onclick={() => (trendWalk = false)}>{tx(`Все годы (${rows[0].all.years})`, `All years (${rows[0].all.years})`)}</button>
			<button role="radio" aria-checked={trendWalk} class:on={trendWalk} onclick={() => (trendWalk = true)}>{tx(`Без подглядывания (${rows[0].walk.years})`, `Without peeking (${rows[0].walk.years})`)}</button>
		</div>
		<div class="scroll">
			<table class="walk trend">
				<thead><tr><th>{tx('Фильтр · выход', 'Filter · exit')}</th><th>{tx('Сверх рынка', 'Over market')}</th><th>{tx('Мед.', 'Med.')}</th><th>{tx('Худший', 'Worst')}</th><th>{tx('Просадка', 'Drawdown')}</th><th>{tx('Канд.', 'Cand.')}</th><th>&lt;5</th><th>{tx('Пустышка', 'Placebo')}</th></tr></thead>
				<tbody>
					{#each rows as r (r.filter + r.exit)}
						{@const st = trendWalk ? r.walk : r.all}
						<tr class:cur={params?.trendFilter === r.filter && params?.trendExit === r.exit}>
							<td>{tx(...FNAME[r.filter])}<br /><span class="muted small">{r.exit === 'none' ? tx('без выхода', 'no exit') : tx('выход SMA3', 'exit SMA3')}</span></td>
							<td><b>{pct(st.excess)}</b></td>
							<td>{pct(st.median)}</td>
							<td>{pct(st.worst)}</td>
							<td>{pct(st.maxDrawdown)}</td>
							<td>{st.avgCount}</td>
							<td>{st.under5}%</td>
							<td class="v-{r.placebo.verdict}">{tx(...VERDICT[r.placebo.verdict])}<br /><span class="muted small">{Math.round(r.placebo.share * 100)}%</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small">{tx('Строка выбранных сейчас параметров выделена. «Пустышка» — те же фильтр и выход на кварталах, перемешанных внутри года; процент — доля прогонов с превышением не меньше. Правило: включать по умолчанию, только если на годах без подглядывания превышение лучше или просадка меньше при потере не больше 1 п.п., и пустышка — «сигнал».', 'The row of the parameters chosen now is highlighted. «Placebo» — the same filter and exit on quarters shuffled inside the year; the percent is the share of runs with an excess at least as large. Rule: on by default only if, on the years without peeking, the excess is better or the drawdown smaller at a loss of at most 1 pp, and the placebo says «signal».')} <HelpIcon topicKey="model.trend_exit" label={tx('выход по тренду', 'trend exit')} /></p>
	</Fold>
{/if}

{#if trend?.laggards}
	{@const l = trend.laggards}
	<Fold key="model-laggards" title={tx('Отставшие догоняют?', 'Do laggards catch up?')} summary={tx(...LAG[l.verdict])}>
		{#snippet aside()}<HelpIcon topicKey="model.late_entry" label={tx('отставшие', 'laggards')} />{/snippet}
		<p class="placebo {l.verdict === 'catch_up' ? 'signal' : l.verdict === 'no' ? 'chance' : 'unclear'}"><span class="badge">{tx(...LAG[l.verdict])}</span></p>
		<p class="small">
			{tx(`Прошлые кандидаты А и Б (выбранные по 7 годам до своего года, все кварталы): ${l.n}. Связь месяцев 1–2 с 3-м месяцем: ${l.corr ?? '—'}.`, `Past candidates of A and B (chosen on the 7 years before their year, all quarters): ${l.n}. Months 1–2 against the 3rd month: correlation ${l.corr ?? '—'}.`)}
		</p>
		<table class="walk">
			<thead><tr><th></th><th>{tx('3-й месяц', '3rd month')}</th><th>{tx('Рост', 'Up')}</th><th>{tx('Сверх рынка', 'Over market')}</th></tr></thead>
			<tbody>
				<tr><td>{tx('Все кандидаты', 'All candidates')}</td><td>{pct(l.all.mean3)}</td><td>{l.all.up3 ?? '—'}%</td><td>{pct(l.all.excess3)}</td></tr>
				<tr><td>{tx(`Отставшие (${l.lag.n})`, `Laggards (${l.lag.n})`)}</td><td>{pct(l.lag.mean3)}</td><td>{l.lag.up3 ?? '—'}%</td><td><b>{pct(l.lag.excess3)}</b></td></tr>
				<tr><td>{tx('Случайные отставшие', 'Random laggards')}</td><td></td><td></td><td>{pct(l.placebo.mean)}</td></tr>
			</tbody>
		</table>
		{#if params}
			<div class="prow">
				<span class="pl">{tx('Отставшие — за 2 месяца не больше, %', 'Laggards — 2 months at most, %')}</span>
				<span class="stepper">
					<button aria-label="−" disabled={params.lagThreshold <= -20} onclick={() => set('lagThreshold', round3(params!.lagThreshold - 1))}>−</button>
					<b>{params.lagThreshold}</b>
					<button aria-label="+" disabled={params.lagThreshold >= 20} onclick={() => set('lagThreshold', round3(params!.lagThreshold + 1))}>+</button>
				</span>
			</div>
		{/if}
		<p class="muted small">{tx(`Пустышка: столько же случайных бумаг той же выборки в тех же кварталах; не меньше превышение у ${Math.round(l.placebo.share * 100)}% из ${l.placebo.runs} прогонов. «Поздний вход» появится, только если отставшие догоняют лучше случайности.`, `Placebo: as many random shares of the same universe in the same quarters; ${Math.round(l.placebo.share * 100)}% of ${l.placebo.runs} runs had an excess at least as large. «Late entry» appears only if laggards catch up better than chance.`)}</p>
	</Fold>
{/if}

{#if compareV?.length}
	<Fold key="model-variants" title={tx('Варианты рядом', 'Variants side by side')} summary={compareV.map((x) => `${x.variant}: ${tx(...VERDICT[x.placebo.verdict])}`).join(' · ')}>
		{#snippet aside()}<HelpIcon topicKey="model.variants" label={tx('варианты', 'variants')} />{/snippet}
		<div class="scroll">
			<table class="walk trend">
				<thead><tr><th>{tx('Вариант', 'Variant')}</th><th>{tx('Прошли', 'Passed')}</th><th>{tx('Пустышка', 'Placebo')}</th><th>{tx('Без подгл. к всем', 'No-peek vs all')}</th><th>{tx('В год до / после издержек', 'A year before / after costs')}</th></tr></thead>
				<tbody>
					{#each compareV as x (x.variant)}
						<tr class:cur={x.variant === variant}>
							<td>{tx(...VNAME[x.variant])}</td>
							<td>{x.passed}</td>
							<td class="v-{x.placebo.verdict}">{tx(...VERDICT[x.placebo.verdict])}<br /><span class="muted small">{x.placebo.real} {tx('против', 'vs')} {x.placebo.mean}</span></td>
							<td>{x.walkVsAll === null ? '—' : `${x.walkVsAll > 0 ? '+' : ''}${x.walkVsAll} ${tx('п.п.', 'pp')}`}</td>
							<td>{pct(x.gross)} / <b>{pct(x.afterCosts)}</b></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small">{tx(`Q${quarter}, у каждого варианта — его сохранённые параметры.`, `Q${quarter}, each variant with its saved parameters.`)}</p>
	</Fold>
{/if}

{#if data?.recorded.length}
	<Fold key="model-recorded" title={tx('Записанные кварталы', 'Recorded quarters')} summary={String(data.recorded.length)}>
		<ul class="plain">
			{#each data.recorded as r (r.variant + r.quarter)}
				<li>{r.quarter} · {r.variant === 'A' ? tx('А. Рост цены', 'A. Price rise') : r.variant === 'B' ? tx('Б. Против рынка', 'B. Against the market') : r.variant === 'C' ? tx('В. Оценка', 'C. Score') : r.variant === 'G' ? tx('Г. С причиной', 'G. With a reason') : tx('Д. Против тренда', 'D. Against its trend')} · {tx('гипотез', 'hypotheses')} {r.hypotheses}</li>
			{/each}
		</ul>
		<p class="muted small"><a href="/sources">{tx('Статистика вариантов — в «Источниках»', 'Variant stats — in «Sources»')}</a></p>
	</Fold>
{/if}

<style>
	.banner {
		margin: 0 0 var(--s3);
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: var(--fs-s);
	}
	.card {
		margin-bottom: var(--s4);
		padding: var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 0 var(--s2);
		font-size: var(--fs-l);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.block {
		display: block;
	}
	.seg,
	.quarters {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: var(--s3);
	}
	.seg button,
	.quarters button {
		flex: 1;
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg button.on,
	.quarters button.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
	}
	.prow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		min-height: 44px;
		border-top: 1px solid var(--line);
	}
	.pl {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: var(--fs-s);
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.stepper b {
		min-width: 2.2em;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.stepper button {
		width: 36px;
		height: 36px;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: none;
		color: var(--text);
		font-size: 18px;
		cursor: pointer;
	}
	select {
		min-height: 36px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: var(--fs-s);
	}
	.caprow {
		border-top: 1px solid var(--line);
	}
	.seg2 {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 999px;
		overflow: hidden;
	}
	.seg2 button {
		min-height: 32px;
		padding: 0 12px;
		border: none;
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg2 button.on {
		background: var(--text);
		color: var(--bg);
	}
	.capchips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 0 0 10px;
	}
	.capchips button {
		min-height: 32px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: none;
		color: var(--muted);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.capchips button.on {
		border-color: var(--text);
		color: var(--text);
	}
	.capchips small {
		color: var(--muted);
	}
	.capchips .link {
		border: none;
		color: var(--link);
	}
	.bounds {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 12px;
		padding: 0 0 10px;
		font-size: var(--fs-s);
	}
	.bounds input {
		width: 64px;
		min-height: 32px;
		margin-left: 4px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
	}
	.save {
		display: flex;
		gap: var(--s2);
		margin-top: var(--s3);
	}
	.save button {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border-radius: var(--r2);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.primary {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.ghost {
		border: 1px solid var(--line);
		background: none;
		color: var(--text);
	}
	.sum {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin: 0 0 4px;
		font-size: var(--fs-s);
	}
	.placebo {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin: 6px 0;
		font-size: var(--fs-s);
	}
	.placebo .badge {
		padding: 2px 8px;
		border-radius: 999px;
		font-size: var(--fs-xs);
		font-weight: 700;
	}
	.placebo.signal .badge {
		background: color-mix(in srgb, var(--up) 18%, transparent);
		color: var(--up);
	}
	.placebo.unclear .badge {
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.placebo.chance .badge {
		background: color-mix(in srgb, var(--down) 15%, transparent);
		color: var(--down);
	}
	.warn {
		margin: var(--s2) 0;
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: var(--fs-s);
	}
	.err {
		color: var(--down);
	}
	.cands,
	.plain {
		list-style: none;
		margin: var(--s2) 0 0;
		padding: 0;
	}
	.cands li {
		position: relative;
		border-top: 1px solid var(--line);
	}
	/* ☆ — at the row's top right, outside its button */
	.pick {
		position: absolute;
		right: 0;
		bottom: 4px;
		border: none;
		background: none;
		font-size: 1.25rem;
		color: var(--muted);
		cursor: pointer;
		padding: 4px 6px;
	}
	.pick.on {
		color: var(--warn-text, #b8860b);
	}
	.outside {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.outside a {
		padding: 3px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		color: var(--text);
		text-decoration: none;
		font-size: var(--fs-xs);
	}
	.outside a.all {
		border: none;
		color: var(--link);
	}
	/* «TV ↗» under the name, outside the row's button */
	.tvpos {
		position: absolute;
		left: 30px;
		bottom: 6px;
	}
	.cands .crow {
		padding-bottom: 32px;
	}
	.crow {
		display: grid;
		grid-template-columns: 22px 1fr auto;
		align-items: center;
		gap: var(--s2);
		width: 100%;
		min-height: 56px;
		padding: 6px 0;
		border: none;
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.who {
		min-width: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.n {
		color: var(--muted);
		font-size: var(--fs-xs);
	}
	.nums {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.up {
		color: var(--up);
	}
	.score {
		display: block;
		font-size: 0.75rem;
		color: var(--muted);
	}
	h3.sub {
		margin: var(--s3) 0 var(--s1);
		font-size: var(--fs-s, 0.95rem);
	}
	.scroll {
		overflow-x: auto;
	}
	.reasons {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: 2px 0;
	}
	.reasons i {
		font-style: normal;
		font-size: var(--fs-xs);
		padding: 0 6px;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.trend td,
	.trend th {
		white-space: nowrap;
	}
	.trend tr.cur td {
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}
	.v-signal {
		color: var(--up);
	}
	.v-chance {
		color: var(--down);
	}
	.small-seg {
		margin: 0 0 var(--s2);
	}
	.warnline {
		color: var(--warn, var(--down));
	}
	.books {
		list-style: none;
		padding: 0;
		margin: var(--s2) 0;
	}
	.books li {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: baseline;
		gap: 0 var(--s2);
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.books li b {
		font-variant-numeric: tabular-nums;
	}
	.books li.main span:first-child,
	.books li.main b {
		font-weight: 700;
	}
	.books .detail {
		grid-column: 1 / -1;
	}
	.textlink {
		border: none;
		background: none;
		padding: var(--s1) 0;
		color: var(--link);
		cursor: pointer;
		font: inherit;
	}
	.walk {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-s);
		font-variant-numeric: tabular-nums;
	}
	.walk th,
	.walk td {
		padding: 6px 4px;
		border-bottom: 1px solid var(--line);
		text-align: right;
	}
	.walk th:first-child,
	.walk td:first-child {
		text-align: left;
	}
	.plain li {
		padding: 4px 0;
		font-size: var(--fs-s);
	}
</style>
