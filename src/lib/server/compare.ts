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
const US_SECTOR: Record<string, string> = {
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
const US_INDUSTRY: [RegExp, string][] = [
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
const IL_SECTOR: Record<string, string> = {
	technology: 'KSM.F244',
	financial_services: 'KSM.F57',
	realestate: 'KSM.F56',
	energy: 'KSM.F103',
	industrials: 'KSM.F206'
};
const IL_INDUSTRY: [RegExp, string][] = [[/^Insurance/, 'KSM.F34']];

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

function find(market: Database.Database, symbol: string) {
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
	const symbols = [...Object.values(US_SECTOR), ...US_INDUSTRY.map((x) => x[1]), ...Object.values(IL_SECTOR), ...IL_INDUSTRY.map((x) => x[1]), 'QQQ', 'IWM', 'KSM.F59', 'KSM.F72', 'KSM.F55'];
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
	return {
		periods: PERIOD_DAYS.map((x) => x[0]),
		security: ret(id),
		refs: [...refs, ...(bench ? [{ role: 'index' as const, label: bench.symbol === 'SPX' ? 'S&P 500' : 'ТА-125', ...bench }] : [])].map((r) => ({ ...r, returns: ret(r.id), loaded: !!last.get(r.id) }))
	};
}
