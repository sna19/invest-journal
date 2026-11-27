import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addEvent, createPortfolio } from './portfolio.js';
import { atrOf, formula, PDEFAULTS, placeOrder, portfolioProtection, protectionOf, roundStop, sizeOf, trailLevel, type Bar } from './protection.js';
import { signals } from './discipline.js';

const NOW = new Date('2026-05-04T09:00:00Z');

/** 70 days: closes rise by 0.5 a day from 70, each day high +1 and low −1 around the close */
function bars(n = 70, start = 70, step = 0.5): Bar[] {
	return Array.from({ length: n }, (_, i) => {
		const c = start + i * step;
		return { date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, low: c - 1, high: c + 1, close: c };
	});
}

describe('T-021: the protective plan', () => {
	it('ATR, the stop under the 20-day low, the limit, the trailing % and the size — by hand', () => {
		const b = bars();
		// true range each day: max(high − low = 2, |high − prev close| = 1.5, |low − prev close| = 0.5) = 2
		expect(atrOf(b, 14)).toBe(2);
		const price = 104.5; // the last close
		const f = formula(b, price, PDEFAULTS, false)!;
		// the 20-day low: the close 20 days back (70 + 50 × 0.5 = 95) − 1 = 94; 104.5 − 94 = 10.5 ≥ 1 ATR and 10% ≤ 15% — it counts;
		// the 60-day low 74 is 29% under — too far; SMA200 — not enough days
		expect(f.level).toMatchObject({ kind: 'low_short', value: 94 });
		// 94 − 0.5 × 2 = 93.00 → not on a round number: 92.97
		expect(f.stop).toBe(92.97);
		// limit: 92.97 − max(2% = 1.8594, 1 ATR = 2) = 90.97
		expect(f.limit).toBe(90.97);
		// trailing: 3 × ATR% (2 / 104.5 = 1.914%) = 5.74% → at least 8%
		expect(f.trailPct).toBe(8);
		expect(f.trailStop).toBe(96.14);
		// T-035: the target — 2 risks up: 104.5 + 2 × (104.5 − 92.97) = 127.56; the 52 weeks' high 105.5 is under 1% above — not a resistance
		expect(f.target).toBe(127.56);
		expect(f.targetR).toBe(2);
		expect(f.resistance).toBeNull();
		// size: a 1% budget of 100 000 = 1 000; loss per share 104.5 − 92.97 = 11.53 → 86 shares (8 987 $)
		expect(sizeOf(1000, price, f.stop, 1, false)).toEqual({ qty: 86, amount: 86 * 104.5 });
		expect(sizeOf(1000, price, f.stop, 1, true).qty).toBe(86.73);
	});

	it('a volatile fund: no level near enough — 3 ATR; a wide trailing capped at 20%', () => {
		// a crypto fund: days of ±4 around a close that does not move
		const b: Bar[] = Array.from({ length: 30 }, (_, i) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, low: 46, high: 54, close: 50 }));
		const f = formula(b, 50, PDEFAULTS, false)!;
		expect(f.atr).toBe(8);
		// the 20-day low 46 is only 0.5 ATR under the price — no level; 50 − 3 × 8 = 26 → 25.97
		expect(f.level).toBeNull();
		expect(f.stop).toBe(25.97);
		expect(f.trailPct).toBe(20);
		// the 52 weeks' high 54 is under the 2-risk target 98.06: the target goes under it by 0.25 ATR — 52, 0.1 risk
		expect(f.resistance).toBe(54);
		expect(f.target).toBe(52);
		// a TASE share in agorot: 4 520 → 4 517
		expect(roundStop(4520, true)).toBe(4517);
		expect(roundStop(75.2, false)).toBe(75.17);
		expect(roundStop(75.29, false)).toBe(75.27);
	});

	it('a trailing level follows the highest close up and never down', () => {
		expect(trailLevel(100, [], 10)).toBe(90);
		expect(trailLevel(100, [105, 120], 10)).toBe(108);
		expect(trailLevel(100, [105, 120, 90], 10)).toBe(108);
	});

	it('the portfolio line: protected share, the loss at the stops, an order replaces the one before, the stop signal', () => {
		const app = openApp(':memory:').sqlite;
		const market = openMarket(':memory:').sqlite;
		const sec = market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', ?, ?, 'USD', 'USD', ?) returning id`);
		const a = (sec.get('AAA', 'AAA', 'aaa') as { id: number }).id;
		const b = (sec.get('BBB', 'BBB', 'bbb') as { id: number }).id;
		const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
		for (const x of bars(70)) {
			px.run(a, x.date, x.low, x.high, x.close);
			px.run(b, x.date, x.low, x.high, x.close);
		}
		const p = createPortfolio(app, { name: 'Мой', kind: 'real', currency: 'USD' });
		app.prepare(`insert into cash_events (portfolio_id, kind, date, amount, currency) values (?, 'deposit', '2025-12-31', 20000, 'USD')`).run(p.id);
		const pa = addEvent(app, market, { portfolioId: p.id, securityId: a, kind: 'buy', date: '2026-03-14', qty: 50, price: 100 }, NOW);
		addEvent(app, market, { portfolioId: p.id, securityId: b, kind: 'buy', date: '2026-03-14', qty: 50, price: 100 }, NOW);
		// 2 × 50 × 104.5 = 10 450 in shares, nothing protected
		let s = portfolioProtection(app, market, p.id, '2026-03-15')!;
		expect(s.protectedPct).toBe(0);
		expect(s.unprotected).toBe(2);
		// «Я выставил»: AAA a stop at 92.97 → half the shares protected, a loss of 50 × (104.5 − 92.97) = 576.5
		placeOrder(app, { positionId: pa.positionId, type: 'fixed', stop: 92.97, limit: 90.97 }, '2026-03-15');
		s = portfolioProtection(app, market, p.id, '2026-03-15')!;
		expect(s.protectedPct).toBeCloseTo(50, 6);
		expect(s.maxLoss).toBeCloseTo(576.5, 6);
		expect(s.maxLossPct).toBeCloseTo((576.5 / 20450) * 100, 6);
		expect(s.items.find((x) => x.symbol === 'AAA')!.status).toBe('protected');
		// a trailing order replaces it: 10% from 104.5 → 94.05
		placeOrder(app, { positionId: pa.positionId, type: 'trail', trailPct: 10, price: 104.5 }, '2026-03-15');
		const v = protectionOf(app, market, a).items[0];
		expect(v.order).toMatchObject({ type: 'trail' });
		expect(v.order!.level).toBeCloseTo(94.05, 6);
		// the price falls under the level: the stop signal says the broker's stop should have worked
		px.run(a, '2026-03-16', 90, 95, 93);
		const sig = signals(app, market, '2026-03-16').find((x) => x.symbol === 'AAA' && x.kind === 'stop')!;
		expect(sig).toMatchObject({ order: true });
		expect(sig.stop).toBeCloseTo(94.05, 6);
		// BBB bought two days ago without a stop: «no_stop»
		expect(signals(app, market, '2026-03-16').filter((x) => x.kind === 'no_stop').map((x) => x.symbol)).toEqual(['BBB']);
		// a new purchase without a position: the size from 1% of the portfolio
		const c = (sec.get('CCC', 'CCC', 'ccc') as { id: number }).id;
		for (const x of bars(70)) px.run(c, x.date, x.low, x.high, x.close);
		const n = protectionOf(app, market, c).items[0];
		expect(n.position).toBeNull();
		expect(n.size!.budget).toBeGreaterThan(0);
		expect(n.recommended).toBe('fixed');
	});
});
