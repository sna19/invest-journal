import type Database from 'better-sqlite3';

/**
 * The quarterly model, sub-stage 10a (spec section 21, T-009). For a calendar quarter: each share's price change
 * inside that quarter in each of the last N years (default 10) — from the close of the month before the quarter
 * to the close of its last month, on dividend- and split-adjusted monthly prices. Variant A «Рост цены» (the
 * owner's scheme) counts the change itself; variant B «Против рынка» counts it over the market's (S&P 500 or
 * TA-125) or over the average of the share's sector. Shares that rose (beat) in at least K of the N years pass,
 * are sorted by the mean (median, worst year) and give 10 candidates with at most 2 per sector and 7 per market.
 */

/**
 * A — the rise (the owner's scheme), B — over the market or sector, C — the score (T-011): no K, ranked by a t-like
 * score; D — against its own trend (T-018): the quarter over the mean of the same share's quarters of that year
 */
export type Variant = 'A' | 'B' | 'C' | 'D' | 'G';

/** C and G rank by the score, without K (G — «Г. С причиной»: as C, only shares with a reason label, T-013) */
export const scored = (v: Variant) => v === 'C' || v === 'G';

/** T-018: the trend filter at the choice (monthly closes) and the early exit inside the quarter */
export type TrendFilter = 'none' | 'price_sma10' | 'sma3_sma10';
export type TrendExit = 'none' | 'sma3';

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
	/** T-012: the broker's fee — % of a trade, but not less than the minimum in dollars; the tax on realized gains, % */
	commissionPct: number;
	commissionMinUsd: number;
	taxPct: number;
	/** T-018: «Цена выше SMA 10 мес.» (≈ SMA200 days, Faber) / «SMA 3 мес. выше SMA 10 мес.» (≈ SMA50 > SMA200) */
	trendFilter: TrendFilter;
	/** T-018: sell early inside the quarter if a monthly close is below its SMA 3 months (end of the 1st and 2nd month) */
	trendExit: TrendExit;
	/** T-018: «за 2 месяца не выросли» — the result of the first two months at most this, % */
	lagThreshold: number;
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
	capBounds: [200e9, 10e9, 2e9, 0.3e9],
	commissionPct: 0.1,
	commissionMinUsd: 5,
	taxPct: 25,
	trendFilter: 'none',
	trendExit: 'none',
	lagThreshold: 0
};

/** the limits a parameter is kept in (the screen's inputs and the API check) */
export const LIMITS: Record<'years' | 'k' | 'count' | 'perSector' | 'perMarket' | 'minTurnoverUsd' | 'minPriceUsd' | 'commissionPct' | 'commissionMinUsd' | 'taxPct' | 'lagThreshold', [number, number]> = {
	years: [5, 15],
	k: [1, 15],
	count: [1, 30],
	perSector: [1, 30],
	perMarket: [1, 30],
	minTurnoverUsd: [0, 100_000_000],
	minPriceUsd: [0, 1000],
	commissionPct: [0, 2],
	commissionMinUsd: [0, 50],
	taxPct: [0, 50],
	lagThreshold: [-20, 20]
};

/** the parameters with fractions: not rounded to whole numbers */
const FRACTIONAL = new Set(['minTurnoverUsd', 'minPriceUsd', 'commissionPct', 'commissionMinUsd', 'taxPct', 'lagThreshold']);

export function cleanParams(input: Partial<Record<keyof Params, unknown>>, base: Params = DEFAULTS): Params {
	const p: Params = { ...base };
	for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
		if (input[k] === undefined || input[k] === '') continue;
		const n = Number(input[k]);
		if (!Number.isFinite(n)) continue;
		const [lo, hi] = LIMITS[k];
		p[k] = Math.min(hi, Math.max(lo, FRACTIONAL.has(k) ? Math.round(n * 1000) / 1000 : Math.round(n)));
	}
	if (input.sort === 'mean' || input.sort === 'median' || input.sort === 'worst') p.sort = input.sort;
	if (input.compareWith === 'market' || input.compareWith === 'sector') p.compareWith = input.compareWith;
	if (input.capMode === 'abs' || input.capMode === 'rel') p.capMode = input.capMode;
	if (input.trendFilter === 'none' || input.trendFilter === 'price_sma10' || input.trendFilter === 'sma3_sma10') p.trendFilter = input.trendFilter;
	if (input.trendExit === 'none' || input.trendExit === 'sma3') p.trendExit = input.trendExit;
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
	/** T-013: the months (month index) with an earnings report and with a dividend's ex-date; absent — not loaded */
	events?: { earnings: Set<number>; dividends: Set<number> };
	/** T-031: funds of the same thing (GLD and IAU — gold): only one of them is chosen */
	twin?: string;
}

export interface Universe {
	stocks: Series[];
	/** T-031: the exchange funds with monthly prices (for the commodities' universe), by symbol */
	funds: Map<string, Series>;
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

// ── T-018: the trend by monthly closes ───────────────────────────────────────────

/** the simple average of the `n` monthly closes up to month `i` (split-adjusted, as on a chart); NaN without them */
export function smaMonths(s: Series, i: number, n: number): number {
	let sum = 0;
	for (let k = 0; k < n; k++) {
		const c = at(s, i - k, s.close);
		if (!(c > 0)) return NaN;
		sum += c;
	}
	return sum / n;
}

/** whether the share passes the trend filter at month `i`; without the history a filter is not passed */
export function trendOk(s: Series, i: number, f: TrendFilter): boolean {
	if (f === 'none') return true;
	const sma10 = smaMonths(s, i, 10);
	if (f === 'price_sma10') return at(s, i, s.close) > sma10;
	return smaMonths(s, i, 3) > sma10;
}

/** the close at month `i` against its SMA 10 months, % */
export function vsSma10(s: Series, i: number): number | null {
	const x = at(s, i, s.close) / smaMonths(s, i, 10) - 1;
	return Number.isFinite(x) ? Math.round(x * 10000) / 100 : null;
}

/**
 * The quarter held month by month: the value after each month against the start (dividends included), and with the
 * trend exit the sale at the end of the 1st or 2nd month whose close is below its SMA 3 months.
 */
export function quarterPath(s: Series, y: number, q: number, exit: TrendExit = 'none'): { ret: number; path: number[]; exitMonth: number | null } {
	const e0 = quarterEnd(y, q) - 3;
	const base = at(s, e0);
	const path: number[] = [];
	let exitMonth: number | null = null;
	for (let k = 1; k <= 3; k++) {
		if (exitMonth !== null) {
			path.push(path[k - 2]);
			continue;
		}
		path.push(at(s, e0 + k) / base);
		if (exit === 'sma3' && k < 3 && at(s, e0 + k, s.close) < smaMonths(s, e0 + k, 3)) exitMonth = k;
	}
	return { ret: path[2] - 1, path, exitMonth };
}

/** the result of each month of a quarter: [m1, m2, m3] */
export function monthReturns(s: Series, y: number, q: number): number[] {
	const e0 = quarterEnd(y, q) - 3;
	return [1, 2, 3].map((k) => at(s, e0 + k) / at(s, e0 + k - 1) - 1);
}

/** the share's usual quarter of a year: the mean of its quarters complete by `lastMonth` (T-018, 11) */
export function usualQuarter(s: Series, y: number, lastMonth: number): number {
	const xs = [1, 2, 3, 4].filter((q) => quarterEnd(y, q) <= lastMonth).map((q) => quarterReturn(s, y, q)).filter((v) => Number.isFinite(v));
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

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
	// T-013: the calendar of reports and dividends, by month
	const ev = new Map<number, { earnings: Set<number>; dividends: Set<number> }>();
	for (const r of market.prepare(`select security_id as id from ops_events_loads where status in ('ok', 'none')`).all() as { id: number }[])
		ev.set(r.id, { earnings: new Set(), dividends: new Set() });
	for (const [id, kind, date] of market.prepare('select security_id, kind, date from ref_security_events').raw().iterate() as Iterable<[number, string, string]>) {
		const e = ev.get(id);
		if (e) (kind === 'earnings' ? e.earnings : e.dividends).add(monthIndex(date.slice(0, 7)));
	}
	const stocks: Series[] = [];
	const funds = new Map<string, Series>();
	let US: Series | null = null;
	let IL: Series | null = null;
	for (const m of meta) {
		const s = toSeries(m);
		if (!s) continue;
		if (m.bench) {
			if (m.country === 'IL') IL = s;
			else US = s;
		} else if (m.type === 'stock' && !isFund(m)) {
			const e = ev.get(m.id);
			if (e) s.events = e;
			stocks.push(s);
		} else if (s.market === 'US' && !funds.has(s.symbol)) funds.set(s.symbol, s);
	}
	return { stocks, funds, bench: { US, IL }, lastMonth: last, usdIls, builtAt: new Date().toISOString() };
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
/** T-018 (11): the quarter against the share's usual quarter of each year of the window */
export function ownQuarter(s: Series, years: number[], quarter: number, lastMonth: number): OwnQuarter {
	const xs = years.map((y) => quarterReturn(s, y, quarter) - usualQuarter(s, y, lastMonth)).filter((v) => Number.isFinite(v));
	const r = (x: number) => Math.round(x * 10000) / 100;
	return { mean: xs.length ? r(xs.reduce((a, b) => a + b, 0) / xs.length) : null, median: xs.length ? r(median(xs)) : null, up: xs.filter((v) => v > 0).length, years: xs.length };
}

// ── T-013: the reason labels ────────────────────────────────────────────────────

export interface Reasons {
	/** a report in this quarter in most years (null — the calendar is not loaded) */
	earnings: boolean | null;
	/** a dividend's ex-date in this quarter in most years */
	dividend: boolean | null;
	/** the share's whole sector beats the market in this quarter (the sector passes K as a share of variant B would) */
	sector: boolean;
}

/** months of quarter q of year y: month indexes */
const quarterMonths = (y: number, q: number) => [0, 1, 2].map((k) => y * 12 + (q - 1) * 3 + k);

/**
 * A label holds in at least 70% of the years: reports — of the years the calendar covers (it has a report that year;
 * Yahoo's calendar ends in May 2025), at least three; dividends — of all the window's years.
 */
export function reasonLabels(s: Series, quarter: number, years: number[], sectorSeasonal: Set<string>): Reasons {
	const sector = !!s.sector && sectorSeasonal.has(s.sector);
	if (!s.events) return { earnings: null, dividend: null, sector };
	const inQ = (set: Set<number>, y: number) => quarterMonths(y, quarter).some((i) => set.has(i));
	const inYear = (set: Set<number>, y: number) => [1, 2, 3, 4].some((q) => quarterMonths(y, q).some((i) => set.has(i)));
	const covered = years.filter((y) => inYear(s.events!.earnings, y));
	const earnings = covered.length >= 3 ? covered.filter((y) => inQ(s.events!.earnings, y)).length >= 0.7 * covered.length : null;
	const dividend = years.filter((y) => inQ(s.events!.dividends, y)).length >= 0.7 * years.length;
	return { earnings, dividend, sector };
}

/** the sectors (at least 5 shares) whose equal-weighted mean beats the market in this quarter in at least K years */
export function seasonalSectors(u: Universe, rows: { s: Series; r: number[] }[], years: number[], quarter: number, k: number): Set<string> {
	const by = new Map<string, { s: Series; r: number[] }[]>();
	for (const x of rows) if (x.s.sector) (by.get(x.s.sector) ?? by.set(x.s.sector, []).get(x.s.sector)!).push(x);
	const out = new Set<string>();
	for (const [sec, list] of by) {
		if (list.length < 5) continue;
		let up = 0;
		years.forEach((y, j) => {
			// each share against its own market, then the sector's mean
			const ex = list.map((x) => x.r[j] - (u.bench[x.s.market] ? quarterReturn(u.bench[x.s.market]!, y, quarter) : NaN)).filter((v) => Number.isFinite(v));
			if (ex.length && ex.reduce((a, b) => a + b, 0) / ex.length > 0) up++;
		});
		if (up >= k) out.add(sec);
	}
	return out;
}

const hasReason = (r: Reasons) => !!(r.earnings || r.dividend || r.sector);

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
	/** T-018 (7): the mean result of the quarter's 1st, 2nd and 3rd month over the window, % */
	months: (number | null)[];
	/** T-018 (11): the quarter over the share's usual quarter of the same year — mean, median, years above, % */
	own: OwnQuarter;
	/** T-018 (4): the last monthly close against its SMA 10 months, % */
	sma10: number | null;
	/** T-013: the reason labels */
	reasons: Reasons;
}

export interface OwnQuarter {
	mean: number | null;
	median: number | null;
	up: number;
	years: number;
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
	/** T-018: shares the trend filter left out (of those that passed), and the months of all candidates together */
	trendOut: number;
	months: (number | null)[];
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
export function placebo(u: Universe, rows: Row[], years: number[], quarter: number, variant: Variant, p: Params, real: number, runs = 100, only?: boolean[]): Placebo {
	// measure[q][row][year] — each quarter measured as the real calculation measures its own quarter
	const byQ = [1, 2, 3, 4].map((q) => {
		const rq = rows.map((r) => ({ ...r, r: years.map((y) => quarterReturn(r.s, y, q)) }));
		return measures(u, rq, years, q, variant, p.compareWith);
	});
	const rand = rng(quarter * 7919 + (variant === 'B' ? 104729 : variant === 'C' ? 209459 : variant === 'G' ? 314159 : 0) + p.k * 31 + p.years);
	// for each share and year: the measures of the quarters available — drawn from in every run
	const cells: number[][][] = rows.map((_, i) => years.map((_, j) => [0, 1, 2, 3].map((q) => byQ[q][i][j]).filter((v) => Number.isFinite(v))));
	let ge = 0;
	let sum = 0;
	const drawn: number[] = [];
	for (let run = 0; run < runs; run++) {
		let passed = 0;
		for (let i = 0; i < cells.length; i++) {
			const share = cells[i];
			// G: only the shares with a reason label take part (the labels belong to the share, not to the draw)
			if (only && !only[i]) continue;
			if (scored(variant)) {
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
	// D: over the share's own usual quarter of that year — the mean of its quarters complete in the data
	if (variant === 'D') return rows.map((x) => x.r.map((r, i) => r - usualQuarter(x.s, years[i], u.lastMonth)));
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
	const twins = new Set<string>();
	let capped = 0;
	for (const x of sorted) {
		if (chosen.length >= p.count) break;
		const sec = x.s.sector ?? '—';
		// T-031: one fund of the same thing (GLD or IAU)
		if (x.s.twin && twins.has(x.s.twin)) {
			capped++;
			continue;
		}
		if ((sectors.get(sec) ?? 0) >= p.perSector || (markets.get(x.s.market) ?? 0) >= p.perMarket) {
			capped++;
			continue;
		}
		sectors.set(sec, (sectors.get(sec) ?? 0) + 1);
		markets.set(x.s.market, (markets.get(x.s.market) ?? 0) + 1);
		if (x.s.twin) twins.add(x.s.twin);
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
	// T-013: the reason labels — the sectors seasonal in this quarter, the reports and dividends of each share
	const sectorSet = seasonalSectors(u, rows, years, quarter, p.k);
	const reasonsOf = new Map(rows.map((r) => [r, reasonLabels(r.s, quarter, years, sectorSet)]));
	const labelOk = (r: Row) => variant !== 'G' || hasReason(reasonsOf.get(r)!);
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
		if (scored(variant)) {
			const sc = tScore(m);
			if (!labelOk(row)) return;
			if (sc !== null) ranked.push({ s: row.s, score: sc, m, row });
			if (sc !== null && sc >= SCORE_MIN) passed.push({ s: row.s, score: sc, m, row });
		} else if (up >= p.k) passed.push({ s: row.s, score: scoreOf(m, p.sort), m, row });
	});
	const prob = all ? ups / all : 0;
	// T-018: the trend filter at the last month of the data (the choice is redone when the quarter is recorded)
	const pool = (scored(variant) ? ranked : passed).filter((x) => trendOk(x.s, u.lastMonth, p.trendFilter));
	const trendOut = (scored(variant) ? ranked : passed).length - pool.length;
	const { chosen, capped } = pick(pool, p);
	const monthsOf = (x: Series) => [0, 1, 2].map((k) => {
		const xs = years.map((y) => monthReturns(x, y, quarter)[k]).filter((v) => Number.isFinite(v));
		return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
	});
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
		placebo: placebo(u, rows.filter(kept), years, quarter, variant, p, passed.length, 100, variant === 'G' ? rows.filter(kept).map((r) => hasReason(reasonsOf.get(r)!)) : undefined),
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
			score: scored(variant) ? Math.round(x.score * 100) / 100 : null,
			months: monthsOf(x.s).map((v) => (Number.isFinite(v) ? pct(v) : null)),
			own: ownQuarter(x.s, years, quarter, u.lastMonth),
			sma10: vsSma10(x.s, u.lastMonth),
			reasons: reasonsOf.get(x.row)!
		})),
		capped,
		bench: { US: bench('US'), IL: bench('IL') },
		walk: walkForward(rows, ms, years, p, variant, quarter, (row) => labelOk(row), (t) => capGroupMap(rows, p, (r) => capAt(r.s, quarterEnd(years[t], quarter) - 3, u.usdIls))),
		dataMonth: monthName(u.lastMonth),
		trendOut,
		months: [0, 1, 2].map((k) => {
			const xs = chosen.map((x) => monthsOf(x.s)[k]).filter((v) => Number.isFinite(v));
			return xs.length ? pct(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
		})
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
		score: scored(variant) ? (() => { const sc = tScore(m); return sc === null ? null : Math.round(sc * 100) / 100; })() : null,
		passed:
			inUniverse &&
			(scored(variant) ? (tScore(m) ?? 0) >= SCORE_MIN : ok.filter((v) => v > 0).length >= p.k) &&
			(variant !== 'G' || hasReason(reasonLabels(s, quarter, years, seasonalSectors(u, rows, years, quarter, p.k)))),
		rank: run.candidates.findIndex((c) => c.id === id) + 1 || null,
		params: p,
		months: [0, 1, 2].map((k) => {
			const xs = years.map((y) => monthReturns(s, y, quarter)[k]).filter((v) => Number.isFinite(v));
			return xs.length ? pct(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
		}),
		own: ownQuarter(s, years, quarter, u.lastMonth),
		sma10: vsSma10(s, u.lastMonth),
		trendOk: trendOk(s, u.lastMonth, p.trendFilter),
		reasons: reasonLabels(s, quarter, years, seasonalSectors(u, rows, years, quarter, p.k))
	};
}

/**
 * The check without peeking: for each of the last three years of the window, candidates are chosen on the 7
 * years before it (K lowered by as many years as are dropped) and measured in that year, which the choice did
 * not see. Only for reference: shares that vanished in 10 years are not in the base.
 */
function walkForward(rows: Row[], ms: number[][], years: number[], p: Params, variant: Variant, quarter: number, lab: (row: Row) => boolean, groupsAt: (t: number) => Map<Row, string | null>): Walk[] {
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
				// T-018: the trend exit changes what the quarter brought: the measure moves by the difference
				const exitGap = p.trendExit === 'none' ? 0 : quarterPath(row.s, years[t], quarter, p.trendExit).ret - row.r[t];
				return {
					s: row.s,
					m,
					score: scored(variant) ? (tScore(m) ?? -Infinity) : scoreOf(m, p.sort),
					test: ms[i][t] + (Number.isFinite(exitGap) ? exitGap : 0),
					keep: (!groups || p.capGroups.includes(groups.get(row) ?? '')) && trendOk(row.s, quarterEnd(years[t], quarter) - 3, p.trendFilter) && lab(row)
				};
			})
			.filter((x) => x.keep && (scored(variant) ? Number.isFinite(x.score) : x.m.filter((v) => v > 0).length >= k));
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
	const k = market
		.prepare(
			`select (select count(*) from ops_monthly_loads where status = 'ok') || '|' || (select count(*) from ref_security_profiles where sector is not null) || '|' || (select count(*) from ops_events_loads) as k`
		)
		.get() as { k: string | null };
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

// ── T-012: the costs — the variant's portfolio over the last 12 quarters ─────────────────────────────────────────

export interface CostQuarter {
	/** «2025-Q3» */
	label: string;
	picked: number;
	/** of them kept from the quarter before by the rule «hold if chosen again» */
	kept: number;
	/** the equal-weighted candidates without any cost, % */
	gross: number | null;
	/** the portfolio after the fee and the tax, with the rule and without, % */
	hold: number | null;
	noHold: number | null;
}

export interface CostBook {
	/** the annual return over the period, %; after costs — as if everything were sold at the end */
	cagr: number | null;
	fees: number;
	taxes: number;
	/** the purchases of a year against the portfolio's mean value, % */
	turnover: number;
	/** positions not sold because chosen again */
	kept: number;
	endValue: number;
}

export interface CostRun {
	quarters: CostQuarter[];
	years: number;
	/** the money at the start: the automatic portfolio's sum per hypothesis × the number of candidates */
	start: number;
	gross: number | null;
	hold: CostBook;
	noHold: CostBook;
}

/** a portfolio per position notional of 3 000 $ — the automatic portfolio's sum (section 18) */
export const NOTIONAL_USD = 3000;

/**
 * The quarters in a row, the candidates of each chosen as in the check without peeking (on the 7 years before,
 * K lowered as there; the measure and the cap filter of the variant), held for the quarter, each bought for an
 * equal part. Two books: with «hold if chosen again» (a share chosen again is neither sold nor bought) and
 * without (everything sold and bought every quarter). The fee — on every purchase and sale; the tax — on the
 * net realized gain of a calendar year, a loss carried to the next; at the end everything is sold, so the
 * unrealized gain of the book with the rule is taxed too. The returns include dividends (adjusted prices), not
 * taxed separately. Only the shares that are in the base today — the same peeking as in the check.
 */
export function costRun(u: Universe, variant: Variant, input: Params, n = 12): CostRun {
	const p = { ...input, k: Math.min(input.k, input.years) };
	const train = 7;
	const k = Math.max(1, p.k - (p.years - train));
	// the last complete quarter, then n back
	let y = Math.floor(u.lastMonth / 12);
	let q = 4;
	while (quarterEnd(y, q) > u.lastMonth) if (--q === 0) (q = 4), y--;
	const seq: { y: number; q: number }[] = [];
	for (let i = 0; i < n; i++) {
		seq.unshift({ y, q });
		if (--q === 0) (q = 4), y--;
	}
	const liquid = new Map<Series, { turnoverUsd: number; priceUsd: number }>();
	for (const s of u.stocks) {
		const l = liquidity(s, u.lastMonth, u.usdIls);
		if (l.turnoverUsd >= p.minTurnoverUsd && l.priceUsd >= p.minPriceUsd) liquid.set(s, l);
	}
	const choose = (yy: number, qq: number) => {
		const yrs = Array.from({ length: train + 1 }, (_, i) => yy - train + i);
		const rows: Row[] = [];
		for (const [s, l] of liquid) {
			const r = yrs.map((x) => quarterReturn(s, x, qq));
			if (r.every((x) => Number.isFinite(x))) rows.push({ s, r, ...l });
		}
		const ms = measures(u, rows, yrs, qq, variant, p.compareWith);
		const groups = p.capGroups.length ? capGroupMap(rows, p, (r) => capAt(r.s, quarterEnd(yy, qq) - 3, u.usdIls)) : null;
		// G: the reason labels of the training years
		const trainYrs = yrs.slice(0, train);
		const sectorsG = variant === 'G' ? seasonalSectors(u, rows.map((r) => ({ s: r.s, r: r.r.slice(0, train) })), trainYrs, qq, k) : null;
		const list = rows
			.filter((row) => !sectorsG || hasReason(reasonLabels(row.s, qq, trainYrs, sectorsG)))
			.map((row, i) => {
				const m = ms[i].slice(0, train);
				const r = p.trendExit === 'none' ? row.r[train] : quarterPath(row.s, yy, qq, p.trendExit).ret;
				return {
					s: row.s,
					m,
					score: scored(variant) ? (tScore(m) ?? -Infinity) : scoreOf(m, p.sort),
					r: Number.isFinite(r) ? r : row.r[train],
					keep: (!groups || p.capGroups.includes(groups.get(row) ?? '')) && trendOk(row.s, quarterEnd(yy, qq) - 3, p.trendFilter)
				};
			})
			.filter((x) => x.keep && (scored(variant) ? Number.isFinite(x.score) : x.m.filter((v) => v > 0).length >= k));
		return pick(list, p).chosen.map((x) => ({ id: x.s.id, r: x.r }));
	};
	const fee = (amount: number) => (amount > 0 ? Math.max((amount * p.commissionPct) / 100, p.commissionMinUsd) : 0);
	const start = p.count * NOTIONAL_USD;

	interface Book {
		cash: number;
		pos: Map<number, { value: number; cost: number }>;
		realized: number;
		carry: number;
		fees: number;
		taxes: number;
		bought: number;
		kept: number;
		values: number[];
	}
	const book = (): Book => ({ cash: start, pos: new Map(), realized: 0, carry: 0, fees: 0, taxes: 0, bought: 0, kept: 0, values: [] });
	const valueOf = (b: Book) => b.cash + [...b.pos.values()].reduce((x, v) => x + v.value, 0);
	const sell = (b: Book, id: number) => {
		const x = b.pos.get(id)!;
		const f = fee(x.value);
		b.fees += f;
		b.cash += x.value - f;
		b.realized += x.value - f - x.cost;
		b.pos.delete(id);
	};
	const payTax = (b: Book) => {
		const net = b.realized + b.carry;
		if (net > 0) {
			const t = (net * p.taxPct) / 100;
			b.taxes += t;
			b.cash -= t;
			b.carry = 0;
		} else b.carry = net;
		b.realized = 0;
	};
	const step = (b: Book, chosen: { id: number; r: number }[], hold: boolean) => {
		const want = new Set(chosen.map((c) => c.id));
		for (const id of [...b.pos.keys()]) if (!hold || !want.has(id)) sell(b, id);
		const fresh = chosen.filter((c) => !b.pos.has(c.id));
		b.kept += chosen.length - fresh.length;
		// the money there is goes in equal parts into the new ones; a tax owed may leave little
		const each = fresh.length && b.cash > 0 ? b.cash / fresh.length : 0;
		for (const c of fresh) {
			if (!(each > 0)) break;
			const f = fee(each);
			b.fees += f;
			b.bought += each;
			b.cash -= each;
			b.pos.set(c.id, { value: each - f, cost: each });
		}
		for (const c of chosen) {
			const x = b.pos.get(c.id);
			if (x) x.value *= 1 + c.r;
		}
	};
	const withRule = book();
	const without = book();
	let gross = 1;
	const quarters: CostQuarter[] = [];
	const pct = (x: number) => Math.round(x * 10000) / 100;
	let prevH = start;
	let prevN = start;
	let prevPicked = new Set<number>();
	for (let i = 0; i < seq.length; i++) {
		const { y: yy, q: qq } = seq[i];
		const chosen = choose(yy, qq);
		const g = chosen.length ? chosen.reduce((x, c) => x + c.r, 0) / chosen.length : 0;
		gross *= 1 + g;
		step(withRule, chosen, true);
		step(without, chosen, false);
		// the turnover counts the changes, not the first purchase
		if (i === 0) withRule.bought = without.bought = 0;
		// the tax of a calendar year — after its last quarter
		if (qq === 4) for (const b of [withRule, without]) payTax(b);
		const vh = valueOf(withRule);
		const vn = valueOf(without);
		withRule.values.push(vh);
		without.values.push(vn);
		quarters.push({
			label: `${yy}-Q${qq}`,
			picked: chosen.length,
			kept: chosen.filter((c) => prevPicked.has(c.id)).length,
			gross: chosen.length ? pct(g) : null,
			hold: pct(vh / prevH - 1),
			noHold: pct(vn / prevN - 1)
		});
		prevPicked = new Set(chosen.map((c) => c.id));
		prevH = vh;
		prevN = vn;
	}
	const years = seq.length / 4;
	const turnYears = (seq.length - 1) / 4 || 1;
	const close = (b: Book): CostBook => {
		for (const id of [...b.pos.keys()]) sell(b, id);
		payTax(b);
		const end = b.cash;
		const mean = b.values.reduce((x, v) => x + v, 0) / (b.values.length || 1);
		return {
			cagr: end > 0 ? pct((end / start) ** (1 / years) - 1) : null,
			fees: Math.round(b.fees),
			taxes: Math.round(b.taxes),
			turnover: Math.round((b.bought / turnYears / mean) * 100),
			kept: b.kept,
			endValue: Math.round(end)
		};
	};
	return { quarters, years, start, gross: pct(gross ** (1 / years) - 1), hold: close(withRule), noHold: close(without) };
}

// ── T-018 (3): trend filter × trend exit ─────────────────────────────────────────

export interface TrendStats {
	/** the candidates' mean excess over their market per year, % */
	excess: number | null;
	median: number | null;
	worst: number | null;
	/** the worst fall of the equal-weighted candidates inside a quarter, month by month, % (≤ 0) */
	maxDrawdown: number | null;
	avgCount: number;
	/** the share of years with fewer than 5 candidates, % */
	under5: number;
	years: number;
}

export interface TrendRow {
	filter: TrendFilter;
	exit: TrendExit;
	/** all years of the window: the candidates as chosen on the whole window (in sample) */
	all: TrendStats;
	/** the check without peeking: the last 3 years, chosen on the 7 before each */
	walk: TrendStats;
	/** the same with the quarters shuffled inside each year: the share of runs with an excess at least as large */
	placebo: { runs: number; mean: number | null; share: number; verdict: Placebo['verdict'] };
}

const FILTERS: TrendFilter[] = ['none', 'price_sma10', 'sma3_sma10'];
const EXITS: TrendExit[] = ['none', 'sma3'];

/**
 * The comparison table of T-018: every trend filter with every exit, on the variant's quarter — the excess over the
 * market, its median and worst year, the worst fall inside a quarter, how many candidates and how often fewer than
 * five; for each — the check without peeking and the placebo (as T-010: the quarters shuffled inside each year).
 */
export function trendTable(u: Universe, variant: Variant, quarter: number, input: Params, runs = 100): TrendRow[] {
	const p = { ...input, k: Math.min(input.k, input.years) };
	const years = windowYears(u.lastMonth, quarter, p.years);
	const rows: Row[] = [];
	for (const s of u.stocks) {
		const r = years.map((y) => quarterReturn(s, y, quarter));
		if (r.some((x) => !Number.isFinite(x))) continue;
		const l = liquidity(s, u.lastMonth, u.usdIls);
		if (l.turnoverUsd < p.minTurnoverUsd || l.priceUsd < p.minPriceUsd) continue;
		rows.push({ s, r, ...l });
	}
	const ms = measures(u, rows, years, quarter, variant, p.compareWith);
	const n = rows.length;
	const T = years.length;
	// per share and year: the quarter's result with each exit, its path, the market's quarter, the trend filters
	const bench = (m: 'US' | 'IL', y: number) => (u.bench[m] ? quarterReturn(u.bench[m]!, y, quarter) : NaN);
	const paths = EXITS.map((e) => rows.map((row) => years.map((y) => quarterPath(row.s, y, quarter, e))));
	const bq = rows.map((row) => years.map((y) => bench(row.s.market, y)));
	const ok = FILTERS.map((f) => rows.map((row) => years.map((y) => trendOk(row.s, quarterEnd(y, quarter) - 3, f))));
	const groups = p.capGroups.length ? years.map((y) => capGroupMap(rows, p, (r) => capAt(r.s, quarterEnd(y, quarter) - 3, u.usdIls))) : null;
	const capOk = (i: number, t: number) => !groups || p.capGroups.includes(groups[t].get(rows[i]) ?? '');
	const score = (m: number[]) => (scored(variant) ? (tScore(m) ?? -Infinity) : scoreOf(m, p.sort));
	const passes = (m: number[], k: number) => (scored(variant) ? Number.isFinite(score(m)) : m.filter((v) => v > 0).length >= k);

	type Pool = { i: number; s: Series; score: number }[];
	/** one year: the pool filtered by trend and cap, picked; the candidates' excess, path and count */
	const year = (pool: Pool, t: number, fi: number, ei: number) => {
		const { chosen } = pick(pool.filter((x) => ok[fi][x.i][t] && capOk(x.i, t)), p);
		if (!chosen.length) return { excess: NaN, dd: NaN, count: 0 };
		let ex = 0;
		const v = [0, 0, 0];
		for (const c of chosen) {
			const pa = paths[ei][c.i][t];
			ex += pa.ret - bq[c.i][t];
			for (let k = 0; k < 3; k++) v[k] += pa.path[k] / chosen.length;
		}
		let peak = 1;
		let dd = 0;
		for (const x of v) {
			peak = Math.max(peak, x);
			dd = Math.min(dd, x / peak - 1);
		}
		return { excess: ex / chosen.length, dd, count: chosen.length };
	};
	const stats = (list: { excess: number; dd: number; count: number }[]): TrendStats => {
		const xs = list.map((x) => x.excess).filter((v) => Number.isFinite(v));
		const dds = list.map((x) => x.dd).filter((v) => Number.isFinite(v));
		const r = (x: number) => Math.round(x * 10000) / 100;
		return {
			excess: xs.length ? r(xs.reduce((a, b) => a + b, 0) / xs.length) : null,
			median: xs.length ? r(median(xs)) : null,
			worst: xs.length ? r(Math.min(...xs)) : null,
			maxDrawdown: dds.length ? r(Math.min(...dds)) : null,
			avgCount: list.length ? Math.round((list.reduce((a, b) => a + b.count, 0) / list.length) * 10) / 10 : 0,
			under5: list.length ? Math.round((list.filter((x) => x.count < 5).length / list.length) * 100) : 0,
			years: list.length
		};
	};
	// in sample: the pool of the whole window
	// G: only shares with a reason label (labels of the whole window)
	const sectorsG = variant === 'G' ? seasonalSectors(u, rows, years, quarter, p.k) : null;
	const lab = rows.map((r) => !sectorsG || hasReason(reasonLabels(r.s, quarter, years, sectorsG)));
	const poolAll: Pool = [];
	for (let i = 0; i < n; i++) if (lab[i] && passes(ms[i], p.k)) poolAll.push({ i, s: rows[i].s, score: score(ms[i]) });
	// without peeking: each of the last 3 years on the 7 before it
	const train = 7;
	const kw = Math.max(1, p.k - (p.years - train));
	const walkYears = T >= train + 1 ? Array.from({ length: Math.min(3, T - train) }, (_, j) => T - Math.min(3, T - train) + j) : [];
	const walkPools = walkYears.map((t) => {
		const pool: Pool = [];
		for (let i = 0; i < n; i++) {
			const m = ms[i].slice(t - train, t);
			if (lab[i] && passes(m, kw)) pool.push({ i, s: rows[i].s, score: score(m) });
		}
		return pool;
	});
	// the placebo: the variant's measure of all four quarters; each run draws a quarter per share and year
	const byQ = [1, 2, 3, 4].map((q) => measures(u, rows.map((r) => ({ ...r, r: years.map((y) => quarterReturn(r.s, y, q)) })), years, q, variant, p.compareWith));
	const cells = rows.map((_, i) => years.map((_, j) => [0, 1, 2, 3].map((q) => byQ[q][i][j]).filter((v) => Number.isFinite(v))));
	const rand = rng(quarter * 104_651 + variant.charCodeAt(0) * 7 + p.k * 31 + p.years);
	const out: TrendRow[] = [];
	const realMeans: number[] = [];
	const combos: [number, number][] = [];
	for (let fi = 0; fi < FILTERS.length; fi++)
		for (let ei = 0; ei < EXITS.length; ei++) {
			combos.push([fi, ei]);
			const all = stats(years.map((_, t) => year(poolAll, t, fi, ei)));
			out.push({ filter: FILTERS[fi], exit: EXITS[ei], all, walk: stats(walkYears.map((t, j) => year(walkPools[j], t, fi, ei))), placebo: { runs, mean: null, share: 0, verdict: 'chance' } });
			realMeans.push(all.excess ?? -Infinity);
		}
	const sums = combos.map(() => 0);
	const ge = combos.map(() => 0);
	const counted = combos.map(() => 0);
	const m = new Array<number>(T);
	for (let run = 0; run < runs; run++) {
		const pool: Pool = [];
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < T; j++) {
				const a = cells[i][j];
				m[j] = a.length ? a[Math.floor(rand() * a.length)] : NaN;
			}
			if (lab[i] && passes(m, p.k)) pool.push({ i, s: rows[i].s, score: score(m) });
		}
		combos.forEach(([fi, ei], c) => {
			const xs = years.map((_, t) => year(pool, t, fi, ei).excess).filter((v) => Number.isFinite(v));
			if (!xs.length) return;
			const mean = (xs.reduce((a, b) => a + b, 0) / xs.length) * 100;
			sums[c] += mean;
			counted[c]++;
			if (mean >= realMeans[c]) ge[c]++;
		});
	}
	combos.forEach((_, c) => {
		const share = runs ? ge[c] / runs : 1;
		out[c].placebo = {
			runs,
			mean: counted[c] ? Math.round((sums[c] / counted[c]) * 100) / 100 : null,
			share,
			verdict: share < 0.05 && Number.isFinite(realMeans[c]) ? 'signal' : share < 0.25 ? 'unclear' : 'chance'
		};
	});
	return out;
}

// ── T-018 (8): do the laggards catch up? ─────────────────────────────────────────

export interface Laggards {
	/** past candidates of A and B, chosen without peeking (7 years before each), every quarter */
	n: number;
	/** the correlation of the first two months' result with the 3rd month's */
	corr: number | null;
	all: { mean3: number | null; up3: number | null; excess3: number | null };
	lag: { n: number; mean3: number | null; up3: number | null; excess3: number | null };
	/** the same with random shares of the same universe, as many as the candidates: the laggards' excess in the 3rd month */
	placebo: { runs: number; mean: number | null; share: number };
	verdict: 'catch_up' | 'no' | 'unclear';
	threshold: number;
}

let lagCache: { key: string; v: Laggards } | null = null;

/**
 * T-018 (8): every past candidate of variants A and B, chosen on the 7 years before its year (so its 3rd month was
 * not seen by the choice) — the result of months 1–2 against the 3rd; the laggards (months 1–2 at most the threshold)
 * against all candidates and the market, and against random shares of the same universe (100 runs).
 */
export function laggards(u: Universe, input: Params = DEFAULTS, runs = 100): Laggards {
	const key = `${u.builtAt}|${JSON.stringify(input)}`;
	if (lagCache?.key === key) return lagCache.v;
	const p = { ...input };
	const thr = p.lagThreshold / 100;
	const train = 7;
	const k = Math.max(1, p.k - (p.years - train));
	const liquid = u.stocks.filter((s) => {
		const l = liquidity(s, u.lastMonth, u.usdIls);
		return l.turnoverUsd >= p.minTurnoverUsd && l.priceUsd >= p.minPriceUsd;
	});
	const first = Math.floor(Math.min(...liquid.map((s) => s.start)) / 12);
	type Obs = { m12: number; m3: number; b3: number };
	const real: Obs[] = [];
	const draws: { pool: Obs[]; count: number }[] = [];
	for (let q = 1; q <= 4; q++) {
		let y = Math.floor(u.lastMonth / 12);
		while (quarterEnd(y, q) > u.lastMonth) y--;
		for (; y >= first + train + 1; y--) {
			const yrs = Array.from({ length: train + 1 }, (_, i) => y - train + i);
			const rows: Row[] = [];
			for (const s of liquid) {
				const r = yrs.map((x) => quarterReturn(s, x, q));
				if (r.every((x) => Number.isFinite(x))) rows.push({ s, r, turnoverUsd: 0, priceUsd: 0 });
			}
			if (rows.length < 50) break;
			const obs = (s: Series): Obs | null => {
				const [m1, m2, m3] = monthReturns(s, y, q);
				const b = u.bench[s.market];
				const b3 = b ? monthReturns(b, y, q)[2] : NaN;
				return [m1, m2, m3, b3].every((v) => Number.isFinite(v)) ? { m12: (1 + m1) * (1 + m2) - 1, m3, b3 } : null;
			};
			const pool = rows.map((r) => obs(r.s)).filter((x): x is Obs => !!x);
			for (const variant of ['A', 'B'] as const) {
				const ms = measures(u, rows, yrs, q, variant, 'market');
				const list = rows
					.map((row, i) => ({ s: row.s, m: ms[i].slice(0, train), score: scoreOf(ms[i].slice(0, train), p.sort) }))
					.filter((x) => x.m.filter((v) => v > 0).length >= k);
				const { chosen } = pick(list, p);
				let c = 0;
				for (const x of chosen) {
					const o = obs(x.s);
					if (o) (real.push(o), c++);
				}
				if (c) draws.push({ pool, count: c });
			}
		}
	}
	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
	const r = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 100 : null);
	const lag = real.filter((o) => o.m12 <= thr);
	const lagEx = mean(lag.map((o) => o.m3 - o.b3));
	const mx = mean(real.map((o) => o.m12));
	const my = mean(real.map((o) => o.m3));
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (const o of real) {
		sxy += (o.m12 - mx) * (o.m3 - my);
		sxx += (o.m12 - mx) ** 2;
		syy += (o.m3 - my) ** 2;
	}
	const rand = rng(424_242 + Math.round(thr * 1000));
	let ge = 0;
	let sum = 0;
	let counted = 0;
	for (let run = 0; run < runs; run++) {
		const picked: Obs[] = [];
		for (const d of draws) for (let j = 0; j < d.count; j++) picked.push(d.pool[Math.floor(rand() * d.pool.length)]);
		const l = picked.filter((o) => o.m12 <= thr);
		const e = mean(l.map((o) => o.m3 - o.b3));
		if (!Number.isFinite(e)) continue;
		counted++;
		sum += e;
		if (e >= lagEx) ge++;
	}
	const share = counted ? ge / counted : 1;
	const v: Laggards = {
		n: real.length,
		corr: sxx > 0 && syy > 0 ? Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100 : null,
		all: { mean3: r(my), up3: real.length ? Math.round((real.filter((o) => o.m3 > 0).length / real.length) * 100) : null, excess3: r(mean(real.map((o) => o.m3 - o.b3))) },
		lag: { n: lag.length, mean3: r(mean(lag.map((o) => o.m3))), up3: lag.length ? Math.round((lag.filter((o) => o.m3 > 0).length / lag.length) * 100) : null, excess3: r(lagEx) },
		placebo: { runs: counted, mean: counted ? r(sum / counted) : null, share },
		verdict: lag.length < 20 ? 'unclear' : lagEx > 0 && share < 0.05 ? 'catch_up' : lagEx <= 0 || share > 0.25 ? 'no' : 'unclear',
		threshold: p.lagThreshold
	};
	lagCache = { key, v };
	return v;
}
