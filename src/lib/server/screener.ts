import type Database from 'better-sqlite3';
import { liquidity, universe, type Series } from './model/quarterly.js';
import { scoreMap } from './tickerSort.js';

/**
 * Owner 28.11.2026: a full screener — the shares of both markets filtered by any of their aspects (size, valuation,
 * dividends, growth, quality, risk, return, liquidity, the quant score and the trend), sorted by any column, a page
 * at a time. The cheap filters go first; the quant score (costly: the trend needs 200 daily closes) only for what is
 * left, and only when a filter or the order asks for it.
 */
export interface Range {
	min?: number | null;
	max?: number | null;
}
export interface Filters {
	market?: 'US' | 'IL' | null;
	sector?: string | null;
	industry?: string | null;
	/** the size classes: micro < 300M, small < 2B, mid < 10B, large < 200B, mega */
	caps?: ('micro' | 'small' | 'mid' | 'large' | 'mega')[];
	colors?: ('green' | 'yellow' | 'red')[];
	trendUp?: boolean;
	/** the average daily turnover, dollars, at least */
	turnover?: number | null;
	pe?: Range;
	ps?: Range;
	div?: Range;
	growth?: Range;
	roe?: Range;
	margin?: Range;
	debt?: Range;
	beta?: Range;
	y1?: Range;
	m3?: Range;
}
export const COLUMNS = ['symbol', 'cap', 'score', 'pe', 'ps', 'div', 'growth', 'roe', 'beta', 'y1', 'm3', 'turnover'] as const;
export type Column = (typeof COLUMNS)[number];

const CAP: Record<string, [number, number]> = { micro: [0, 3e8], small: [3e8, 2e9], mid: [2e9, 1e10], large: [1e10, 2e11], mega: [2e11, Infinity] };

export interface Row {
	id: number;
	symbol: string;
	name: string;
	exchange: string;
	market: 'US' | 'IL';
	sector: string | null;
	industry: string | null;
	cap: number | null;
	pe: number | null;
	ps: number | null;
	div: number | null;
	growth: number | null;
	roe: number | null;
	margin: number | null;
	debt: number | null;
	beta: number | null;
	y1: number | null;
	m3: number | null;
	turnover: number | null;
	score: number | null;
	color: string | null;
	above: boolean | null;
}

const back = (s: Series | undefined, last: number, n: number) => {
	if (!s) return null;
	const at = (i: number) => {
		const j = i - s.start;
		return j >= 0 && j < s.adj.length && s.adj[j] > 0 ? s.adj[j] : NaN;
	};
	const x = at(last) / at(last - n) - 1;
	return Number.isFinite(x) ? Math.round(x * 1000) / 10 : null;
};
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const inRange = (v: number | null, r?: Range) => {
	if (!r || (r.min == null && r.max == null)) return true;
	if (v === null) return false;
	return (r.min == null || v >= r.min) && (r.max == null || v <= r.max);
};

export function screen(market: Database.Database, f: Filters, sort: { by: Column; desc: boolean } = { by: 'cap', desc: true }, page = { offset: 0, limit: 50 }) {
	const t0 = Date.now();
	const rows = market
		.prepare(
			`select s.id, s.symbol, s.name_en as name, s.exchange_code as exchange, e.country as market, p.sector, p.industry,
			        case p.cap_currency when 'ILS' then p.market_cap / 3.7 when 'ILA' then p.market_cap / 370 else p.market_cap end as cap, st.data
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code
			   left join ref_security_profiles p on p.security_id = s.id
			   left join ref_security_stats st on st.security_id = s.id
			  where s.active = 1 and s.type = 'stock' and s.manual = 0 and e.country in ('US', 'IL')
			    ${f.market ? 'and e.country = ?' : ''} ${f.sector ? 'and p.sector = ?' : ''} ${f.industry ? 'and p.industry = ?' : ''}`
		)
		.all(...[f.market, f.sector, f.industry].filter(Boolean)) as { id: number; symbol: string; name: string; exchange: string; market: 'US' | 'IL'; sector: string | null; industry: string | null; cap: number | null; data: string | null }[];
	const u = universe(market);
	const byId = new Map(u.stocks.map((s) => [s.id, s]));
	let list: Row[] = [];
	for (const r of rows) {
		if (f.caps?.length && !f.caps.some((c) => r.cap !== null && r.cap >= CAP[c][0] && r.cap < CAP[c][1])) continue;
		let d: Record<string, unknown> = {};
		try {
			// a load the provider answered with nothing is kept as «null»
			d = (r.data ? JSON.parse(r.data) : null) ?? {};
		} catch {
			d = {};
		}
		const s = byId.get(r.id);
		const pe = num(d.pe);
		const ps = num(d.ps);
		const row: Row = {
			id: r.id,
			symbol: r.symbol,
			name: r.name,
			exchange: r.exchange,
			market: r.market,
			sector: r.sector,
			industry: r.industry,
			cap: r.cap,
			pe: pe !== null && pe >= 1 ? pe : null,
			ps: ps !== null && ps > 0 ? ps : null,
			div: num(d.dividendYield) === null ? null : (d.dividendYield as number) * 100,
			growth: num(d.revenueGrowth) === null ? null : (d.revenueGrowth as number) * 100,
			roe: num(d.roe) === null ? null : (d.roe as number) * 100,
			margin: num(d.profitMargin) === null ? null : (d.profitMargin as number) * 100,
			debt: num(d.debtToEquity),
			beta: num(d.beta),
			y1: back(s, u.lastMonth, 12),
			m3: back(s, u.lastMonth, 3),
			turnover: s ? liquidity(s, u.lastMonth, u.usdIls).turnoverUsd : null,
			score: null,
			color: null,
			above: null
		};
		if (!inRange(row.pe, f.pe) || !inRange(row.ps, f.ps) || !inRange(row.div, f.div) || !inRange(row.growth, f.growth) || !inRange(row.roe, f.roe)) continue;
		if (!inRange(row.margin, f.margin) || !inRange(row.debt, f.debt) || !inRange(row.beta, f.beta) || !inRange(row.y1, f.y1) || !inRange(row.m3, f.m3)) continue;
		if (f.turnover && !(row.turnover !== null && row.turnover >= f.turnover)) continue;
		list.push(row);
	}
	// the quant score and the trend — for what is left, when asked
	if (f.colors?.length || f.trendUp || sort.by === 'score') {
		const m = scoreMap(market, list.map((r) => r.id));
		for (const r of list) {
			const x = m.get(r.id);
			if (x) ((r.score = x.v), (r.color = x.color), (r.above = x.above));
		}
		if (f.colors?.length) list = list.filter((r) => r.color !== null && f.colors!.includes(r.color as 'green'));
		if (f.trendUp) list = list.filter((r) => r.above === true);
	}
	const key = sort.by;
	list.sort((a, b) => {
		if (key === 'symbol') return sort.desc ? b.symbol.localeCompare(a.symbol) : a.symbol.localeCompare(b.symbol);
		const x = a[key] as number | null;
		const y = b[key] as number | null;
		if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
		return sort.desc ? y - x : x - y;
	});
	return { total: list.length, ms: Date.now() - t0, items: list.slice(page.offset, page.offset + page.limit) };
}

/** what the screener's form may hold — anything else is dropped */
export function cleanFilters(x: unknown): Filters {
	const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
	const range = (v: unknown): Range | undefined => {
		const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
		const n = (y: unknown) => (y === '' || y === null || y === undefined || !Number.isFinite(Number(y)) ? null : Number(y));
		const out = { min: n(r.min), max: n(r.max) };
		return out.min === null && out.max === null ? undefined : out;
	};
	const list = <T extends string>(v: unknown, ok: readonly T[]) => (Array.isArray(v) ? (v.filter((x) => ok.includes(x)) as T[]) : []);
	return {
		market: o.market === 'US' || o.market === 'IL' ? o.market : null,
		sector: typeof o.sector === 'string' && /^[a-z_]{3,40}$/.test(o.sector) ? o.sector : null,
		industry: typeof o.industry === 'string' && o.industry.length < 120 ? o.industry || null : null,
		caps: list(o.caps, ['micro', 'small', 'mid', 'large', 'mega'] as const),
		colors: list(o.colors, ['green', 'yellow', 'red'] as const),
		trendUp: o.trendUp === true,
		turnover: Number(o.turnover) > 0 ? Number(o.turnover) : null,
		pe: range(o.pe),
		ps: range(o.ps),
		div: range(o.div),
		growth: range(o.growth),
		roe: range(o.roe),
		margin: range(o.margin),
		debt: range(o.debt),
		beta: range(o.beta),
		y1: range(o.y1),
		m3: range(o.m3)
	};
}
