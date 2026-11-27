import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { peersOf } from './compare.js';

// fictional shares only
describe('owner 27.11.2026: shares to compare on the chart — «огурцы с огурцами»', () => {
	it('the biggest of the same industry first, then the sector; an asked one is added; the correlation where daily prices are', () => {
		const m = openMarket(':memory:').sqlite;
		const sec = m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', ?, ?, 'USD', 'USD', ?) returning id`);
		const prof = m.prepare(`insert into ref_security_profiles (security_id, kind, sector, industry, market_cap, cap_currency, fetched_at) values (?, 'stock', ?, ?, ?, 'USD', '2026-11-27')`);
		const add = (sym: string, sector: string, industry: string, cap: number) => {
			const id = (sec.get(sym, sym, sym.toLowerCase()) as { id: number }).id;
			prof.run(id, sector, industry, cap);
			return id;
		};
		const me = add('AAA', 'technology', 'Semis', 100);
		const b = add('BBB', 'technology', 'Semis', 300);
		const c = add('CCC', 'technology', 'Semis', 200);
		const d = add('DDD', 'technology', 'Software', 900);
		const e = add('EEE', 'energy', 'Oil', 50);
		const put = m.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
		for (let i = 0; i < 90; i++) {
			const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
			const v = 100 * (1 + 0.01 * Math.sin(i));
			put.run(me, day, v, v, v);
			put.run(b, day, v, v, v);
		}
		const r = peersOf(m, me, [e], 3);
		expect(r.industry).toBe('Semis');
		expect(r.peers.map((p) => [p.symbol, p.same])).toEqual([
			['BBB', 'industry'],
			['CCC', 'industry'],
			['DDD', 'sector'],
			['EEE', 'asked']
		]);
		expect(r.peers[0].corr).toBe(1);
		expect(r.peers[0].loaded).toBe(true);
		expect(r.peers[1]).toMatchObject({ corr: null, loaded: false });
		void c;
		void d;
	});
});
