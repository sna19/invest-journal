import type Database from 'better-sqlite3';

/**
 * The quarterly model, sub-stage 10a (spec section 21, T-009). For a calendar quarter: each share's price change
 * inside that quarter in each of the last N years (default 10) — from the close of the month before the quarter
 * to the close of its last month, on dividend- and split-adjusted monthly prices. Variant A «Рост цены» (the
 * owner's scheme) counts the change itself; variant B «Против рынка» counts it over the market's (S&P 500 or
 * TA-125) or over the average of the share's sector. Shares that rose (beat) in at least K of the N years pass,
 * are sorted by the mean (median, worst year) and give 10 candidates with at most 2 per sector and 7 per market.
 */

export type Variant = 'A' | 'B';

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
}

export const DEFAULTS: Params = {
	years: 10,
	k: 9,
	count: 10,
	perSector: 2,
	perMarket: 7,
	minTurnoverUsd: 1_000_000,
	minPriceUsd: 5,
	sort: 'mean',
	compareWith: 'market'
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
	sector: string | null;
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

/** reads all monthly prices once into compact arrays (about 10 MB for 6 500 shares × 15 years) */
export function loadUniverse(market: Database.Database): Universe {
	const meta = market
		.prepare(
			`select s.id, s.symbol, s.name_en as name, e.country, s.price_unit as unit, s.type, s.is_benchmark as bench, p.sector
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code
			   left join ref_security_profiles p on p.security_id = s.id
			  where s.id in (select security_id from ops_monthly_loads where status = 'ok')`
		)
		.all() as { id: number; symbol: string; name: string; country: string; unit: string; type: string; bench: number; sector: string | null }[];
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
		return { id: m.id, symbol: m.symbol, name: m.name, market: m.country === 'IL' ? 'IL' : 'US', sector: m.sector, unit: m.unit, start, adj, close, volume };
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
		} else if (m.type === 'stock') stocks.push(s);
	}
	const fx = market.prepare(`select rate from market_fx_daily where pair = 'USD/ILS' order by date desc limit 1`).get() as { rate: number } | undefined;
	return { stocks, bench: { US, IL }, lastMonth: last, usdIls: fx?.rate ?? 3.7, builtAt: new Date().toISOString() };
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
	passed: number;
	/** how many would pass by chance: N × P(Binomial(years, p) ≥ K) */
	expected: number;
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
	const ms = measures(u, rows, years, quarter, variant, p.compareWith);
	let ups = 0;
	let all = 0;
	const passed: { s: Series; score: number; m: number[]; row: Row }[] = [];
	rows.forEach((row, i) => {
		const m = ms[i];
		const up = m.filter((x) => x > 0).length;
		ups += up;
		all += m.length;
		if (up >= p.k) passed.push({ s: row.s, score: scoreOf(m, p.sort), m, row });
	});
	const prob = all ? ups / all : 0;
	const { chosen, capped } = pick(passed, p);
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
		universe: rows.length,
		noHistory,
		illiquid,
		passed: passed.length,
		expected: Math.round(rows.length * binomTail(p.years, p.k, prob) * 10) / 10,
		p: Math.round(prob * 1000) / 1000,
		candidates: chosen.map((x) => ({
			id: x.s.id,
			symbol: x.s.symbol,
			name: x.s.name,
			market: x.s.market,
			sector: x.s.sector,
			results: x.m.map(pct),
			up: x.m.filter((v) => v > 0).length,
			mean: pct(x.m.reduce((a, b) => a + b, 0) / x.m.length),
			median: pct(median(x.m)),
			worst: pct(Math.min(...x.m)),
			turnoverUsd: Math.round(x.row.turnoverUsd),
			priceUsd: Math.round(x.row.priceUsd * 100) / 100
		})),
		capped,
		bench: { US: bench('US'), IL: bench('IL') },
		walk: walkForward(rows, ms, years, p),
		dataMonth: monthName(u.lastMonth)
	};
}

/**
 * The check without peeking: for each of the last three years of the window, candidates are chosen on the 7
 * years before it (K lowered by as many years as are dropped) and measured in that year, which the choice did
 * not see. Only for reference: shares that vanished in 10 years are not in the base.
 */
function walkForward(rows: Row[], ms: number[][], years: number[], p: Params): Walk[] {
	const train = 7;
	if (years.length < train + 1) return [];
	const k = Math.max(1, p.k - (p.years - train));
	const out: Walk[] = [];
	for (let t = Math.max(train, years.length - 3); t < years.length; t++) {
		const list = rows
			.map((row, i) => {
				const m = ms[i].slice(t - train, t);
				return { s: row.s, m, score: scoreOf(m, p.sort), test: ms[i][t] };
			})
			.filter((x) => x.m.filter((v) => v > 0).length >= k);
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

// ── a cached universe ───────────────────────────────────────────────────────────

let cached: Universe | null = null;
let cachedKey = '';

/** the universe, rebuilt when the monthly data or the sectors changed (a cheap check on every request) */
export function universe(market: Database.Database): Universe {
	const k = market.prepare(`select (select max(fetched_at) from ops_monthly_loads) || '|' || (select count(*) from ref_security_profiles where sector is not null) as k`).get() as { k: string | null };
	const key = k.k ?? '';
	if (!cached || key !== cachedKey) {
		cached = loadUniverse(market);
		cachedKey = key;
	}
	return cached;
}

/** the next calendar quarter after `now` (Israel time): in November 2026 — Q1 2027 */
export function nextQuarter(now = new Date()) {
	const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number);
	const q = Math.floor((m - 1) / 3) + 1;
	return q === 4 ? { year: y + 1, quarter: 1 } : { year: y, quarter: q + 1 };
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
