import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from '../db.js';
import { monthAdd } from './momentum.js';
import { momentumView, recordMomentum, writeMParams } from './momentumService.js';

/** four country funds, SPY and BIL on NYSE Arca with 6 years of monthly closes to 2026-12 */
function setup() {
	const app = openApp(':memory:');
	const market = openMarket(':memory:');
	const m = market.sqlite;
	const sec = m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search, active) values ('NYSE_ARCA', 'etf', ?, ?, 'USD', 'USD', ?, 1) returning id`);
	const ps = m.prepare(`insert into ref_provider_symbols (security_id, provider_code, provider_symbol) values (?, 'yahoo', ?)`);
	const put = m.prepare(`insert into market_prices_monthly (security_id, month, close, adj_close, volume, provider_code, fetched_at) values (?, ?, ?, ?, 1000, 'yahoo', '2027-01-01')`);
	const rate: Record<string, number> = { EWA: 0.03, EWB: 0.02, EWC: -0.01, EWD: 0.004, SPY: 0.01, BIL: 0.003 };
	for (const [s, r] of Object.entries(rate)) {
		const id = (sec.get(s, s, s.toLowerCase()) as { id: number }).id;
		ps.run(id, s);
		let v = 50;
		for (let i = 0; i < 72; i++) {
			put.run(id, monthAdd('2021-01', i), v, v);
			v *= 1 + r;
		}
	}
	writeMParams(app.sqlite, { universe: ['EWA', 'EWB', 'EWC', 'EWD'], top: 2, years: 4 });
	return { app, market };
}

describe('T-017: country momentum in the journal', () => {
	it('the screen: the signal, the table of A, B and three bases, under 2 s', () => {
		const { app, market } = setup();
		const v = momentumView(app.sqlite, market.sqlite);
		expect(v.ready).toBe(true);
		if (!v.ready) return;
		expect(v.data.missing).toEqual([]);
		expect(v.lastMonth).toBe('2026-12');
		expect(v.current.map((c) => c.hold)).toEqual([
			['EWA', 'EWB'],
			['EWA', 'EWB']
		]);
		expect(v.table.map((r) => r.name)).toEqual(['A', 'B', 'SPY', 'EQUAL', 'LEADERS']);
		// SPY bought and held: 1% a month → 12.7% a year, never falls
		expect(v.table[2].full.cagr).toBeCloseTo(12.7, 1);
		expect(v.table[2].full.maxDrawdown).toBe(0);
		expect(v.ms).toBeLessThan(2000);
		// a look with another N is not saved
		const n1 = momentumView(app.sqlite, market.sqlite, { top: 1 });
		expect(n1.ready && n1.current[0].hold).toEqual(['EWA']);
		expect(n1.params.top).toBe(1);
		expect(momentumView(app.sqlite, market.sqlite).params.top).toBe(2);
	});

	it('records the month on its first weekday, once: hypotheses and the automatic portfolio', () => {
		const { app, market } = setup();
		expect(recordMomentum(app.db, app.sqlite, market.sqlite, 'A', new Date('2027-01-15T08:00:00Z')).skipped).toBe('not a rebalance day');
		const r = recordMomentum(app.db, app.sqlite, market.sqlite, 'B', new Date('2027-01-04T08:00:00Z'));
		expect(r).toMatchObject({ variant: 'MB', month: '2027-01', recorded: 2, skipped: null });
		const hs = app.sqlite.prepare(`select h.symbol, h.horizon_date as h, s.name from hypotheses h join articles a on a.id = h.article_id join sources s on s.id = a.source_id order by h.symbol`).all();
		expect(hs).toEqual([
			{ symbol: 'EWA', h: '2027-01-31', name: 'Страновой моментум — двойной' },
			{ symbol: 'EWB', h: '2027-01-31', name: 'Страновой моментум — двойной' }
		]);
		expect(recordMomentum(app.db, app.sqlite, market.sqlite, 'B', new Date('2027-01-05T08:00:00Z')).skipped).toBe('already');
		expect(app.sqlite.prepare('select count(*) as n from portfolios where auto_source_id is not null').get()).toMatchObject({ n: 1 });
		// the prices of the closed month are not there yet: wait
		expect(recordMomentum(app.db, app.sqlite, market.sqlite, 'A', new Date('2027-02-01T08:00:00Z')).skipped).toMatch(/end at 2026-12/);
	});
});
