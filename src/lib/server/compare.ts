import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { splitScale } from './market/splits.js';

/**
 * «С чем сравнить» on a security's card (owner's request 20.11.2026): what the share belongs to — its sector,
 * its industry, its indices — each as a tradable ETF with daily prices, and how the share went against each over
 * 1M, 3M, 1Y and 5Y. The sector and the industry come from the Yahoo profile; an Israeli share is compared with
 * the KSM ETFs on the TASE indices. The reference ETFs are always in the daily price ring (ringRefIds).
 */

/** Yahoo sector key → the SPDR sector ETF */
export const US_SECTOR: Record<string, string> = {
	technology: 'XLK',
	financial_services: 'XLF',
	healthcare: 'XLV',
	consumer_cyclical: 'XLY',
	consumer_defensive: 'XLP',
	energy: 'XLE',
	industrials: 'XLI',
	basic_materials: 'XLB',
	realestate: 'XLRE',
	utilities: 'XLU',
	communication_services: 'XLC'
};

/** Yahoo industry → an ETF of that industry (where one is common) */
export const US_INDUSTRY: [RegExp, string][] = [
	[/^Semiconductor/, 'SOXX'],
	[/^Biotechnology/, 'IBB'],
	[/^Banks - Regional/, 'KRE'],
	[/^Banks/, 'KBE'],
	[/^Software/, 'IGV'],
	[/^Aerospace & Defense/, 'ITA'],
	[/^Drug Manufacturers/, 'XPH'],
	[/^Medical (Devices|Instruments)/, 'IHI'],
	[/^Insurance/, 'KIE'],
	[/^Gold/, 'GDX'],
	[/^Oil & Gas E&P/, 'XOP'],
	[/^Oil & Gas Equipment/, 'OIH'],
	[/^Oil & Gas Refining/, 'CRAK'],
	[/^Steel/, 'SLX'],
	[/^Copper/, 'COPX'],
	[/^Residential Construction/, 'ITB'],
	[/Retail/, 'XRT'],
	[/^Airlines/, 'JETS'],
	[/^Solar/, 'TAN'],
	[/^Uranium/, 'URA'],
	[/^Internet Content/, 'FDN'],
	[/^(Trucking|Railroads|Integrated Freight)/, 'IYT'],
	[/^Capital Markets/, 'IAI'],
	[/^Telecom/, 'IYZ'],
	[/^Auto Manufacturers/, 'CARZ']
];

/** Yahoo sector of an Israeli share → the KSM ETF on that TASE index */
export const IL_SECTOR: Record<string, string> = {
	technology: 'KSM.F244',
	financial_services: 'KSM.F57',
	realestate: 'KSM.F56',
	energy: 'KSM.F103',
	industrials: 'KSM.F206'
};
export const IL_INDUSTRY: [RegExp, string][] = [[/^Insurance/, 'KSM.F34']];

const US_EXCHANGES = ['NYSE', 'NASDAQ', 'NYSE_AMERICAN', 'NYSE_ARCA', 'CBOE_BZX'];

export interface Ref {
	role: 'sector' | 'industry' | 'index';
	/** what it stands for: «Технологии», «Semiconductors», «S&P 500» */
	label: string;
	id: number;
	symbol: string;
	name: string;
	exchange: string;
}

export function find(market: Database.Database, symbol: string) {
	const tase = symbol.startsWith('KSM.');
	return market
		.prepare(
			`select id, symbol, name_en as name, exchange_code as exchange from ref_securities
			  where symbol = ? and active = 1 and ${tase ? `exchange_code = 'TASE'` : `exchange_code in (${US_EXCHANGES.map(() => '?').join(',')})`} order by id limit 1`
		)
		.get(symbol, ...(tase ? [] : US_EXCHANGES)) as { id: number; symbol: string; name: string; exchange: string } | undefined;
}

/** every reference ETF that exists in the base — they are kept in the daily price ring */
export function ringRefIds(market: Database.Database): number[] {
	const symbols = [...Object.values(US_SECTOR), ...US_INDUSTRY.map((x) => x[1]), ...Object.values(IL_SECTOR), ...IL_INDUSTRY.map((x) => x[1]), 'QQQ', 'IWM', 'SPY', 'KSM.F59', 'KSM.F72', 'KSM.F55'];
	return [...new Set(symbols)].map((s) => find(market, s)?.id).filter((x): x is number => !!x);
}

export function compareRefs(market: Database.Database, id: number): Ref[] {
	const s = market
		.prepare(
			`select s.id, s.symbol, s.exchange_code as exchange, s.type, e.country, p.sector, p.industry, p.market_cap as cap
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code
			   left join ref_security_profiles p on p.security_id = s.id where s.id = ?`
		)
		.get(id) as { id: number; symbol: string; exchange: string; type: string; country: string; sector: string | null; industry: string | null; cap: number | null } | undefined;
	if (!s) return [];
	const il = s.country === 'IL';
	const out: Ref[] = [];
	const add = (role: Ref['role'], label: string, symbol: string | undefined) => {
		if (!symbol) return;
		const r = find(market, symbol);
		if (r && r.id !== id && !out.some((x) => x.id === r.id)) out.push({ role, label, ...r });
	};
	if (s.sector) add('sector', s.sector, (il ? IL_SECTOR : US_SECTOR)[s.sector]);
	if (s.industry) add('industry', s.industry, (il ? IL_INDUSTRY : US_INDUSTRY).find(([re]) => re.test(s.industry!))?.[1]);
	// the indices: the market's benchmark is on the card already; the others the share is likely in
	if (il) {
		add('index', 'ТА-35', 'KSM.F59');
		add('index', 'ТА-90', 'KSM.F72');
	} else {
		if (s.exchange === 'NASDAQ') add('index', 'Nasdaq 100', 'QQQ');
		if (s.cap !== null && s.cap < 5e9) add('index', 'Russell 2000', 'IWM');
	}
	return out;
}

const PERIOD_DAYS: [string, number][] = [
	['1M', 30],
	['3M', 91],
	['1Y', 365],
	['5Y', 1826]
];

/** the daily log returns of a security over about the last year, by date (closes in the current split scale) */
export function dailyReturns(market: Database.Database, id: number, days = 380): Map<string, number> {
	const scale = splitScale(market, id);
	const rows = (market.prepare('select date, close from market_prices_daily where security_id = ? order by date desc limit ?').all(id, Math.round((days * 252) / 365) + 1) as { date: string; close: number }[]).reverse();
	const out = new Map<string, number>();
	for (let i = 1; i < rows.length; i++) {
		const a = rows[i - 1].close / scale(rows[i - 1].date);
		const b = rows[i].close / scale(rows[i].date);
		if (a > 0 && b > 0) out.set(rows[i].date, Math.log(b / a));
	}
	return out;
}
const sd = (xs: number[]) => {
	if (xs.length < 2) return null;
	const m = xs.reduce((a, b) => a + b, 0) / xs.length;
	return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Owner 27.11.2026 «как профессионалы оценивают волатильность»: the historical volatility — the standard deviation of
 * the daily returns, a year's worth (× √252), over the last year and the last 3 months; % a year.
 */
export function volatility(market: Database.Database, id: number) {
	const r = [...dailyReturns(market, id).values()];
	const y = r.length >= 60 ? sd(r) : null;
	const q = r.length >= 40 ? sd(r.slice(-63)) : null;
	return { vol1y: y === null ? null : Math.round(y * Math.sqrt(252) * 1000) / 1000, vol3m: q === null ? null : Math.round(q * Math.sqrt(252) * 1000) / 1000 };
}

/** the correlation of two securities' daily returns over their common days of the last year (null — under 60 days) */
export function correlation(a: Map<string, number>, b: Map<string, number>) {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const [d, x] of a) {
		const y = b.get(d);
		if (y !== undefined) (xs.push(x), ys.push(y));
	}
	if (xs.length < 60) return null;
	const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
	const my = ys.reduce((s, v) => s + v, 0) / ys.length;
	let cov = 0;
	let vx = 0;
	let vy = 0;
	for (let i = 0; i < xs.length; i++) {
		cov += (xs[i] - mx) * (ys[i] - my);
		vx += (xs[i] - mx) ** 2;
		vy += (ys[i] - my) ** 2;
	}
	return vx > 0 && vy > 0 ? Math.round((cov / Math.sqrt(vx * vy)) * 100) / 100 : null;
}

/** the table: the share's and each reference's return over 1M, 3M, 1Y, 5Y, by daily closes (split-adjusted) */
export function compareTable(market: Database.Database, id: number, benchId: number | null, today = israelDate()) {
	const refs = compareRefs(market, id);
	const at = market.prepare('select date, close from market_prices_daily where security_id = ? and date <= ? order by date desc limit 1');
	const last = market.prepare('select date, close from market_prices_daily where security_id = ? order by date desc limit 1');
	const ret = (sid: number) => {
		const l = last.get(sid) as { date: string; close: number } | undefined;
		const scale = splitScale(market, sid);
		return Object.fromEntries(
			PERIOD_DAYS.map(([k, days]) => {
				if (!l) return [k, null];
				const from = new Date(Date.parse(l.date + 'T12:00:00Z') - days * 86_400_000).toISOString().slice(0, 10);
				const x = at.get(sid, from) as { date: string; close: number } | undefined;
				return [k, x ? Math.round((l.close / scale(l.date) / (x.close / scale(x.date)) - 1) * 10000) / 100 : null];
			})
		) as Record<string, number | null>;
	};
	const bench = benchId ? market.prepare('select id, symbol, name_en as name, exchange_code as exchange from ref_securities where id = ?').get(benchId) as Omit<Ref, 'role' | 'label'> | undefined : undefined;
	// the correlation with each reference and its volatility (owner 27.11.2026: «сравнивать корреляцию»)
	const mine = dailyReturns(market, id);
	return {
		periods: PERIOD_DAYS.map((x) => x[0]),
		security: ret(id),
		vol: volatility(market, id),
		refs: [...refs, ...(bench ? [{ role: 'index' as const, label: bench.symbol === 'SPX' ? 'S&P 500' : 'ТА-125', ...bench }] : [])].map((r) => ({ ...r, returns: ret(r.id), loaded: !!last.get(r.id), corr: correlation(mine, dailyReturns(market, r.id)), vol: volatility(market, r.id).vol1y }))
	};
}

/**
 * The drawdowns of a series of closes (a year of them): now — the last close under the highest close so far, max — the
 * deepest fall from a running high to a later low. Both ≤ 0, as fractions; null under 60 closes.
 */
export function drawdowns(closes: number[]) {
	if (closes.length < 60) return null;
	let peak = closes[0];
	let max = 0;
	for (const c of closes) {
		if (c > peak) peak = c;
		max = Math.min(max, c / peak - 1);
	}
	const r = (x: number) => Math.round(x * 10000) / 10000;
	return { now: r(closes.at(-1)! / peak - 1), max: r(max) };
}

/**
 * Owner 27.11.2026 («в секторе XLV не вижу акций»): a fund's top holdings with the securities they are in the base (a
 * tap opens the card), and the sector page the fund stands for — an SPDR sector ETF by its symbol, any other fund by a
 * sector of 60% and more of it (and its industry, if one is 50% and more).
 */
export function fundLinks(market: Database.Database, id: number, c: { sectors: Record<string, number> | null; industries: Record<string, number> | null; holdings: { symbol: string; name: string; weight: number }[] | null }) {
	const me = market.prepare('select symbol, exchange_code as x from ref_securities where id = ?').get(id) as { symbol: string; x: string } | undefined;
	const il = me?.x === 'TASE';
	const find = market.prepare(`select id from ref_securities where symbol = ? and type in ('stock', 'etf') order by (exchange_code = 'TASE') ${il ? 'desc' : 'asc'}, id limit 1`);
	const holdings = (c.holdings ?? []).map((h) => ({ ...h, id: ((find.get(h.symbol.replace(/\.TA$/, '')) as { id: number } | undefined)?.id ?? null) }));
	const top = (w: Record<string, number> | null, min: number) => Object.entries(w ?? {}).sort((a, b) => b[1] - a[1]).find(([, x]) => x >= min)?.[0] ?? null;
	const bySymbol = me ? (Object.entries(US_SECTOR).find(([, e]) => e === me.symbol)?.[0] ?? null) : null;
	const sector = bySymbol ?? top(c.sectors, 0.6);
	const industry = sector && !bySymbol ? top(c.industries, 0.5) : null;
	return { holdings, sectorPage: sector ? { sector, industry, country: il ? 'IL' : 'US' } : null };
}

/**
 * Owner 27.11.2026 («сравнивать огурцы с огурцами»): the shares to put on a security's chart beside it — by default the
 * biggest of its own industry on its own market, filled up from its sector; and any security asked for (`extra`).
 * Each with its correlation of daily returns over a year (null while its daily history is not there yet).
 */
export function peersOf(market: Database.Database, id: number, extra: number[] = [], limit = 12) {
	const me = market
		.prepare(
			`select e.country, p.sector, p.industry from ref_securities s join ref_exchanges e on e.code = s.exchange_code
			   left join ref_security_profiles p on p.security_id = s.id where s.id = ?`
		)
		.get(id) as { country: string; sector: string | null; industry: string | null } | undefined;
	const q = (where: string, arg: string, n: number, not: number[]) =>
		market
			.prepare(
				`select s.id, s.symbol, s.name_en as name, s.exchange_code as exchange, p.industry, p.market_cap as cap, p.cap_currency as cur
				   from ref_securities s join ref_exchanges e on e.code = s.exchange_code join ref_security_profiles p on p.security_id = s.id
				  where s.active = 1 and s.type = 'stock' and e.country = ? and ${where} = ? and s.id not in (${[id, ...not].map(() => '?').join(',')})
				  order by p.market_cap is null, p.market_cap desc limit ?`
			)
			.all(me!.country, arg, id, ...not, n) as { id: number; symbol: string; name: string; exchange: string; industry: string | null; cap: number | null; cur: string | null }[];
	let rows: (ReturnType<typeof q>[number] & { same: 'industry' | 'sector' | 'asked' })[] = [];
	if (me?.industry) rows = q('p.industry', me.industry, limit, []).map((r) => ({ ...r, same: 'industry' as const }));
	if (me?.sector && rows.length < limit) rows.push(...q('p.sector', me.sector, limit - rows.length, rows.map((r) => r.id)).map((r) => ({ ...r, same: 'sector' as const })));
	const asked = extra.filter((x) => x !== id && !rows.some((r) => r.id === x));
	if (asked.length)
		rows.push(
			...(market
				.prepare(
					`select s.id, s.symbol, s.name_en as name, s.exchange_code as exchange, p.industry, p.market_cap as cap, p.cap_currency as cur
					   from ref_securities s left join ref_security_profiles p on p.security_id = s.id where s.id in (${asked.map(() => '?').join(',')})`
				)
				.all(...asked) as ReturnType<typeof q>).map((r) => ({ ...r, same: 'asked' as const }))
		);
	const mine = dailyReturns(market, id);
	const hasDaily = market.prepare('select count(*) as n from market_prices_daily where security_id = ?');
	return {
		industry: me?.industry ?? null,
		sector: me?.sector ?? null,
		peers: rows.map((r) => ({
			id: r.id,
			symbol: r.symbol,
			name: r.name,
			exchange: r.exchange,
			industry: r.industry,
			same: r.same,
			corr: correlation(mine, dailyReturns(market, r.id)),
			loaded: (hasDaily.get(r.id) as { n: number }).n >= 60
		}))
	};
}
