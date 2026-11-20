import type Database from 'better-sqlite3';

/**
 * The quarterly model, sub-stage 10a (spec section 21, T-009). For a calendar quarter: each share's price change
 * inside that quarter in each of the last N years (default 10) — from the close of the month before the quarter
 * to the close of its last month, on dividend- and split-adjusted monthly prices. Variant A «Рост цены» (the
 * owner's scheme) counts the change itself; variant B «Против рынка» counts it over the market's (S&P 500 or
 * TA-125) or over the average of the share's sector. Shares that rose (beat) in at least K of the N years pass,
 * are sorted by the mean (median, worst year) and give 10 candidates with at most 2 per sector and 7 per market.
 */

/** A — the rise (the owner's scheme), B — over the market or sector, C — the score (T-011): no K, ranked by a t-like score */
export type Variant = 'A' | 'B' | 'C';

/** T-011, variant C: «заметно» from this score up */
export const SCORE_MIN = 2;

/**
 * The score of variant C: the mean quarterly excess divided by its spread over the years (a t-statistic), shrunk
 * towards zero for few years (× n / (n + 2)). The spread has a floor of 1 pp: «+3% every year» is high, not
 * infinite. «+3% every year» stands above «+40% once and about zero otherwise».
 */
export function tScore(m: number[]): number | null {
	const x = m.filter((v) => Number.isFinite(v));
	const n = x.length;
	if (n < 3) return null;
	const mean = x.reduce((a, b) => a + b, 0) / n;
	const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
	return (mean / (Math.max(sd, 0.01) / Math.sqrt(n))) * (n / (n + 2));
}

export interface Params {
	years: number;
	k: number;
	count: number;
	perSector: number;
	perMarket: number;
	/** average daily turnover over the last 12 months, dollars */
	minTurnoverUsd: number;
	/** last close, dollars (a TASE share — its equivalent) */
	minPriceUsd: number;
	sort: 'mean' | 'median' | 'worst';
	/** variant B only: over the market or over the share's sector */
	compareWith: 'market' | 'sector';
	/**
	 * T-021 — market cap: by fixed bounds in dollars (abs) or relative to the share's own market (rel: the top 20%,
	 * the middle, the bottom 30% separately in the US and on TASE, else almost all Israeli companies are «small»)
	 */
	capMode: 'abs' | 'rel';
	/** the groups kept; empty — all (abs: mega, large, mid, small, micro; rel: top, middle, bottom) */
	capGroups: string[];
	/** the lower bounds of mega, large, mid and small, dollars */
	capBounds: number[];
}

export const CAP_ABS = ['mega', 'large', 'mid', 'small', 'micro'] as const;
export const CAP_REL = ['top', 'middle', 'bottom'] as const;

export const DEFAULTS: Params = {
	years: 10,
	k: 9,
	count: 10,
	perSector: 2,
	perMarket: 7,
	minTurnoverUsd: 1_000_000,
	minPriceUsd: 5,
	sort: 'mean',
	compareWith: 'market',
	capMode: 'abs',
	capGroups: [],
	capBounds: [200e9, 10e9, 2e9, 0.3e9]
};

/** the limits a parameter is kept in (the screen's inputs and the API check) */
export const LIMITS: Record<'years' | 'k' | 'count' | 'perSector' | 'perMarket' | 'minTurnoverUsd' | 'minPriceUsd', [number, number]> = {
	years: [5, 15],
	k: [1, 15],
	count: [1, 30],
	perSector: [1, 30],
	perMarket: [1, 30],
	minTurnoverUsd: [0, 100_000_000],
	minPriceUsd: [0, 1000]
};

export function cleanParams(input: Partial<Record<keyof Params, unknown>>, base: Params = DEFAULTS): Params {
	const p: Params = { ...base };
	for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
		if (input[k] === undefined || input[k] === '') continue;
		const n = Number(input[k]);
		if (!Number.isFinite(n)) continue;
		const [lo, hi] = LIMITS[k];
		p[k] = Math.min(hi, Math.max(lo, k === 'minTurnoverUsd' || k === 'minPriceUsd' ? n : Math.round(n)));
	}
	if (input.sort === 'mean' || input.sort === 'median' || input.sort === 'worst') p.sort = input.sort;
	if (input.compareWith === 'market' || input.compareWith === 'sector') p.compareWith = input.compareWith;
	if (input.capMode === 'abs' || input.capMode === 'rel') p.capMode = input.capMode;
	const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : typeof x === 'string' ? x.split(',').filter(Boolean) : null);
	const groups = list(input.capGroups);
	if (groups) {
		const allowed: readonly string[] = p.capMode === 'rel' ? CAP_REL : CAP_ABS;
		p.capGroups = [...new Set(groups.filter((g) => allowed.includes(g)))];
		// all groups chosen is the same as no filter
		if (p.capGroups.length === allowed.length) p.capGroups = [];
	} else if (input.capMode !== undefined && input.capMode !== base.capMode) p.capGroups = [];
	const bounds = list(input.capBounds)?.map(Number);
	if (bounds && bounds.length === 4 && bounds.every((b) => Number.isFinite(b) && b >= 0) && bounds.every((b, i) => i === 0 || b < bounds[i - 1])) p.capBounds = bounds;
	p.k = Math.min(p.k, p.years);
	return p;
}

// ── data ────────────────────────────────────────────────────────────────────────

/** months are counted from year 0: 2026-10 → 2026 × 12 + 9 */
export const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
export const monthName = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

export interface Series {
	id: number;
	symbol: string;
	name: string;
	market: 'US' | 'IL';
	exchange: string;
	sector: string | null;
	/** T-021: market cap now, dollars, and the number of shares it implies (for the cap at an earlier date) */
	capUsd: number | null;
	shares: number | null;
	/** price unit of the closes: USD | ILA | ILS */
	unit: string;
	/** month index of the first element */
	start: number;
	adj: Float64Array;
	close: Float64Array;
	volume: Float64Array;
}

export interface Universe {
	stocks: Series[];
	bench: { US: Series | null; IL: Series | null };
	/** the last complete month in the data */
	lastMonth: number;
	/** shekels for a dollar */
	usdIls: number;
	builtAt: string;
}

const at = (s: Series, i: number, a: Float64Array = s.adj) => {
	const j = i - s.start;
	return j >= 0 && j < a.length && a[j] > 0 ? a[j] : NaN;
};

/**
 * Funds the exchange lists label as shares (owner's decision on T-009, 20.11.2026): Yahoo calls them ETF (DGP),
 * or a closed-end fund shows as a share of «Asset Management» with «Fund» or «Trust» in its name (DHY).
 */
export const isFund = (m: { kind: string | null; industry: string | null; name: string }) =>
	m.kind === 'etf' || (m.industry === 'Asset Management' && /\b(fund|trust)\b/i.test(m.name));

/** reads all monthly prices once into compact arrays (about 10 MB for 6 500 shares × 15 years) */
export function loadUniverse(market: Database.Database): Universe {
	const meta = market
		.prepare(
			`select s.id, s.symbol, s.name_en as name, s.exchange_code as exchange, e.country, s.price_unit as unit, s.type, s.is_benchmark as bench, p.sector, p.kind, p.industry, p.market_cap as cap, p.cap_currency as capCur
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code
			   left join ref_security_profiles p on p.security_id = s.id
			  where s.id in (select security_id from ops_monthly_loads where status = 'ok')`
		)
		.all() as { id: number; symbol: string; name: string; exchange: string; country: string; unit: string; type: string; bench: number; sector: string | null; kind: string | null; industry: string | null; cap: number | null; capCur: string | null }[];
	const byId = new Map<number, { rows: [number, number, number, number][] }>();
	for (const m of meta) byId.set(m.id, { rows: [] });
	const it = market.prepare('select security_id, month, adj_close, close, volume from market_prices_monthly order by security_id, month').raw().iterate() as Iterable<[number, string, number, number, number | null]>;
	let last = 0;
	for (const [id, month, adj, close, vol] of it) {
		const e = byId.get(id);
		if (!e) continue;
		const i = monthIndex(month);
		if (i > last) last = i;
		e.rows.push([i, adj, close, vol ?? 0]);
	}
	const fx = market.prepare(`select rate from market_fx_daily where pair = 'USD/ILS' order by date desc limit 1`).get() as { rate: number } | undefined;
	const usdIls = fx?.rate ?? 3.7;
	/** the last close in the currency of the cap: agorot → shekels */
	const unit0 = (unit: string, close: Float64Array) => (unit === 'ILA' ? close[close.length - 1] / 100 : close[close.length - 1]);
	/** T-021: the cap in dollars (a TASE cap is in shekels — Yahoo gives it so even for agorot quotes) and the shares */
	const capOf = (cap: number | null, cur: string | null, closeLocal: number) => {
		if (!cap || !(cap > 0)) return { capUsd: null, shares: null };
		return { capUsd: cur === 'ILS' || cur === 'ILA' ? cap / usdIls : cap, shares: closeLocal > 0 ? cap / closeLocal : null };
	};
	const toSeries = (m: (typeof meta)[number]): Series | null => {
		const rows = byId.get(m.id)!.rows;
		if (!rows.length) return null;
		const start = rows[0][0];
		const n = rows.at(-1)![0] - start + 1;
		const adj = new Float64Array(n);
		const close = new Float64Array(n);
		const volume = new Float64Array(n);
		for (const [i, a, c, v] of rows) {
			adj[i - start] = a;
			close[i - start] = c;
			volume[i - start] = v;
		}
		return { id: m.id, symbol: m.symbol, name: m.name, market: m.country === 'IL' ? 'IL' : 'US', exchange: m.exchange, sector: m.sector, ...capOf(m.cap, m.capCur, unit0(m.unit, close)), unit: m.unit, start, adj, close, volume };
	};
	const stocks: Series[] = [];
	let US: Series | null = null;
	let IL: Series | null = null;
	for (const m of meta) {
		const s = toSeries(m);
		if (!s) continue;
		if (m.bench) {
			if (m.country === 'IL') IL = s;
			else US = s;
		} else if (m.type === 'stock' && !isFund(m)) stocks.push(s);
	}
	return { stocks, bench: { US, IL }, lastMonth: last, usdIls, builtAt: new Date().toISOString() };
}

// ── the calculation ─────────────────────────────────────────────────────────────

/** the last month of quarter q (1–4) of year y, and the month before the quarter */
export const quarterEnd = (y: number, q: number) => y * 12 + q * 3 - 1;

/** the last `n` years in which quarter q is complete in the data */
export function windowYears(lastMonth: number, q: number, n: number): number[] {
	let y = Math.floor(lastMonth / 12);
	while (quarterEnd(y, q) > lastMonth) y--;
	return Array.from({ length: n }, (_, i) => y - n + 1 + i);
}

export const quarterReturn = (s: Series, y: number, q: number) => {
	const e = quarterEnd(y, q);
	return at(s, e) / at(s, e - 3) - 1;
};

const toUsd = (x: number, unit: string, usdIls: number) => (unit === 'ILA' ? x / 100 / usdIls : unit === 'ILS' ? x / usdIls : x);

/** average daily turnover over the last 12 months in dollars, and the last close in dollars */
export function liquidity(s: Series, lastMonth: number, usdIls: number) {
	let sum = 0;
	let months = 0;
	for (let i = lastMonth - 11; i <= lastMonth; i++) {
		const c = at(s, i, s.close);
		const v = s.volume[i - s.start];
		if (!(c > 0) || !(v >= 0)) continue;
		sum += c * v;
		months++;
	}
	const price = at(s, lastMonth, s.close);
	return { turnoverUsd: months ? toUsd(sum / (months * 21), s.unit, usdIls) : 0, priceUsd: price > 0 ? toUsd(price, s.unit, usdIls) : 0 };
}

const median = (xs: number[]) => {
	const a = [...xs].sort((x, y) => x - y);
	const m = a.length >> 1;
	return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** P(X ≥ k) for X ~ Binomial(n, p) */
export function binomTail(n: number, k: number, p: number) {
	let sum = 0;
	let c = 1; // C(n, i)
	for (let i = 0; i <= n; i++) {
		if (i >= k) sum += c * p ** i * (1 - p) ** (n - i);
		c = (c * (n - i)) / (i + 1);
	}
	return Math.min(1, Math.max(0, sum));
}

export interface Candidate {
	id: number;
	symbol: string;
	name: string;
	exchange: string;
	market: 'US' | 'IL';
	sector: string | null;
	/** the measure of each year of the window (variant A — the change, B — the change over the market or sector), % */
	results: (number | null)[];
	up: number;
	mean: number;
	median: number;
	worst: number;
	turnoverUsd: number;
	priceUsd: number;
	capUsd: number | null;
	capGroup: string | null;
	/** variant C: the score */
	score: number | null;
}

export interface Result {
	variant: Variant;
	quarter: number;
	/** the year the candidates are for: the quarter after the window */
	forYear: number;
	years: number[];
	params: Params;
	/** shares with the full history that pass the turnover and price filters */
	universe: number;
	noHistory: number;
	illiquid: number;
	/** T-021: liquid shares by cap group (before the filter; «unknown» — no cap), and how many the filter left out */
	capCounts: Record<string, number>;
	capOut: number;
	passed: number;
	/** how many would pass by chance: N × P(Binomial(years, p) ≥ K) — the rough estimate before T-010 */
	expected: number;
	/** T-010: the same count on 100 runs with the quarters shuffled inside each year */
	placebo: Placebo;
	/** the share of rising (beating) quarters among all shares and years */
	p: number;
	candidates: Candidate[];
	/** shares that passed but were left out by the sector and market caps */
	capped: number;
	/** benchmark change in each year of the window, % */
	bench: { US: (number | null)[]; IL: (number | null)[] };
	walk: Walk[];
	dataMonth: string;
}

export interface Placebo {
	runs: number;
	/** what the real calculation found (shares that passed K) */
	real: number;
	mean: number;
	/** the share of runs that found at least as many as the real one */
	share: number;
	/** signal — more than almost any run (under 5%); unclear — under 25%; chance — as many as a placebo */
	verdict: 'signal' | 'unclear' | 'chance';
}

/** a small seeded random generator: the same placebo on every request */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * T-010 — the placebo: the variant's measure for all four quarters of each year of the window; in each of `runs`
 * runs every share's year takes the measure of a random quarter of that year (a quarter not complete yet is not
 * drawn). Seasonality cannot survive this, so what passes K there passes by luck alone.
 */
export function placebo(u: Universe, rows: Row[], years: number[], quarter: number, variant: Variant, p: Params, real: number, runs = 100): Placebo {
	// measure[q][row][year] — each quarter measured as the real calculation measures its own quarter
	const byQ = [1, 2, 3, 4].map((q) => {
		const rq = rows.map((r) => ({ ...r, r: years.map((y) => quarterReturn(r.s, y, q)) }));
		return measures(u, rq, years, q, variant, p.compareWith);
	});
	const rand = rng(quarter * 7919 + (variant === 'B' ? 104729 : variant === 'C' ? 209459 : 0) + p.k * 31 + p.years);
	// for each share and year: the measures of the quarters available — drawn from in every run
	const cells: number[][][] = rows.map((_, i) => years.map((_, j) => [0, 1, 2, 3].map((q) => byQ[q][i][j]).filter((v) => Number.isFinite(v))));
	let ge = 0;
	let sum = 0;
	const drawn: number[] = [];
	for (let run = 0; run < runs; run++) {
		let passed = 0;
		for (const share of cells) {
			if (variant === 'C') {
				// variant C passes by its score, not by K
				drawn.length = 0;
				for (const avail of share) if (avail.length) drawn.push(avail[Math.floor(rand() * avail.length)]);
				if ((tScore(drawn) ?? 0) >= SCORE_MIN) passed++;
				continue;
			}
			let up = 0;
			for (const avail of share) if (avail.length && avail[Math.floor(rand() * avail.length)] > 0) up++;
			if (up >= p.k) passed++;
		}
		sum += passed;
		if (passed >= real) ge++;
	}
	const share = ge / runs;
	return { runs, real, mean: Math.round((sum / runs) * 10) / 10, share, verdict: share < 0.05 && real > 0 ? 'signal' : share < 0.25 ? 'unclear' : 'chance' };
}

export interface Walk {
	/** the test year: candidates chosen on the 7 years before it */
	year: number;
	picked: number;
	/** mean measure of the chosen in the test year, % */
	pickedMean: number | null;
	/** mean of all shares of the universe in the test year, % */
	allMean: number | null;
	/** how many of the chosen rose (beat) in the test year */
	pickedUp: number;
}

interface Row {
	s: Series;
	r: number[];
	turnoverUsd: number;
	priceUsd: number;
}

function measures(u: Universe, rows: Row[], years: number[], q: number, variant: Variant, compareWith: Params['compareWith']) {
	const bench = (m: 'US' | 'IL', y: number) => {
		const b = u.bench[m];
		return b ? quarterReturn(b, y, q) : NaN;
	};
	if (variant === 'A') return rows.map((x) => x.r);
	// B and C: over the market or the sector
	if (compareWith === 'market') return rows.map((x) => x.r.map((r, i) => r - bench(x.s.market, years[i])));
	// over the sector: the mean of the shares of that sector in the universe (at least 5), else over the market
	const bySector = new Map<string, number[][]>();
	for (const x of rows) if (x.s.sector) (bySector.get(x.s.sector) ?? bySector.set(x.s.sector, []).get(x.s.sector)!).push(x.r);
	const mean = new Map<string, number[]>();
	for (const [k, list] of bySector)
		if (list.length >= 5) mean.set(k, years.map((_, i) => list.reduce((n, r) => n + r[i], 0) / list.length));
	return rows.map((x) => {
		const m = x.s.sector ? mean.get(x.s.sector) : undefined;
		return x.r.map((r, i) => r - (m ? m[i] : bench(x.s.market, years[i])));
	});
}

function pick<T extends { s: Series; score: number }>(list: T[], p: Params): { chosen: T[]; capped: number } {
	const sorted = [...list].sort((a, b) => b.score - a.score);
	const sectors = new Map<string, number>();
	const markets = new Map<string, number>();
	const chosen: T[] = [];
	let capped = 0;
	for (const x of sorted) {
		if (chosen.length >= p.count) break;
		const sec = x.s.sector ?? '—';
		if ((sectors.get(sec) ?? 0) >= p.perSector || (markets.get(x.s.market) ?? 0) >= p.perMarket) {
			capped++;
			continue;
		}
		sectors.set(sec, (sectors.get(sec) ?? 0) + 1);
		markets.set(x.s.market, (markets.get(x.s.market) ?? 0) + 1);
		chosen.push(x);
	}
	return { chosen, capped };
}

const scoreOf = (m: number[], sort: Params['sort']) => (sort === 'median' ? median(m) : sort === 'worst' ? Math.min(...m) : m.reduce((a, b) => a + b, 0) / m.length);

export function runModel(u: Universe, variant: Variant, quarter: number, input: Params): Result {
	const p = { ...input, k: Math.min(input.k, input.years) };
	const years = windowYears(u.lastMonth, quarter, p.years);
	let noHistory = 0;
	let illiquid = 0;
	const rows: Row[] = [];
	for (const s of u.stocks) {
		const r = years.map((y) => quarterReturn(s, y, quarter));
		if (r.some((x) => !Number.isFinite(x))) {
			noHistory++;
			continue;
		}
		const l = liquidity(s, u.lastMonth, u.usdIls);
		if (l.turnoverUsd < p.minTurnoverUsd || l.priceUsd < p.minPriceUsd) {
			illiquid++;
			continue;
		}
		rows.push({ s, r, ...l });
	}
	// measured over all liquid shares (a sector's mean does not depend on the cap filter)
	const ms = measures(u, rows, years, quarter, variant, p.compareWith);
	// T-021: the cap groups now; the filter keeps the chosen groups, the chance is counted on what it keeps
	const groupsNow = capGroupMap(rows, p, (r) => r.s.capUsd);
	const capCounts: Record<string, number> = {};
	for (const r of rows) {
		const g = groupsNow.get(r) ?? 'unknown';
		capCounts[g] = (capCounts[g] ?? 0) + 1;
	}
	const kept = (r: Row) => !p.capGroups.length || p.capGroups.includes(groupsNow.get(r) ?? '');
	let capOut = 0;
	let universeN = 0;
	let ups = 0;
	let all = 0;
	const passed: { s: Series; score: number; m: number[]; row: Row }[] = [];
	const ranked: { s: Series; score: number; m: number[]; row: Row }[] = [];
	rows.forEach((row, i) => {
		if (!kept(row)) return void capOut++;
		universeN++;
		const m = ms[i];
		const up = m.filter((x) => x > 0).length;
		ups += up;
		all += m.length;
		// C: no K — every share is ranked by its score; «passed» are those with a score of at least SCORE_MIN
		if (variant === 'C') {
			const sc = tScore(m);
			if (sc !== null) ranked.push({ s: row.s, score: sc, m, row });
			if (sc !== null && sc >= SCORE_MIN) passed.push({ s: row.s, score: sc, m, row });
		} else if (up >= p.k) passed.push({ s: row.s, score: scoreOf(m, p.sort), m, row });
	});
	const prob = all ? ups / all : 0;
	const { chosen, capped } = pick(variant === 'C' ? ranked : passed, p);
	const pct = (x: number) => Math.round(x * 10000) / 100;
	const bench = (m: 'US' | 'IL') => years.map((y) => {
		const b = u.bench[m];
		const x = b ? quarterReturn(b, y, quarter) : NaN;
		return Number.isFinite(x) ? pct(x) : null;
	});
	return {
		variant,
		quarter,
		forYear: years.at(-1)! + 1,
		years,
		params: p,
		universe: universeN,
		noHistory,
		illiquid,
		/** T-021: how many liquid shares are in each cap group (before the filter), and how many it left out */
		capCounts,
		capOut,
		passed: passed.length,
		expected: Math.round(universeN * binomTail(p.years, p.k, prob) * 10) / 10,
		placebo: placebo(u, rows.filter(kept), years, quarter, variant, p, passed.length),
		p: Math.round(prob * 1000) / 1000,
		candidates: chosen.map((x) => ({
			id: x.s.id,
			symbol: x.s.symbol,
			name: x.s.name,
			exchange: x.s.exchange,
			market: x.s.market,
			sector: x.s.sector,
			results: x.m.map(pct),
			up: x.m.filter((v) => v > 0).length,
			mean: pct(x.m.reduce((a, b) => a + b, 0) / x.m.length),
			median: pct(median(x.m)),
			worst: pct(Math.min(...x.m)),
			turnoverUsd: Math.round(x.row.turnoverUsd),
			priceUsd: Math.round(x.row.priceUsd * 100) / 100,
			capUsd: x.s.capUsd,
			capGroup: groupsNow.get(x.row) ?? null,
			score: variant === 'C' ? Math.round(x.score * 100) / 100 : null
		})),
		capped,
		bench: { US: bench('US'), IL: bench('IL') },
		walk: walkForward(rows, ms, years, p, variant, (t) => capGroupMap(rows, p, (r) => capAt(r.s, quarterEnd(years[t], quarter) - 3, u.usdIls))),
		dataMonth: monthName(u.lastMonth)
	};
}

/**
 * T-020: one security's block on its card — its 10 results in the quarter next to the market, the mean, the
 * median, the worst year, and whether it is among the variant's candidates. The measure of variant B «over the
 * sector» needs the sector's mean, so the universe's rows are measured as in the full run.
 */
export function securityResult(u: Universe, id: number, variant: Variant, quarter: number, input: Params) {
	const p = { ...input, k: Math.min(input.k, input.years) };
	const s = u.stocks.find((x) => x.id === id);
	if (!s) return null;
	const years = windowYears(u.lastMonth, quarter, p.years);
	const rows: Row[] = [];
	let target: Row | null = null;
	for (const x of u.stocks) {
		const r = years.map((y) => quarterReturn(x, y, quarter));
		const l = liquidity(x, u.lastMonth, u.usdIls);
		const row = { s: x, r, ...l };
		if (x.id === id) target = row;
		if (r.some((v) => !Number.isFinite(v)) || l.turnoverUsd < p.minTurnoverUsd || l.priceUsd < p.minPriceUsd) continue;
		rows.push(row);
	}
	if (!target) return null;
	const inUniverse = rows.includes(target);
	const all = inUniverse ? rows : [...rows, target];
	const ms = measures(u, all, years, quarter, variant, p.compareWith);
	const m = ms[all.indexOf(target)];
	const ok = m.filter((v) => Number.isFinite(v));
	const pct = (x: number) => Math.round(x * 10000) / 100;
	const run = runModel(u, variant, quarter, p);
	const bench = (y: number) => {
		const b = u.bench[s.market];
		const x = b ? quarterReturn(b, y, quarter) : NaN;
		return Number.isFinite(x) ? pct(x) : null;
	};
	return {
		variant,
		quarter,
		forYear: years.at(-1)! + 1,
		years,
		results: m.map((v) => (Number.isFinite(v) ? pct(v) : null)),
		price: target.r.map((v) => (Number.isFinite(v) ? pct(v) : null)),
		bench: years.map(bench),
		up: ok.filter((v) => v > 0).length,
		mean: ok.length ? pct(ok.reduce((a, b) => a + b, 0) / ok.length) : null,
		median: ok.length ? pct(median(ok)) : null,
		worst: ok.length ? pct(Math.min(...ok)) : null,
		/** in the universe (full history, turnover and price), passed K, among the candidates and its place */
		inUniverse,
		capUsd: s.capUsd,
		capGroup: capGroupMap(all, p, (r) => r.s.capUsd).get(target) ?? null,
		score: variant === 'C' ? (() => { const sc = tScore(m); return sc === null ? null : Math.round(sc * 100) / 100; })() : null,
		passed: inUniverse && (variant === 'C' ? (tScore(m) ?? 0) >= SCORE_MIN : ok.filter((v) => v > 0).length >= p.k),
		rank: run.candidates.findIndex((c) => c.id === id) + 1 || null,
		params: p
	};
}

/**
 * The check without peeking: for each of the last three years of the window, candidates are chosen on the 7
 * years before it (K lowered by as many years as are dropped) and measured in that year, which the choice did
 * not see. Only for reference: shares that vanished in 10 years are not in the base.
 */
function walkForward(rows: Row[], ms: number[][], years: number[], p: Params, variant: Variant, groupsAt: (t: number) => Map<Row, string | null>): Walk[] {
	const train = 7;
	if (years.length < train + 1) return [];
	const k = Math.max(1, p.k - (p.years - train));
	const out: Walk[] = [];
	for (let t = Math.max(train, years.length - 3); t < years.length; t++) {
		// T-021: the cap filter with the cap of that time (approximately: today's shares × the price then)
		const groups = p.capGroups.length ? groupsAt(t) : null;
		const list = rows
			.map((row, i) => {
				const m = ms[i].slice(t - train, t);
				return { s: row.s, m, score: variant === 'C' ? (tScore(m) ?? -Infinity) : scoreOf(m, p.sort), test: ms[i][t], keep: !groups || p.capGroups.includes(groups.get(row) ?? '') };
			})
			.filter((x) => x.keep && (variant === 'C' ? Number.isFinite(x.score) : x.m.filter((v) => v > 0).length >= k));
		const { chosen } = pick(list, p);
		const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10000) / 100 : null);
		out.push({
			year: years[t],
			picked: chosen.length,
			pickedMean: avg(chosen.map((x) => x.test)),
			allMean: avg(ms.map((m) => m[t])),
			pickedUp: chosen.filter((x) => x.test > 0).length
		});
	}
	return out;
}

// ── market cap (T-021) ──────────────────────────────────────────────────────────

export const absGroup = (cap: number, b: number[]) => (cap >= b[0] ? 'mega' : cap >= b[1] ? 'large' : cap >= b[2] ? 'mid' : cap >= b[3] ? 'small' : 'micro');

/** the cap at a month: today's number of shares × that month's close, in dollars at today's rate (approximate) */
export function capAt(s: Series, i: number, usdIls: number): number | null {
	if (!s.shares) return null;
	const c = at(s, i, s.close);
	if (!(c > 0)) return null;
	const local = s.shares * (s.unit === 'ILA' ? c / 100 : c);
	return s.unit === 'USD' ? local : local / usdIls;
}

/** each row's cap group: by the bounds in dollars, or by its rank in its own market (top 20%, bottom 30%) */
function capGroupMap(rows: Row[], p: Params, cap: (r: Row) => number | null): Map<Row, string | null> {
	const out = new Map<Row, string | null>();
	if (p.capMode === 'abs') {
		for (const r of rows) {
			const c = cap(r);
			out.set(r, c === null ? null : absGroup(c, p.capBounds));
		}
		return out;
	}
	for (const mk of ['US', 'IL'] as const) {
		const list = rows
			.filter((r) => r.s.market === mk)
			.map((r) => ({ r, c: cap(r) }))
			.filter((x): x is { r: Row; c: number } => x.c !== null)
			.sort((a, b) => b.c - a.c);
		list.forEach((x, i) => out.set(x.r, i < list.length * 0.2 ? 'top' : i >= list.length * 0.7 ? 'bottom' : 'middle'));
	}
	for (const r of rows) if (!out.has(r)) out.set(r, null);
	return out;
}

// ── a cached universe ───────────────────────────────────────────────────────────

let cached: Universe | null = null;
let cachedKey = '';
let cachedAt = 0;

/**
 * The universe, rebuilt when the monthly data or the sectors changed. Reading all monthly prices takes seconds
 * on the NAS and blocks the server, so while a load runs (the key changes every few seconds) a built universe
 * is kept for 30 minutes; the monthly job drops it when it ends (`dropUniverse`).
 */
export function universe(market: Database.Database): Universe {
	const k = market.prepare(`select (select count(*) from ops_monthly_loads where status = 'ok') || '|' || (select count(*) from ref_security_profiles where sector is not null) as k`).get() as { k: string | null };
	const key = k.k ?? '';
	if (!cached || (key !== cachedKey && Date.now() - cachedAt > 30 * 60_000)) {
		cached = loadUniverse(market);
		cachedKey = key;
		cachedAt = Date.now();
	}
	return cached;
}

export function dropUniverse() {
	cached = null;
}

/** the next calendar quarter after `now` (Israel time): in November 2026 — Q1 2027 */
export function nextQuarter(now = new Date()) {
	const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number);
	const q = Math.floor((m - 1) / 3) + 1;
	return q === 4 ? { year: y + 1, quarter: 1 } : { year: y, quarter: q + 1 };
}

/** shares of the universe (full history, liquid): their profiles give the sector caps and the market cap (T-021) */
export function universeIds(u: Universe, p: Params = DEFAULTS): number[] {
	const first = u.lastMonth - 12 * p.years - 3;
	return u.stocks
		.filter((s) => s.start <= first && Number.isFinite(at(s, u.lastMonth)))
		.filter((s) => {
			const l = liquidity(s, u.lastMonth, u.usdIls);
			return l.turnoverUsd >= p.minTurnoverUsd && l.priceUsd >= p.minPriceUsd;
		})
		.map((s) => s.id);
}

/** shares of the universe (full history, liquid) without a sector yet — their profiles are loaded for the caps */
export function needSector(u: Universe, p: Params = DEFAULTS): number[] {
	// the whole window of any quarter: from the month before the earliest quarter to the last month
	const first = u.lastMonth - 12 * p.years - 3;
	return u.stocks
		.filter((s) => !s.sector && s.start <= first && Number.isFinite(at(s, u.lastMonth)))
		.filter((s) => {
			const l = liquidity(s, u.lastMonth, u.usdIls);
			return l.turnoverUsd >= p.minTurnoverUsd && l.priceUsd >= p.minPriceUsd;
		})
		.map((s) => s.id);
}
