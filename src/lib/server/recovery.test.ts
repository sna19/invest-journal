import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { recoveryOf, recoveryStage } from './recovery.js';

function market(closes: number[]) {
	const m = openMarket(':memory:').sqlite;
	const id = (m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'XYZ', 'XYZ', 'USD', 'USD', 'xyz') returning id`).get() as { id: number }).id;
	const put = m.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	closes.forEach((c, i) => put.run(id, new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), c, c, c));
	return { m, id };
}

describe('owner 27.11.2026: the state of a share after a deep fall', () => {
	it('the stages by the SMA50, the SMA200 and the distance from the 3-month low', () => {
		expect(recoveryStage(100, 110, 120, 0.02)).toBe('falling');
		expect(recoveryStage(100, 110, 120, 0.12)).toBe('basing');
		expect(recoveryStage(100, 95, 120, 0.2)).toBe('recovering');
		expect(recoveryStage(100, 95, 90, 0.3)).toBe('uptrend');
	});
	it('200 days at 100, a fall to 50, then a rise to 65: 30% above the low, −35% from the high, recovering', () => {
		const c = [...Array(200).fill(100), ...Array.from({ length: 50 }, (_, i) => 100 - (i + 1)), ...Array.from({ length: 15 }, (_, i) => 50 + (i + 1))];
		const { m, id } = market(c);
		const r = recoveryOf(m, id, '2025-01-01')!;
		expect(r.low).toBe(50);
		expect(r.fromLow).toBeCloseTo(0.3, 4);
		expect(r.fromHigh).toBeCloseTo(-0.35, 4);
		expect(r.sma50).toBeCloseTo(c.slice(-50).reduce((a, x) => a + x, 0) / 50, 6);
		expect(r.stage).toBe('recovering');
	});
	it('under 60 days — nothing', () => {
		const { m, id } = market(Array(59).fill(10));
		expect(recoveryOf(m, id)).toBeNull();
	});
});
