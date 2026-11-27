import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { correlation, drawdowns, volatility } from './compare.js';

describe('owner 27.11.2026: volatility and correlation', () => {
	it('the volatility is the yearly standard deviation of daily log returns; the correlation of the same series is 1, of the mirror −1', () => {
		const m = openMarket(':memory:').sqlite;
		const id = (m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'X', 'X', 'USD', 'USD', 'x') returning id`).get() as { id: number }).id;
		const put = m.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
		// ±1% every other day: the daily log returns are ±ln(1.01) — sd ≈ ln(1.01), a year ≈ ln(1.01) × √252
		let p = 100;
		for (let i = 0; i < 260; i++) {
			const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
			p = i % 2 ? p / 1.01 : p * 1.01;
			put.run(id, d, p, p, p);
		}
		const v = volatility(m, id);
		expect(v.vol1y!).toBeCloseTo(Math.log(1.01) * Math.sqrt(252), 2);
		const a = new Map(Array.from({ length: 80 }, (_, i) => [`d${i}`, Math.sin(i)]));
		const b = new Map(Array.from({ length: 80 }, (_, i) => [`d${i}`, -Math.sin(i)]));
		expect(correlation(a, a)).toBe(1);
		expect(correlation(a, b)).toBe(-1);
		expect(correlation(new Map([['d1', 1]]), new Map([['d1', 1]]))).toBeNull();
	});

	it('drawdowns: 100 → 150 → 90 → 120: now −20% from the high, the worst −40%', () => {
		const c = [...Array.from({ length: 30 }, (_, i) => 100 + i * (50 / 29)), ...Array.from({ length: 20 }, (_, i) => 150 - (i + 1) * 3), ...Array.from({ length: 10 }, (_, i) => 90 + (i + 1) * 3)];
		expect(c.length).toBe(60);
		expect(drawdowns(c)).toEqual({ now: -0.2, max: -0.4 });
		expect(drawdowns(c.slice(0, 59))).toBeNull();
	});
});
