import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addEvent, createPortfolio } from './portfolio.js';
import { dividendHistory, dividendView } from './dividends.js';

// fictional shares and numbers only
describe('owner 28.11.2026: the dividends of a portfolio', () => {
	it('received this year by the shares held before each ex-date; yields, growth years, total return', () => {
		const app = openApp(':memory:').sqlite;
		const market = openMarket(':memory:').sqlite;
		const id = (market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NYSE', 'stock', 'DVD', 'Divco', 'USD', 'USD', 'dvd') returning id`).get() as { id: number }).id;
		const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
		for (const [d, c] of [['2026-01-09', 10], ['2026-03-31', 10], ['2026-11-27', 9]] as const) px.run(id, d, c, c, c);
		const dv = market.prepare(`insert into market_corporate_actions (security_id, ex_date, kind, amount, provider_code) values (?, ?, 'dividend', ?, 'test')`);
		// 2023 1.0, 2024 1.2, 2025 1.4 a year (growing 2 years); 2026: 0.5 + 0.5
		for (const [d, a] of [['2023-06-01', 1], ['2024-06-01', 1.2], ['2025-06-01', 1.4], ['2026-03-01', 0.5], ['2026-06-01', 0.5]] as const) dv.run(id, d, a);
		const p = createPortfolio(app, { name: 'D', currency: 'USD' });
		addEvent(app, market, { portfolioId: p.id, securityId: id, kind: 'buy', date: '2026-01-09', qty: 100, price: 10, fee: 0, confirm: true });
		addEvent(app, market, { portfolioId: p.id, securityId: id, kind: 'sell', date: '2026-03-31', qty: 50, price: 10, fee: 0, confirm: true });
		const v = dividendView(app, market, p.id, '2026-11-28')!;
		const r = v.rows[0];
		// 100 × 0.5 in March, 50 × 0.5 in June
		expect(r.received).toBeCloseTo(75, 6);
		expect(r.payments.map((x) => x.shares)).toEqual([100, 50]);
		expect(r.ttm).toBeCloseTo(1, 6);
		expect(r.yieldNow).toBeCloseTo((1 / 9) * 100, 1);
		expect(r.yieldOnCost).toBeCloseTo(10, 1);
		expect(r.growthYears).toBe(2);
		expect(r.cut).toBe(false);
		// the price −10%, the dividends since the purchase on the 50 held: 75 / 500 = +15% — together +5%
		expect(r.priceReturn).toBeCloseTo(-10, 1);
		expect(r.totalReturn).toBeCloseTo(5, 1);
		expect(v.income).toBeCloseTo(50, 6);
	});

	it('the history by year: the change against the year before, growth years, a cut, the current year not complete', () => {
		const market = openMarket(':memory:').sqlite;
		const id = (market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('TASE', 'stock', 'BNK', 'Bank', 'ILS', 'ILA', 'bnk') returning id`).get() as { id: number }).id;
		const dv = market.prepare(`insert into market_corporate_actions (security_id, ex_date, kind, amount, provider_code) values (?, ?, 'dividend', ?, 'test')`);
		for (const [d, a] of [['2021-05-01', 100], ['2022-05-01', 80], ['2023-05-01', 90], ['2024-05-01', 120], ['2025-05-01', 60], ['2025-11-01', 70], ['2026-05-01', 70]] as const) dv.run(id, d, a);
		const h = dividendHistory(market, id, '2026-11-28');
		expect(h.years.map((y) => [y.year, y.total, y.change, y.partial])).toEqual([
			['2021', 100, null, false],
			['2022', 80, -20, false],
			['2023', 90, 12.5, false],
			['2024', 120, 33.3, false],
			['2025', 130, 8.3, false],
			['2026', 70, -46.2, true]
		]);
		expect(h.growthYears).toBe(3);
		expect(h.cuts).toEqual(['2022']);
	});
});
