import type Database from 'better-sqlite3';

/** Spec section 4 — the ticker field: symbol, English and Hebrew name, from the second character, local base only. */

export type Market = 'us' | 'il' | 'all';

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
 * Inside a rank: shorter symbols first (TEVA before TEVA.F1), then by symbol.
 */
export function searchSecurities(
	sqlite: Database.Database,
	q: string,
	opts: { market?: Market; includeInactive?: boolean; limit?: number } = {}
): SecurityHit[] {
	const query = q.trim().toLowerCase();
	if (query.length < MIN_QUERY) return [];
	const market = opts.market ?? 'all';
	const where = [
		"s.search like ? escape '\\'",
		opts.includeInactive ? '1 = 1' : 's.active = 1',
		market === 'us' ? "e.country = 'US'" : market === 'il' ? "e.country = 'IL'" : '1 = 1'
	].join(' and ');
	const st = prepare(
		sqlite,
		`search:${market}:${!!opts.includeInactive}`,
		`select s.id, s.symbol, s.name_en as nameEn, s.name_he as nameHe, s.exchange_code as exchangeCode,
		        e.name as exchangeName, s.type, s.currency, s.price_unit as priceUnit, s.active
		   from ref_securities s join ref_exchanges e on e.code = s.exchange_code
		  where ${where}
		  order by case
		             when lower(s.symbol) = ? then 0
		             when lower(s.symbol) like ? escape '\\' then 1
		             when lower(s.name_en) like ? escape '\\' or s.name_he like ? escape '\\' then 2
		             when s.search like ? escape '\\' then 3
		             else 4
		           end,
		           s.active desc, length(s.symbol), s.symbol
		  limit ?`
	);
	const like = escapeLike(query);
	const rows = st.all(`%${like}%`, query, `${like}%`, `${like}%`, `${like}%`, `% ${like}%`, opts.limit ?? 20) as (Omit<SecurityHit, 'active'> & { active: number })[];
	return rows.map((r) => ({ ...r, active: !!r.active }));
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
