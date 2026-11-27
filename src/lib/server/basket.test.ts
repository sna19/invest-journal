import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { basket } from './basket.js';

// fictional shares only
describe('owner 27.11.2026: a set bought equally at the start of the period', () => {
	it('two shares +50% and −10% → the basket +20%; a share without a price at the start is left out; the worst drawdown', () => {
		const m = openMarket(':memory:').sqlite;
		const sec = m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', ?, ?, 'USD', 'USD', ?) returning id`);
		const a = (sec.get('AAA', 'AAA', 'aaa') as { id: number }).id;
		const b = (sec.get('BBB', 'BBB', 'bbb') as { id: number }).id;
		const c = (sec.get('CCC', 'CCC', 'ccc') as { id: number }).id;
		const put = m.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
		const today = new Date(Date.UTC(2026, 10, 27));
		const start = Date.UTC(2025, 10, 28);
		for (let i = 0; i < 360; i++) {
			const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
			const f = i / 359;
			put.run(a, d, 0, 0, 100 * (1 + 0.5 * f));
			put.run(b, d, 0, 0, i === 180 ? 70 : 100 * (1 - 0.1 * f));
			if (i > 200) put.run(c, d, 0, 0, 50);
		}
		const r = basket(m, [a, b, c], 1, today);
		expect(r.left.map((x) => x.symbol)).toEqual(['CCC']);
		expect(r.total).toBeCloseTo(20, 1);
		expect(r.parts.map((p) => [p.symbol, p.ret])).toEqual([
			['AAA', 50],
			['BBB', -10]
		]);
		expect(r.maxDrawdown!).toBeLessThan(-10);
	});
});
