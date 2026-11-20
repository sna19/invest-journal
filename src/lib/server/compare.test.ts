import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { compareRefs, compareTable, ringRefIds } from './compare.js';

function setup() {
	const m = openMarket(':memory:').sqlite;
	const add = (exchange: string, symbol: string, type = 'etf') =>
		(m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values (?, ?, ?, ?, 'USD', 'USD', ?) returning id`).get(exchange, type, symbol, symbol, symbol.toLowerCase()) as { id: number }).id;
	const ids = { amat: add('NASDAQ', 'AMAT', 'stock'), xlk: add('NYSE_ARCA', 'XLK'), soxx: add('NASDAQ', 'SOXX'), qqq: add('NASDAQ', 'QQQ'), iwm: add('NYSE_ARCA', 'IWM') };
	m.prepare(`insert into ref_security_profiles (security_id, kind, sector, industry, market_cap, cap_currency, fetched_at) values (?, 'stock', 'technology', 'Semiconductor Equipment & Materials', 2.7e11, 'USD', '2026-11-20')`).run(ids.amat);
	const px = m.prepare(`insert into market_prices_daily (security_id, date, close, provider_code) values (?, ?, ?, 'test')`);
	for (const [d, a, x] of [
		['2025-11-20', 100, 50],
		['2026-10-20', 150, 60],
		['2026-11-20', 160, 66]
	] as const) {
		px.run(ids.amat, d, a);
		px.run(ids.xlk, d, x);
	}
	return { m, ids };
}

describe('«Compare with» on a security card', () => {
	it('the sector, industry and index ETFs of a share', () => {
		const { m, ids } = setup();
		const refs = compareRefs(m, ids.amat);
		expect(refs.map((r) => [r.role, r.symbol])).toEqual([
			['sector', 'XLK'],
			['industry', 'SOXX'],
			['index', 'QQQ']
		]);
		expect(ringRefIds(m).sort()).toEqual([ids.xlk, ids.soxx, ids.qqq, ids.iwm].sort());
	});

	it('returns over the periods, for the share and each reference', () => {
		const { m, ids } = setup();
		const t = compareTable(m, ids.amat, null);
		expect(t.security['1M']).toBeCloseTo((160 / 150 - 1) * 100, 1);
		expect(t.security['1Y']).toBeCloseTo(60, 1);
		const xlk = t.refs.find((r) => r.symbol === 'XLK')!;
		expect(xlk.returns['1Y']).toBeCloseTo(32, 1);
		expect(xlk.loaded).toBe(true);
		expect(t.refs.find((r) => r.symbol === 'SOXX')!.loaded).toBe(false);
	});
});
