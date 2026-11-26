import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addEvent, benchmarkId, createPortfolio, portfolioView } from './portfolio.js';
import { allocate } from '../allocation.js';
import { setSetting } from './risk.js';
import { checkPurchase, composition, counterfactual, disposition, reviews, saveReview, setOverride, speculation, workRisk, yearResult } from './portfolioRisk.js';
import { signalsBlock } from './reminders.js';

const NOW = new Date('2026-05-04T09:00:00Z');
const tx = (ru: string) => ru;

/** a dollar portfolio; SOXX (Yahoo's sector weights), MAGS (none — set by hand), NVDA and AMAT (the employer) */
function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', ?, ?, ?, 'USD', 'USD', ?) returning id`);
	const id = (t: string, s: string) => (sec.get(t, s, s, s.toLowerCase()) as { id: number }).id;
	const soxx = id('etf', 'SOXX');
	const mags = id('etf', 'MAGS');
	const nvda = id('stock', 'NVDA');
	const amat = id('stock', 'AMAT');
	const xom = id('stock', 'XOM');
	const prof = market.prepare(`insert into ref_security_profiles (security_id, kind, sector, industry, country, fund_category, sector_weights, holdings, fetched_at) values (?, ?, ?, ?, ?, ?, ?, ?, '2026-05-01')`);
	prof.run(soxx, 'etf', null, null, null, 'Technology', JSON.stringify({ technology: 0.97, industrials: 0.03 }), JSON.stringify([{ symbol: 'NVDA', name: 'NVIDIA', weight: 0.08 }]));
	prof.run(mags, 'etf', null, null, null, 'Technology', null, JSON.stringify([{ symbol: 'NVDA', name: 'NVIDIA', weight: 0.15 }, { symbol: 'FGXXX', name: 'cash', weight: 0.15 }]));
	prof.run(nvda, 'stock', 'technology', 'Semiconductors', 'United States', null, null, null);
	prof.run(amat, 'stock', 'technology', 'Semiconductor Equipment & Materials', 'United States', null, null, null);
	prof.run(xom, 'stock', 'energy', 'Oil & Gas Integrated', 'United States', null, null, null);
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	const spx = benchmarkId(market, 'benchmark:SPX')!;
	for (const [s, a, b, c] of [
		[soxx, 200, 220, 240],
		[mags, 50, 52, 50],
		[nvda, 100, 90, 80],
		[amat, 150, 150, 150],
		[xom, 100, 110, 120],
		[spx, 1000, 1100, 1200]
	] as const) {
		px.run(s, '2026-04-01', a - 1, a + 1, a);
		px.run(s, '2026-04-15', b - 1, b + 1, b);
		px.run(s, '2026-04-30', c - 1, c + 1, c);
	}
	const p = createPortfolio(app, { name: 'Мой', kind: 'real', currency: 'USD' });
	app.prepare(`insert into cash_events (portfolio_id, kind, date, amount, currency) values (?, 'deposit', '2026-03-31', 20000, 'USD')`).run(p.id);
	setSetting(app, 'employer', 'AMAT');
	return { app, market, soxx, mags, nvda, amat, xom, p };
}
const buy = (s: ReturnType<typeof setup>, securityId: number, qty: number, price: number, date = '2026-04-01', plan?: object) =>
	addEvent(s.app, s.market, { portfolioId: s.p.id, securityId, kind: 'buy', date, qty, price, ...(plan ? { discipline: true, plan } : {}) }, NOW);

describe('T-016: risk of the portfolio', () => {
	it('sectors through the funds: SOXX by Yahoo\'s weights, MAGS by hand — as the hand calculation, to 1 pp', () => {
		const s = setup();
		buy(s, s.soxx, 25, 200); // 25 × 240 = 6 000 on 30.04
		buy(s, s.mags, 80, 50); // 80 × 50 = 4 000
		setOverride(s.app, s.mags, 'sector', { technology: 43, consumer_cyclical: 29, communication_services: 28 });
		const v = portfolioView(s.app, s.market, s.p.id, '2026-04-30')!;
		const a = allocate('sector', v.positions, 0, tx);
		const pct = (k: string) => (a.rows.find((r) => r.key === k)!.value / 10000) * 100;
		// by hand: technology 6000 × 0.97 + 4000 × 0.43 = 7540 → 75.4%; industrials 180 → 1.8%; consumer cyclical 1160 → 11.6%; communication 1120 → 11.2%
		expect(pct('technology')).toBeCloseTo(75.4, 0);
		expect(pct('industrials')).toBeCloseTo(1.8, 0);
		expect(pct('consumer_cyclical')).toBeCloseTo(11.6, 0);
		expect(pct('communication_services')).toBeCloseTo(11.2, 0);
		expect(composition(s.app, s.market, s.mags).source).toMatchObject({ sector: 'manual', country: 'holdings', industry: 'holdings' });
		expect(composition(s.app, s.market, s.soxx).industries).toEqual({ Semiconductors: 1 });
		expect(() => setOverride(s.app, s.mags, 'sector', { technology: 80, energy: 40 })).toThrow(/больше 100/);
	});

	it('the job\'s industry: NVDA, SOXX and NVDA inside MAGS count; buying more warns over the limit', () => {
		const s = setup();
		buy(s, s.nvda, 15, 100); // 15 × 80 = 1 200
		buy(s, s.soxx, 5, 200); // 5 × 240 = 1 200, all semiconductors
		buy(s, s.mags, 40, 50); // 2 000, NVDA 15% of the identified 30% → half by the holdings
		const w = workRisk(s.app, s.market, s.p.id)!;
		expect(w.industry).toBe('полупроводники');
		expect(w.positions.map((x) => x.symbol).sort()).toEqual(['MAGS', 'NVDA', 'SOXX']);
		// 1200 + 1200 + 2000 × 0.5 = 3400 of 20 000 → 17%
		expect(w.sharePct).toBeCloseTo(17, 0);
		expect(checkPurchase(s.app, s.market, s.p.id, s.xom, 2000, 'own')).toEqual([]);
		const warn = checkPurchase(s.app, s.market, s.p.id, s.soxx, 1500, 'own');
		expect(warn.map((x) => x.rule)).toEqual(['industry']);
		expect(warn[0].text).toMatch(/полупроводники — 2\d% портфеля при лимите 20%/);
	});

	it('«А если бы в индекс»: the same three trades into the S&P 500, by hand', () => {
		const s = setup();
		const a = buy(s, s.xom, 10, 100, '2026-04-01'); // 1 000 → 1 index unit at 1000
		buy(s, s.nvda, 10, 90, '2026-04-15'); // 900 → 900/1100 units
		addEvent(s.app, s.market, { positionId: a.positionId, kind: 'sell', date: '2026-04-15', qty: 5, price: 110 }, NOW); // −550 → −550/1100
		const c = counterfactual(s.app, s.market, s.p.id, '2026-04-30')!;
		const units = 1 + 900 / 1100 - 550 / 1100;
		const mirror = units * 1200;
		const held = 5 * 120 + 10 * 80; // 1 400
		expect(c.rows[0]).toMatchObject({ index: 'S&P 500' });
		expect(c.rows[0]!.mirror).toBeCloseTo(mirror, 1);
		expect(c.rows[0]!.diff).toBeCloseTo(held - mirror, 1);
		expect(c.rows[0]!.pp).toBeCloseTo(((held - mirror) / 1900) * 100, 0);
	});

	it('the speculation budget, the disposition effect, the year, the position review', () => {
		const s = setup();
		buy(s, s.xom, 10, 100, '2026-04-01', { kind: 'spec', thesis: 'отскок нефти', noStopReason: 'игра' });
		const n = buy(s, s.nvda, 20, 100, '2026-04-01');
		const sp = speculation(s.app, s.market, s.p.id);
		expect([sp.value, sp.loss]).toEqual([1200, 1200]);
		// 1 200 of 20 000 is 6% already, over the 3% budget
		expect(checkPurchase(s.app, s.market, s.p.id, s.xom, 300, 'spec').map((x) => x.rule)).toEqual(['spec']);
		const d = disposition(s.app, s.market, s.p.id, '2026-04-30')!;
		expect(d.openLoss).toBe(-400);
		expect(d.concentration).toMatchObject({ n: 1, of: 1, symbols: ['NVDA'], pct: 100 });
		addEvent(s.app, s.market, { positionId: n.positionId, kind: 'sell', date: '2026-04-30', qty: 5, price: 80 }, NOW);
		expect(yearResult(s.app, s.market, 2026, '2026-04-30')).toMatchObject([{ portfolio: 'Мой', sales: 1, loss: -100, net: -100 }]);
		// the review: «нет» → «держу без тезиса»; the whole portfolio reviewed → the next one in three months
		for (const r of reviews(s.app, s.market, s.p.id)!.rows) saveReview(s.app, s.market, r.positionId, { thesis: 'x', wouldBuy: r.symbol !== 'NVDA', exit: 'стоп' }, '2026-04-30');
		const r = reviews(s.app, s.market, s.p.id)!;
		expect(r.rows.map((x) => [x.symbol, x.noThesis])).toEqual([
			['XOM', false],
			['NVDA', true]
		]);
		expect(r.lastFull).toBe('2026-04-30');
		expect(signalsBlock(s.app, s.market, '2026-07-30').reminders.map((x) => x.title)).toEqual(['Разбор позиций: Мой']);
	});
});
