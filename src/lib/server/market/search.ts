import type Database from 'better-sqlite3';

/** Spec section 4 — the ticker field: symbol, English and Hebrew name, from the second character, local base only. */

export type Market = 'us' | 'il' | 'all';

/** the «Тикеры» screen's filter (owner's request 20.11.2026): stocks, ETFs or commodities — each without the others */
export type Kind = 'stock' | 'etf' | 'commodity';

const COMMODITY = /\b(gold|silver|platinum|palladium|precious metals?|crude|oil|brent|wti|natural gas|commodit(y|ies)|copper|agricultur\w*|grains?|wheat|corn|soybeans?|sugar|coffee|cocoa|cotton|livestock|base metals?)\b/i;
const NOT_COMMODITY = /\boil\s*(&|and)\s*gas\b|\brefiner|\bbig oil\b|\b(drinks|power|turbines|infrastructure|electrification|industry|depositary|royality|miners?|mining|producers?|explor\w*|royalt\w*|equit(y|ies)|stocks?|compan(y|ies)|services|equipment|corp(oration)?|inc|ltd)\b/i;
const FUND_WORD = /\b(etf|etn|etc|etp|trust|fund|shares|ishares|spdr|invesco|proshares|direxion|ipath)\b/i;
const COMMODITY_HE = /זהב|נפט|סחורות|כסף פיזי|גז טבעי/;

/**
 * A commodity fund: an ETF (or an ETN listed as a share) on gold, oil, grains… — not the miners. By the Yahoo fund
 * category where there is one, else by the name (English or Hebrew).
 */
export function isCommodity(type: string, nameEn: string, nameHe: string | null, category: string | null): boolean {
	if (type === 'index') return false;
	if (category) return /^commodit/i.test(category);
	if (type !== 'etf' && !FUND_WORD.test(nameEn)) return false;
	if (NOT_COMMODITY.test(nameEn)) return false;
	return COMMODITY.test(nameEn) || (!!nameHe && COMMODITY_HE.test(nameHe));
}

const registered = new WeakSet<Database.Database>();
function withFunctions(sqlite: Database.Database) {
	if (registered.has(sqlite)) return;
	sqlite.function('is_commodity', { deterministic: true }, (t: unknown, en: unknown, he: unknown, cat: unknown) =>
		isCommodity(String(t), String(en ?? ''), (he as string | null) ?? null, (cat as string | null) ?? null) ? 1 : 0
	);
	registered.add(sqlite);
}

export interface SecurityHit {
	id: number;
	symbol: string;
	nameEn: string;
	nameHe: string | null;
	exchangeCode: string;
	exchangeName: string;
	type: string;
	currency: string;
	priceUnit: string;
	active: boolean;
	/** from the Yahoo profile, where loaded */
	sector: string | null;
	/** the market cap in dollars (TASE's in shekels at 3.7) — the order of the list without a query */
	capUsd: number | null;
}

export const MIN_QUERY = 2;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

const statements = new WeakMap<Database.Database, Map<string, Database.Statement>>();

function prepare(sqlite: Database.Database, key: string, sql: string) {
	let m = statements.get(sqlite);
	if (!m) statements.set(sqlite, (m = new Map()));
	let st = m.get(key);
	if (!st) m.set(key, (st = sqlite.prepare(sql)));
	return st;
}

/**
 * Order: exact symbol, symbol start, the name starts with the query, a word of the name does, anywhere.
 * Inside a rank: stocks before ETFs (T-004), shorter symbols first (TEVA before TEVA.F1), then by symbol.
 */
export function searchSecurities(
	sqlite: Database.Database,
	q: string,
	opts: { market?: Market; includeInactive?: boolean; noIndex?: boolean; limit?: number; offset?: number; withManual?: boolean; kind?: Kind; sector?: string } = {}
): SecurityHit[] {
	const query = q.trim().toLowerCase();
	// with a filter the list is shown without a query too: browsing by kind or sector
	const browse = query.length < MIN_QUERY && !!(opts.kind || opts.sector);
	if (query.length < MIN_QUERY && !browse) return [];
	withFunctions(sqlite);
	const market = opts.market ?? 'all';
	const commodity = `is_commodity(s.type, s.name_en, s.name_he, p.fund_category)`;
	const where = [
		browse ? '1 = 1' : "s.search like ? escape '\\'",
		opts.includeInactive && !browse ? '1 = 1' : 's.active = 1',
		market === 'us' ? "e.country = 'US'" : market === 'il' ? "e.country = 'IL'" : '1 = 1',
		opts.noIndex || opts.kind ? "s.type <> 'index'" : '1 = 1',
		// securities added by hand for a portfolio (ETF UCITS) are found only where a portfolio asks
		opts.withManual ? '1 = 1' : 's.manual = 0',
		opts.kind === 'commodity' ? `${commodity} = 1` : opts.kind ? `s.type = '${opts.kind}' and ${commodity} = 0` : '1 = 1',
		opts.sector ? 'p.sector = ?' : '1 = 1'
	].join(' and ');
	const cap = `case p.cap_currency when 'ILS' then p.market_cap / 3.7 when 'ILA' then p.market_cap / 3.7 else p.market_cap end`;
	const order = browse
		? `${cap} is null, ${cap} desc, s.symbol`
		: `case
		             when lower(s.symbol) = ? then 0
		             when lower(s.symbol) like ? escape '\\' then 1
		             when lower(s.name_en) like ? escape '\\' or s.name_he like ? escape '\\' then 2
		             when s.search like ? escape '\\' then 3
		             else 4
		           end,
		           s.active desc, case s.type when 'stock' then 0 when 'etf' then 1 else 2 end, length(s.symbol), s.symbol`;
	const st = prepare(
		sqlite,
		`search:${market}:${!!opts.includeInactive}:${!!opts.noIndex}:${!!opts.withManual}:${opts.kind ?? ''}:${!!opts.sector}:${browse}`,
		`select s.id, s.symbol, s.name_en as nameEn, s.name_he as nameHe, s.exchange_code as exchangeCode,
		        e.name as exchangeName, s.type, s.currency, s.price_unit as priceUnit, s.active, p.sector, ${cap} as capUsd
		   from ref_securities s join ref_exchanges e on e.code = s.exchange_code
		   left join ref_security_profiles p on p.security_id = s.id
		  where ${where}
		  order by ${order}
		  limit ? offset ?`
	);
	const like = escapeLike(query);
	const sector = opts.sector ? [opts.sector] : [];
	const args = browse ? [...sector] : [`%${like}%`, ...sector, query, `${like}%`, `${like}%`, `${like}%`, `% ${like}%`];
	const rows = st.all(...args, opts.limit ?? 20, opts.offset ?? 0) as (Omit<SecurityHit, 'active'> & { active: number })[];
	return rows.map((r) => ({ ...r, active: !!r.active }));
}

/** one security as the ticker field shows it — for a form opened with the security already chosen */
export function securityHit(sqlite: Database.Database, id: number): SecurityHit | null {
	const r = sqlite
		.prepare(
			`select s.id, s.symbol, s.name_en as nameEn, s.name_he as nameHe, s.exchange_code as exchangeCode, e.name as exchangeName, s.type, s.currency,
			        s.price_unit as priceUnit, s.active, p.sector, null as capUsd
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code left join ref_security_profiles p on p.security_id = s.id where s.id = ?`
		)
		.get(id) as (Omit<SecurityHit, 'active'> & { active: number }) | undefined;
	return r ? { ...r, active: !!r.active } : null;
}

/** Counts for the «Тикеры» screen. */
export function tickerStats(sqlite: Database.Database) {
	const byExchange = sqlite
		.prepare(
			`select e.code, e.name, e.country,
			        sum(case when s.active = 1 and s.type = 'stock' then 1 else 0 end) as stocks,
			        sum(case when s.active = 1 and s.type = 'etf' then 1 else 0 end) as etfs,
			        sum(case when s.active = 1 and s.type = 'index' then 1 else 0 end) as indices,
			        sum(case when s.active = 0 then 1 else 0 end) as inactive
			   from ref_exchanges e left join ref_securities s on s.exchange_code = e.code
			  group by e.code order by e.country desc, e.rowid`
		)
		.all() as { code: string; name: string; country: string; stocks: number; etfs: number; indices: number; inactive: number }[];
	const runs = sqlite
		.prepare(
			`select r.* from ops_ingest_runs r
			  where r.job = 'listings' and r.id = (select max(id) from ops_ingest_runs x where x.job = r.job and x.provider_code = r.provider_code)
			  order by r.provider_code`
		)
		.all() as {
		id: number;
		provider_code: string;
		started_at: string;
		finished_at: string | null;
		status: string;
		rows_received: number;
		rows_added: number;
		rows_updated: number;
		error: string | null;
	}[];
	const lastOk = sqlite
		.prepare(`select max(finished_at) as at from ops_ingest_runs where job = 'listings' and status in ('ok', 'suspicious')`)
		.get() as { at: string | null };
	return {
		byExchange,
		runs: runs.map((r) => ({
			provider: r.provider_code,
			startedAt: r.started_at,
			finishedAt: r.finished_at,
			status: r.status,
			received: r.rows_received,
			added: r.rows_added,
			updated: r.rows_updated,
			error: r.error
		})),
		updatedAt: lastOk.at
	};
}
