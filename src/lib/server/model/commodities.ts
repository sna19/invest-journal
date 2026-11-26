import type Database from 'better-sqlite3';
import { getSetting, setSetting } from '../risk.js';
import { loadMonthly, type MonthlySec } from '../market/monthly.js';
import { makeFetcher } from '../market/http.js';
import { dropUniverse, type Series, type Universe } from './quarterly.js';

/**
 * T-031 — the quarterly model on commodity funds (owner, 20.11.2026: «это commodities? Я бы тоже с ними работал»).
 * A commodity's season often has an economic reason (heating, the driving season, the harvest), so it is checked
 * apart from the shares, on the funds that can be bought. The list is editable; a fund with leverage or a short one
 * is shown but left out (its price melts whatever the season); funds of the same thing (GLD and IAU) count as one
 * for the choice; the market of variant B is a broad commodity fund (DBC).
 */

export type Group = 'precious' | 'energy' | 'industrial' | 'agriculture' | 'broad';
export const GROUPS: Group[] = ['precious', 'energy', 'industrial', 'agriculture', 'broad'];
export interface Fund {
	symbol: string;
	group: Group;
	/** the same thing as another fund: one of them is chosen */
	twin?: string;
}

export const DEFAULT_FUNDS: Fund[] = [
	{ symbol: 'GLD', group: 'precious', twin: 'gold' },
	{ symbol: 'IAU', group: 'precious', twin: 'gold' },
	{ symbol: 'SLV', group: 'precious' },
	{ symbol: 'PPLT', group: 'precious' },
	{ symbol: 'PALL', group: 'precious' },
	{ symbol: 'USO', group: 'energy' },
	{ symbol: 'BNO', group: 'energy' },
	{ symbol: 'UNG', group: 'energy' },
	{ symbol: 'UGA', group: 'energy' },
	{ symbol: 'CPER', group: 'industrial' },
	{ symbol: 'DBB', group: 'industrial' },
	{ symbol: 'DBA', group: 'agriculture' },
	{ symbol: 'CORN', group: 'agriculture' },
	{ symbol: 'WEAT', group: 'agriculture' },
	{ symbol: 'SOYB', group: 'agriculture' },
	{ symbol: 'CANE', group: 'agriculture' },
	{ symbol: 'DBC', group: 'broad' },
	{ symbol: 'GSG', group: 'broad' },
	{ symbol: 'PDBC', group: 'broad' },
	// shown with the mark «исключён: плечо»
	{ symbol: 'DGP', group: 'precious' },
	{ symbol: 'AGQ', group: 'precious' },
	{ symbol: 'UCO', group: 'energy' },
	{ symbol: 'SCO', group: 'energy' }
];
/** funds with leverage or short: their price melts over time whatever the season */
const LEVERED = new Set(['DGP', 'AGQ', 'UCO', 'SCO', 'ZSL', 'GLL', 'DZZ', 'BOIL', 'KOLD', 'UGL', 'NUGT', 'DUST', 'JNUG', 'JDST', 'DRIP', 'GUSH', 'SDOW', 'UGAZ', 'DGAZ', 'USLV', 'DSLV']);
export const isLevered = (symbol: string, name = '') => LEVERED.has(symbol) || /\b(2x|3x|-1x|-2x|-3x|ultra|ultrashort|short|inverse|bear|bull|leveraged|daily)\b/i.test(name);

export const DEFAULT_BENCH = 'DBC';

export function readFunds(app: Database.Database): { funds: Fund[]; bench: string } {
	const raw = getSetting(app, 'commodities');
	if (!raw) return { funds: DEFAULT_FUNDS, bench: DEFAULT_BENCH };
	const j = JSON.parse(raw) as { funds?: Fund[]; bench?: string };
	return { funds: Array.isArray(j.funds) ? j.funds : DEFAULT_FUNDS, bench: typeof j.bench === 'string' ? j.bench : DEFAULT_BENCH };
}
export function writeFunds(app: Database.Database, input: { funds?: unknown; bench?: unknown }) {
	const cur = readFunds(app);
	const funds = Array.isArray(input.funds)
		? (input.funds as Record<string, unknown>[])
				.map((f) => ({ symbol: String(f.symbol ?? '').trim().toUpperCase(), group: GROUPS.includes(f.group as Group) ? (f.group as Group) : 'broad', twin: typeof f.twin === 'string' && f.twin.trim() ? f.twin.trim().toLowerCase() : undefined }))
				.filter((f) => /^[A-Z.]{1,8}$/.test(f.symbol))
				.filter((f, i, a) => a.findIndex((x) => x.symbol === f.symbol) === i)
				.slice(0, 80)
		: cur.funds;
	const bench = typeof input.bench === 'string' && /^[A-Z.]{1,8}$/.test(input.bench.trim().toUpperCase()) ? input.bench.trim().toUpperCase() : cur.bench;
	setSetting(app, 'commodities', JSON.stringify({ funds, bench }));
	return { funds, bench };
}

const US = ['NYSE', 'NASDAQ', 'NYSE_AMERICAN', 'NYSE_ARCA', 'CBOE_BZX'];
/** the funds of the list in the securities' directory: US listings, with their Yahoo symbol and name */
export function fundIds(market: Database.Database, symbols: string[]) {
	const q = market.prepare(`select s.id, s.symbol, s.name_en as name, p.provider_symbol as yahoo from ref_securities s join ref_provider_symbols p on p.security_id = s.id and p.provider_code = 'yahoo'
		where s.symbol = ? and s.active = 1 and s.exchange_code in (${US.map(() => '?').join(',')}) order by s.id limit 1`);
	return symbols.map((s) => q.get(s, ...US) as (MonthlySec & { name: string }) | undefined).filter((x): x is MonthlySec & { name: string } => !!x);
}

/** the symbols every user's commodity list needs — for the nightly monthly load */
export function commoditySymbols(app: Database.Database) {
	const { funds, bench } = readFunds(app);
	return [...new Set([...funds.map((f) => f.symbol), bench])];
}

let loading: Promise<unknown> | null = null;
/** the funds without monthly prices are loaded now, in the background (the screen says so meanwhile) */
export function ensureFunds(market: Database.Database, symbols: string[]) {
	const ids = fundIds(market, symbols);
	const have = new Set((market.prepare(`select security_id as id from ops_monthly_loads where status = 'ok'`).all() as { id: number }[]).map((r) => r.id));
	const missing = ids.filter((x) => !have.has(x.id));
	if (missing.length && !loading)
		loading = loadMonthly(market, missing, makeFetcher({ retries: 1 }), { pause: 300 })
			// the new funds are in the universe at once, not after the half-hour cache
			.then(() => dropUniverse())
			.catch((e) => console.error(`commodities: ${e}`))
			.finally(() => (loading = null));
	return { missing: missing.map((x) => x.symbol), loading: !!loading, promise: loading };
}

export interface FundRow {
	symbol: string;
	name: string | null;
	group: Group;
	twin: string | null;
	years: number | null;
	firstMonth: string | null;
	/** why it is out of the choice: leverage, not in the directory, no monthly prices yet, too short a history */
	excluded: 'levered' | 'unknown' | 'no_prices' | 'short' | null;
}

/**
 * The commodities' universe: the funds of the list with monthly prices, the group as the «sector» (the cap «не более
 * 2 из сектора» works by groups), the twins marked, the broad fund as the market; the leveraged and short funds out.
 */
export function commodityUniverse(u: Universe, market: Database.Database, list: Fund[], bench: string, minYears: number): { u: Universe; rows: FundRow[] } {
	const names = new Map(fundIds(market, list.map((f) => f.symbol)).map((x) => [x.symbol, x.name]));
	const rows: FundRow[] = [];
	const stocks: Series[] = [];
	const need = u.lastMonth - 12 * minYears - 3;
	for (const f of list) {
		const s = u.funds.get(f.symbol);
		const name = names.get(f.symbol) ?? s?.name ?? null;
		const years = s ? Math.floor(((u.lastMonth - s.start + 1) / 12) * 10) / 10 : null;
		const first = s ? `${Math.floor(s.start / 12)}-${String((s.start % 12) + 1).padStart(2, '0')}` : null;
		const excluded = isLevered(f.symbol, name ?? '') ? 'levered' : !names.has(f.symbol) && !s ? 'unknown' : !s ? 'no_prices' : s.start > need ? 'short' : null;
		rows.push({ symbol: f.symbol, name, group: f.group, twin: f.twin ?? null, years, firstMonth: first, excluded });
		if (!excluded && s) stocks.push({ ...s, sector: f.group, capUsd: null, shares: null, twin: f.twin, events: undefined });
	}
	const b = u.funds.get(bench) ?? null;
	return { u: { ...u, stocks, bench: { US: b, IL: null } }, rows };
}
