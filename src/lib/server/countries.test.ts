import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { countriesView } from './countries.js';

describe('owner 28.11.2026: country ETFs', () => {
	it('the momentum 12−1, the trend, the rank; a fund without a history is marked as loading', async () => {
		const m = openMarket(':memory:').sqlite;
		const add = (symbol: string) => (m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NYSE_ARCA', 'etf', ?, ?, 'USD', 'USD', ?) returning id`).get(symbol, symbol, symbol.toLowerCase()) as { id: number }).id;
		const up = add('EWJ');
		const down = add('EWZ');
		add('EPOL');
		const put = m.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
		const today = new Date(Date.UTC(2026, 10, 28));
		// 300 trading days back to today: one rises 0.1% a day, the other falls 0.1% a day
		for (let i = 0; i < 300; i++) {
			const d = new Date(today.getTime() - (299 - i) * 86_400_000).toISOString().slice(0, 10);
			put.run(up, d, 1, 1, 100 * 1.001 ** i);
			put.run(down, d, 1, 1, 100 * 0.999 ** i);
		}
		const v = await countriesView(m, today, () => Promise.reject(new Error('offline')));
		const j = v.rows.find((r) => r.symbol === 'EWJ')!;
		const z = v.rows.find((r) => r.symbol === 'EWZ')!;
		expect(j.mom).toBeCloseTo((1.001 ** 231 - 1) * 100, 0);
		expect(j.trend).toBe(true);
		expect(z.trend).toBe(false);
		expect([j.rank, z.rank]).toEqual([1, 2]);
		expect(v.rows.find((r) => r.symbol === 'EPOL')!.loaded).toBe(false);
		expect(v.missing.length).toBe(1);
	});
});
