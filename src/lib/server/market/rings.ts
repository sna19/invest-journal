import type Database from 'better-sqlite3';

/**
 * Spec section 14 — rings of price loading; one code for all, the next ring is a setting.
 * 1 — the two benchmarks and the securities hypotheses point to (on from day one);
 * 2 — + all TASE shares and the S&P 500 (off);
 * 3 — all active securities of the base (off).
 */
export type Ring = 1 | 2 | 3;

export function getSetting(market: Database.Database, key: string, fallback: string) {
	return (market.prepare('select value from ops_settings where key = ?').get(key) as { value: string } | undefined)?.value ?? fallback;
}

export function setSetting(market: Database.Database, key: string, value: string) {
	market.prepare('insert into ops_settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value').run(key, value);
}

export const ring = (market: Database.Database): Ring => {
	const r = Number(getSetting(market, 'ring', '1'));
	return r === 2 || r === 3 ? r : 1;
};

/** Ids of the securities whose prices are loaded, benchmarks first, then hypotheses' ones, then the rest. */
export function ringSecurities(market: Database.Database, app: Database.Database, r: Ring = ring(market)): number[] {
	const ids = new Set<number>();
	for (const b of market.prepare('select id from ref_securities where is_benchmark = 1 order by id').all() as { id: number }[]) ids.add(b.id);
	for (const h of app.prepare(`select distinct security_id as id from hypotheses where status <> 'cancelled'`).all() as { id: number }[])
		ids.add(h.id);
	if (r >= 2) {
		for (const s of market
			.prepare(`select id from ref_securities where active = 1 and exchange_code = 'TASE' and type = 'stock' and coalesce(price_status, '') <> 'none'`)
			.all() as { id: number }[])
			ids.add(s.id);
		const sp = getSetting(market, 'sp500_symbols', '').split(',').filter(Boolean);
		if (sp.length) {
			const q = market.prepare(`select id from ref_securities where active = 1 and symbol = ? and exchange_code in ('NYSE', 'NASDAQ', 'NYSE_AMERICAN', 'CBOE_BZX', 'NYSE_ARCA')`);
			for (const sym of sp) for (const s of q.all(sym) as { id: number }[]) ids.add(s.id);
		}
	}
	if (r === 3) {
		for (const s of market.prepare(`select id from ref_securities where active = 1 and coalesce(price_status, '') <> 'none'`).all() as { id: number }[])
			ids.add(s.id);
	}
	return [...ids];
}
