import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from '../db.js';
import { readParams, recordQuarter, upcoming, writeParams } from './service.js';

/** 600 shares with 15 years of monthly prices: every 50th rises in each Q1, the rest wander */
function setup() {
	const app = openApp(':memory:');
	const market = openMarket(':memory:');
	const m = market.sqlite;
	const addSec = m.prepare(
		`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search, active) values ('NASDAQ', 'stock', ?, ?, 'USD', 'USD', ?, 1)`
	);
	const put = m.prepare(`insert into market_prices_monthly (security_id, month, close, adj_close, volume, provider_code, fetched_at) values (?, ?, ?, ?, 1000000, 'yahoo', '2026-12-01')`);
	const mark = m.prepare(`insert into ops_monthly_loads (security_id, fetched_at, status, months) values (?, '2026-12-01', 'ok', 180)`);
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
	const months: string[] = [];
	for (let y = 2011; y <= 2026; y++) for (let mo = 1; mo <= 12; mo++) if (`${y}-${mo}` !== '2026-12') months.push(`${y}-${String(mo).padStart(2, '0')}`);
	m.transaction(() => {
		for (let i = 0; i < 600; i++) {
			const id = Number(addSec.run(`T${i}`, `Test ${i}`, `t${i}`).lastInsertRowid);
			mark.run(id);
			let p = 50;
			for (const mo of months) {
				const month = Number(mo.slice(5));
				p *= 1 + (i % 50 === 0 && month <= 3 ? 0.02 : rnd() * 0.1);
				put.run(id, mo, p, p);
			}
		}
		// the benchmark SPX (seeded as id 1): flat
		mark.run(1);
		for (const mo of months) put.run(1, mo, 100, 100);
	})();
	return { app, market };
}

describe('the quarterly model in the journal', () => {
	it('records the candidates on the first weekday of the quarter, once, with a version', () => {
		const { app, market } = setup();
		// not the start of a quarter: nothing
		expect(recordQuarter(app.db, app.sqlite, market.sqlite, 'A', new Date('2026-12-15T08:00:00Z')).skipped).toBe('not the start of a quarter');
		const r = recordQuarter(app.db, app.sqlite, market.sqlite, 'A', new Date('2027-01-04T08:00:00Z'));
		expect(r.skipped).toBeNull();
		expect(r.recorded).toBeGreaterThan(0);
		const hs = app.sqlite.prepare(`select h.symbol, h.horizon_date as h, h.signal_type as t, h.mode, h.model_version_id as v, s.name from hypotheses h join articles a on a.id = h.article_id join sources s on s.id = a.source_id`).all() as { symbol: string; h: string; t: string; mode: string; v: number; name: string }[];
		expect(hs).toHaveLength(r.recorded);
		// the seasonal shares are every 50th: T0, T50, …
		expect(hs.every((h) => Number(h.symbol.slice(1)) % 50 === 0)).toBe(true);
		expect(hs[0]).toMatchObject({ h: '2027-03-31', t: 'recommendation', mode: 'sim', name: 'Квартальная схема' });
		expect(hs.every((h) => h.v === hs[0].v)).toBe(true);
		// once per quarter
		expect(recordQuarter(app.db, app.sqlite, market.sqlite, 'A', new Date('2027-01-05T08:00:00Z')).skipped).toBe('already');
		// its automatic portfolio is on
		expect(app.sqlite.prepare('select count(*) as n from portfolios where auto_source_id is not null').get()).toMatchObject({ n: 1 });
		// the version of a hypothesis cannot change
		expect(() => app.sqlite.prepare('update hypotheses set model_version_id = 99').run()).toThrow(/model version/);
	});

	it('a trade from a candidate card is linked to the model\'s version (T-020)', async () => {
		const { app, market } = setup();
		const { createPortfolio, addEvent } = await import('../portfolio.js');
		const p = createPortfolio(app.sqlite, { name: 'Тест', kind: 'real', currency: 'USD' });
		const id = (market.sqlite.prepare(`select id from ref_securities where symbol = 'T0'`).get() as { id: number }).id;
		market.sqlite.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, '2026-11-02', 1, 100, 50, 'test')`).run(id);
		addEvent(app.sqlite, market.sqlite, { portfolioId: p.id, securityId: id, kind: 'buy', date: '2026-11-02', qty: 1, price: 50, fee: 0, modelVariant: 'B', confirm: true }, new Date('2026-11-03T10:00:00Z'));
		const e = app.sqlite.prepare(`select model_version_id as v from position_events where kind = 'buy'`).get() as { v: number };
		expect(app.sqlite.prepare('select variant from model_versions where id = ?').get(e.v)).toMatchObject({ variant: 'B' });
	});

	it('parameters are saved per variant and kept in their limits', () => {
		const { app } = setup();
		expect(readParams(app.sqlite, 'B').k).toBe(9);
		expect(writeParams(app.sqlite, 'B', { k: 8, compareWith: 'sector', years: 99 })).toMatchObject({ k: 8, compareWith: 'sector', years: 15 });
		expect(readParams(app.sqlite, 'A').k).toBe(9);
	});

	it('the next quarter is announced two weeks ahead', () => {
		expect(upcoming(new Date('2026-12-18T10:00:00Z'))).toMatchObject({ key: '2027-Q1', ready: true });
		expect(upcoming(new Date('2026-11-19T10:00:00Z'))).toMatchObject({ key: '2027-Q1', ready: false });
	});
});
