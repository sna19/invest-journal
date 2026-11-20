import type Database from 'better-sqlite3';

/**
 * ETFs on a share with a daily leverage or against it (owner's request 20.11.2026: «ETF на падение, либо на рост в
 * n раз»). On the share itself — single-stock ETFs (NVDL «2x Long NVDA», NVDD «NVDA Bear 1X»), found by the share's
 * symbol or its company's name in the fund's name; and the leveraged pairs of its industry, sector and index
 * (SOXL/SOXS, TECL/TECS, TQQQ/SQQQ…). The direction and the multiple come from the fund's name.
 */

export interface Lev {
	id: number;
	symbol: string;
	name: string;
	exchange: string;
	dir: 'long' | 'short';
	/** the daily multiple: 2 — twice the move, 1 with «short» — the move reversed */
	x: number;
	level: 'stock' | 'industry' | 'sector' | 'index';
	/** what it follows: the share's symbol, «Semiconductors», «S&P 500» */
	label: string;
}

const NOT_LEVERAGED = /covered call|income|yield|option|buffer|premium|hedged|weeklypay|target outcome/i;

/** from a fund's name: «Direxion Daily NVDA Bull 2X», «GraniteShares 2x Short TSLA», «ProShares UltraShort QQQ» */
export function parseLeverage(name: string): { dir: 'long' | 'short'; x: number } | null {
	if (NOT_LEVERAGED.test(name)) return null;
	const short = /\b(short|bear|inverse)\b|ultrashort|-\s?\d(\.\d+)?\s*x\b/i.test(name);
	const m = /(\d+(?:\.\d+)?)\s*x\b/i.exec(name);
	let x: number | null = m ? Number(m[1]) : null;
	if (x === null && /ultrapro/i.test(name)) x = 3;
	if (x === null && /\bultra(short)?\b/i.test(name)) x = 2;
	if (x === null && short) x = 1;
	if (x === null || !(x > 0) || x > 5) return null;
	return { dir: short ? 'short' : 'long', x };
}

/** the leveraged pairs of an industry (Yahoo industry), a sector and the indices */
const INDUSTRY: [RegExp, string, string[]][] = [
	[/^Semiconductor/, 'Semiconductors', ['SOXL', 'SOXS', 'USD', 'SSG']],
	[/^Biotechnology/, 'Biotechnology', ['LABU', 'LABD']],
	[/^Banks - Regional/, 'Regional banks', ['DPST']],
	[/^Oil & Gas E&P/, 'Oil & Gas E&P', ['GUSH', 'DRIP']],
	[/^Gold/, 'Gold miners', ['NUGT', 'DUST', 'JNUG', 'JDST']],
	[/^Residential Construction/, 'Homebuilders', ['NAIL']],
	[/Retail/, 'Retail', ['RETL']],
	[/^Aerospace & Defense/, 'Aerospace & Defense', ['DFEN']],
	[/^Internet (Content|Retail)/, 'Internet', ['WEBL', 'WEBS']]
];
const SECTOR: Record<string, string[]> = {
	technology: ['TECL', 'TECS', 'ROM', 'REW'],
	financial_services: ['FAS', 'FAZ', 'UYG', 'SKF'],
	healthcare: ['CURE', 'RXL', 'RXD'],
	energy: ['ERX', 'ERY', 'DIG', 'DUG'],
	industrials: ['DUSL', 'UXI', 'SIJ'],
	realestate: ['DRN', 'DRV', 'URE', 'SRS'],
	utilities: ['UTSL', 'UPW', 'SDP'],
	consumer_cyclical: ['WANT', 'UCC', 'SCC'],
	consumer_defensive: ['UGE', 'SZK'],
	basic_materials: ['UYM', 'SMN'],
	communication_services: ['LTL']
};
const SP500 = ['SPXL', 'UPRO', 'SPXS', 'SPXU', 'SSO', 'SDS', 'SH'];
const NDX = ['TQQQ', 'SQQQ', 'QLD', 'QID', 'PSQ'];
const R2K = ['TNA', 'TZA', 'UWM', 'TWM', 'RWM'];

const US = ['NASDAQ', 'NYSE', 'NYSE_AMERICAN', 'NYSE_ARCA', 'CBOE_BZX'];

/** a company's first word that names it alone («NVIDIA», «Tesla»), not a common one */
const COMMON = new Set(
	'the first american united global general national international china bank gold silver oil energy bitcoin ether crypto ultra pro daily long short bull bear inverse new north south west east great royal capital financial group holdings trust fund real health digital advanced applied'.split(' ')
);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let cache: { at: number; rows: { id: number; symbol: string; name: string; exchange: string; lev: { dir: 'long' | 'short'; x: number } }[] } | null = null;
function leveragedFunds(market: Database.Database) {
	if (cache && Date.now() - cache.at < 3600_000) return cache.rows;
	const rows = (
		market
			.prepare(`select id, symbol, name_en as name, exchange_code as exchange from ref_securities where type = 'etf' and active = 1 and exchange_code in (${US.map(() => '?').join(',')})`)
			.all(...US) as { id: number; symbol: string; name: string; exchange: string }[]
	)
		.map((r) => ({ ...r, lev: parseLeverage(r.name) }))
		.filter((r): r is typeof r & { lev: NonNullable<typeof r.lev> } => !!r.lev);
	cache = { at: Date.now(), rows };
	return rows;
}

export function leveragedFor(market: Database.Database, id: number): Lev[] {
	const s = market
		.prepare(
			`select s.id, s.symbol, s.name_en as name, s.type, e.country, s.exchange_code as exchange, p.sector, p.industry, p.market_cap as cap, p.cap_currency as cur
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code left join ref_security_profiles p on p.security_id = s.id where s.id = ?`
		)
		.get(id) as { id: number; symbol: string; name: string; type: string; country: string; exchange: string; sector: string | null; industry: string | null; cap: number | null; cur: string | null } | undefined;
	if (!s || s.type === 'index') return [];
	const funds = leveragedFunds(market);
	const out: Lev[] = [];
	const add = (f: (typeof funds)[number], level: Lev['level'], label: string) => {
		if (f.id !== id && !out.some((x) => x.id === f.id)) out.push({ id: f.id, symbol: f.symbol, name: f.name, exchange: f.exchange, ...f.lev, level, label });
	};
	// on the share itself: its symbol as a word of the fund's name, or its company's own first word
	if (s.type === 'stock') {
		const bySymbol = s.symbol.length >= 2 ? new RegExp(`(^|[^A-Za-z0-9])${esc(s.symbol)}([^A-Za-z0-9]|$)`) : null;
		const word = /^[A-Za-z][A-Za-z-]{3,}/.exec(s.name)?.[0];
		const byName = word && !COMMON.has(word.toLowerCase()) ? new RegExp(`\\b${esc(word)}\\b`, 'i') : null;
		for (const f of funds) if ((bySymbol && bySymbol.test(f.name)) || (byName && byName.test(f.name))) add(f, 'stock', s.symbol);
	}
	// the industry, the sector, the indices — US shares only (there are no leveraged ETFs on TASE indices)
	if (s.country === 'US') {
		const bySym = new Map(funds.map((f) => [f.symbol, f]));
		const put = (list: string[], level: Lev['level'], label: string) => list.forEach((x) => bySym.get(x) && add(bySym.get(x)!, level, label));
		const ind = s.industry ? INDUSTRY.find(([re]) => re.test(s.industry!)) : undefined;
		if (ind) put(ind[2], 'industry', ind[1]);
		if (s.sector && SECTOR[s.sector]) put(SECTOR[s.sector], 'sector', s.sector);
		if (s.exchange === 'NASDAQ') put(NDX, 'index', 'Nasdaq 100');
		if (s.cap !== null && s.cap < 5e9 && s.cur === 'USD') put(R2K, 'index', 'Russell 2000');
		put(SP500, 'index', 'S&P 500');
	}
	return out;
}
