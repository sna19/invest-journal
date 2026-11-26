import type Database from 'better-sqlite3';
import { find, IL_INDUSTRY, IL_SECTOR, US_INDUSTRY, US_SECTOR } from './compare.js';
import { quarterReturn, universe, windowYears, type Series } from './model/quarterly.js';

/**
 * A sector or an industry (owner's request 26.11.2026: «нажать на сектор и увидеть его историю и информацию»): its
 * ETF, its companies by market cap with their returns, its industries, and its seasonality by quarter — the
 * equal-weighted mean of its shares over their market, 10 years, as the quarterly model measures it.
 */

export interface Member {
	id: number;
	symbol: string;
	name: string;
	exchange: string;
	market: 'US' | 'IL';
	industry: string | null;
	capUsd: number | null;
	m1: number | null;
	m3: number | null;
	y1: number | null;
}

const US = ['NASDAQ', 'NYSE', 'NYSE_AMERICAN', 'NYSE_ARCA', 'CBOE_BZX'];

/** the return over the last `n` complete months of a monthly series, % */
function back(s: Series | undefined, last: number, n: number): number | null {
	if (!s) return null;
	const at = (i: number) => {
		const j = i - s.start;
		return j >= 0 && j < s.adj.length && s.adj[j] > 0 ? s.adj[j] : NaN;
	};
	const x = at(last) / at(last - n) - 1;
	return Number.isFinite(x) ? Math.round(x * 10000) / 100 : null;
}

export function sectorView(market: Database.Database, opts: { sector?: string | null; industry?: string | null; country?: 'US' | 'IL' | null }) {
	const where = [`s.active = 1`, `s.type = 'stock'`];
	const args: string[] = [];
	if (opts.sector) (where.push('p.sector = ?'), args.push(opts.sector));
	if (opts.industry) (where.push('p.industry = ?'), args.push(opts.industry));
	if (opts.country) (where.push('e.country = ?'), args.push(opts.country));
	const rows = market
		.prepare(
			`select s.id, s.symbol, s.name_en as name, s.exchange_code as exchange, e.country, p.sector, p.industry, p.market_cap as cap, p.cap_currency as cur
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code join ref_security_profiles p on p.security_id = s.id
			  where ${where.join(' and ')}`
		)
		.all(...args) as { id: number; symbol: string; name: string; exchange: string; country: string; sector: string | null; industry: string | null; cap: number | null; cur: string | null }[];
	const u = universe(market);
	const byId = new Map(u.stocks.map((s) => [s.id, s]));
	const usd = (cap: number | null, cur: string | null) => (cap === null ? null : cur === 'ILS' || cur === 'ILA' ? cap / u.usdIls : cap);
	const last = u.lastMonth;
	const members: Member[] = rows
		.map((r) => {
			const s = byId.get(r.id);
			return {
				id: r.id,
				symbol: r.symbol,
				name: r.name,
				exchange: r.exchange,
				market: (r.country === 'IL' ? 'IL' : 'US') as 'US' | 'IL',
				industry: r.industry,
				capUsd: usd(r.cap, r.cur),
				m1: back(s, last, 1),
				m3: back(s, last, 3),
				y1: back(s, last, 12)
			};
		})
		.sort((a, b) => (b.capUsd ?? -1) - (a.capUsd ?? -1));
	const median = (xs: number[]) => {
		const a = [...xs].sort((x, y) => x - y);
		return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null;
	};
	// the industries inside a sector
	const ind = new Map<string, Member[]>();
	if (!opts.industry) for (const m of members) if (m.industry) (ind.get(m.industry) ?? ind.set(m.industry, []).get(m.industry)!).push(m);
	const industries = [...ind]
		.map(([name, list]) => ({ name, count: list.length, capUsd: list.reduce((n, x) => n + (x.capUsd ?? 0), 0), y1: median(list.map((x) => x.y1).filter((x): x is number => x !== null)) }))
		.sort((a, b) => b.capUsd - a.capUsd);
	// the ETF: an industry's where there is one, else the sector's
	const il = opts.country === 'IL';
	const sym = opts.industry
		? ((il ? IL_INDUSTRY : US_INDUSTRY).find(([re]) => re.test(opts.industry!))?.[1] ?? (opts.sector ? (il ? IL_SECTOR : US_SECTOR)[opts.sector] : undefined))
		: opts.sector
			? (il ? IL_SECTOR : US_SECTOR)[opts.sector]
			: undefined;
	const etf = sym ? (find(market, sym) ?? null) : null;
	// seasonality: by quarter, the equal-weighted mean over the market of the shares with 10 years of history
	const seasons = [1, 2, 3, 4].map((q) => {
		const years = windowYears(last, q, 10);
		const series = members.map((m) => byId.get(m.id)).filter((s): s is Series => !!s);
		const per = years.map((y) => {
			const xs = series
				.map((s) => quarterReturn(s, y, q) - (u.bench[s.market] ? quarterReturn(u.bench[s.market]!, y, q) : NaN))
				.filter((v) => Number.isFinite(v));
			return xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
		});
		const ok = per.filter((v) => Number.isFinite(v));
		return { quarter: q, mean: ok.length ? Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 10000) / 100 : null, up: ok.filter((v) => v > 0).length, years: ok.length };
	});
	const withY = members.filter((m) => m.y1 !== null);
	return {
		sector: opts.sector ?? null,
		industry: opts.industry ?? null,
		country: opts.country ?? null,
		count: members.length,
		capUsd: members.reduce((n, x) => n + (x.capUsd ?? 0), 0),
		medianY1: median(withY.map((m) => m.y1!)),
		etf,
		industries,
		members: members.slice(0, 200),
		best: [...withY].sort((a, b) => b.y1! - a.y1!).slice(0, 5),
		worst: [...withY].sort((a, b) => a.y1! - b.y1!).slice(0, 5),
		seasons,
		dataMonth: last
	};
}

/** sectors and industries whose name has the query in it (the ticker search, 26.11.2026) */
export function searchSectors(market: Database.Database, q: string, names: Record<string, [string, string]>) {
	const t = q.trim().toLowerCase();
	if (t.length < 2) return { sectors: [], industries: [] };
	const sectors = Object.entries(names)
		.filter(([k, [ru, en]]) => ru.toLowerCase().includes(t) || en.toLowerCase().includes(t) || k.includes(t))
		.map(([key]) => ({ key }));
	const industries = market
		.prepare(`select industry as name, sector, count(*) as n from ref_security_profiles where industry is not null and lower(industry) like ? group by industry order by n desc limit 8`)
		.all(`%${t.replace(/[%_]/g, '')}%`) as { name: string; sector: string | null; n: number }[];
	return { sectors, industries };
}
void US;
