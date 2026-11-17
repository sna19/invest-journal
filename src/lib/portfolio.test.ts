import { describe, expect, it } from 'vitest';
import { cashFlow, effective, fifo, holding, OversellError, stageOf, trades, twr, valueOn, type Book, type Ev, type Market } from './portfolio.js';

/**
 * Stage 7 criterion — a test portfolio with partial buys and sells, a dividend and two currencies; every number
 * below is worked out by hand from the events (not from the code).
 *
 *   2026-01-05  deposit 10 000 ₪
 *   2026-01-05  buy  A (TASE, agorot) 100 @ 5000 ag, fee 10 ₪          → −5 010 ₪        cash 4 990
 *   2026-01-06  buy  U (USD) 10 @ 100 $, fee 1 $, rate 3.5            → −3 503.5 ₪      cash 1 486.5
 *   2026-02-02  buy  A 50 @ 6000 ag, fee 10 ₪                         → −3 010 ₪ → cash −1 523.5:
 *                                                                        implied deposit 1 523.5, cash 0
 *   2026-03-02  sell A 120 @ 7000 ag, fee 20 ₪ → 8 380 ₪; FIFO: 100 × 50.1 + 20 × 60.2 = 6 214 → realized 2 166 ₪
 *   2026-03-10  dividend U 10 $ at 3.6                                 → +36 ₪          cash 8 416
 *   2026-04-01  sell U 4 @ 120 $, fee 1 $, rate 3.7 → 479 $ = 1 772.3 ₪; cost 4 × 100.1 = 400.4 $ = 1 401.4 ₪
 *               realized 78.6 $, 370.9 ₪                                                cash 10 188.3
 *   2026-04-01  withdraw 5 000 ₪                                                         cash 5 188.3
 *   2026-04-30  A 6500 ag, U 110 $, rate 3.8:
 *               A 30 × 65 = 1 950 ₪ (cost 30 × 60.2 = 1 806, +144); U 6 × 110 = 660 $ = 2 508 ₪
 *               (cost 600.6 $ × 3.5 = 2 102.1 ₪, +405.9 = price 6 × 9.9 × 3.5 = 207.9 + rate 6 × 110 × 0.3 = 198)
 *               value 5 188.3 + 1 950 + 2 508 = 9 646.3 ₪
 *   TWR: 01-05 9 990 / 10 000; 02-02 12 727.5 / (9 990 + 1 523.5); 04-01 9 892.3 / (12 727.5 − 5 000);
 *        04-30 9 646.3 / 9 892.3 → 0.999 × 1.105441 × 1.280142 × 0.975132 − 1 = +37.855%
 */
const ev = (id: number, kind: string, date: string, qty: number | null, price: number | null, fee: number | null, fxRate = 1): Ev => ({
	id,
	kind,
	date,
	qty,
	price,
	fee,
	fxRate,
	reversesEventId: null,
	cancelledAt: null
});

const A = [ev(1, 'buy', '2026-01-05', 100, 5000, 10), ev(3, 'buy', '2026-02-02', 50, 6000, 10), ev(4, 'sell', '2026-03-02', 120, 7000, 20)];
const U = [ev(2, 'buy', '2026-01-06', 10, 100, 1, 3.5), ev(6, 'sell', '2026-04-01', 4, 120, 1, 3.7)];

const book: Book = {
	positions: [
		{ id: 1, securityId: 101, f: 0.01, currency: 'ILS', trades: trades(A) },
		{ id: 2, securityId: 102, f: 1, currency: 'USD', trades: trades(U) }
	],
	cash: [
		{ id: 1, date: '2026-01-05', kind: 'deposit', amount: 10000, fx: 1 },
		{ id: 2, date: '2026-03-10', kind: 'dividend', amount: 10, fx: 3.6 },
		{ id: 3, date: '2026-04-01', kind: 'withdraw', amount: 5000, fx: 1 }
	]
};

const table: Record<number, Record<string, number>> = {
	101: { '2026-01-05': 5000, '2026-02-02': 6000, '2026-04-01': 6800, '2026-04-30': 6500 },
	102: { '2026-02-02': 105, '2026-04-01': 120, '2026-04-30': 110 }
};
const rates: Record<string, number> = { '2026-01-05': 3.5, '2026-02-02': 3.55, '2026-03-10': 3.6, '2026-04-01': 3.7, '2026-04-30': 3.8 };
const last = (t: Record<string, number>, d: string) =>
	Object.entries(t)
		.filter(([k]) => k <= d)
		.sort()
		.at(-1)?.[1] ?? null;
const market: Market = { price: (s, d) => last(table[s], d), fx: (c, d) => (c === 'ILS' ? 1 : last(rates, d)!) };

describe('portfolio arithmetic (stage 7 criterion)', () => {
	it('FIFO: realized and what is left, in the currency and in shekels', () => {
		const a = fifo(book.positions[0].trades, 0.01);
		expect(a.realized).toBeCloseTo(2166, 6);
		expect(a.qty).toBe(30);
		expect(a.cost).toBeCloseTo(1806, 6);
		const u = fifo(book.positions[1].trades, 1);
		expect(u.realized).toBeCloseTo(78.6, 6);
		expect(u.realizedIls).toBeCloseTo(370.9, 6);
		expect(u.qty).toBe(6);
	});

	it('holdings in shekels; the US one splits into price and rate', () => {
		const a = holding(fifo(book.positions[0].trades, 0.01), 0.01, 6500, 1);
		expect(a.valueIls).toBeCloseTo(1950, 6);
		expect(a.unrealizedIls).toBeCloseTo(144, 6);
		const u = holding(fifo(book.positions[1].trades, 1), 1, 110, 3.8);
		expect(u.valueIls).toBeCloseTo(2508, 6);
		expect(u.unrealizedIls).toBeCloseTo(405.9, 6);
		expect(u.fromPrice).toBeCloseTo(207.9, 6);
		expect(u.fromFx).toBeCloseTo(198, 6);
		expect(u.avgPrice).toBe(100);
	});

	it('cash with the implied deposit; value; TWR', () => {
		const c = cashFlow(book);
		expect(c.flows).toEqual([
			{ date: '2026-01-05', ils: 10000 },
			{ date: '2026-02-02', ils: 1523.5 },
			{ date: '2026-04-01', ils: -5000 }
		]);
		expect(c.cash).toBeCloseTo(5188.3, 6);
		expect(valueOn(book, market, '2026-04-30')).toBeCloseTo(9646.3, 6);
		const t = twr(book, market, '2026-04-30');
		expect(t.series.map((s) => [s.date, Math.round(s.value * 10) / 10])).toEqual([
			['2026-01-05', 9990],
			['2026-02-02', 12727.5],
			['2026-04-01', 9892.3],
			['2026-04-30', 9646.3]
		]);
		expect(t.twr!).toBeCloseTo(0.3785514, 6);
		expect(t.invested).toBeCloseTo(6523.5, 6);
	});

	it('within a day the order of entry counts: a sale entered after a buy does not pay for it', () => {
		const at = (e: Ev, t: string) => ({ ...e, createdAt: t });
		const b: Book = {
			positions: [
				{ id: 1, securityId: 101, f: 0.01, currency: 'ILS', trades: trades([at(ev(1, 'buy', '2026-01-05', 100, 5000, 0), '10:00'), at(ev(2, 'sell', '2026-01-05', 40, 5000, 0), '10:05')]) },
				{ id: 2, securityId: 102, f: 1, currency: 'ILS', trades: trades([at(ev(3, 'buy', '2026-01-05', 10, 100, 0), '10:01')]) }
			],
			cash: []
		};
		const c = cashFlow(b);
		// buy 5 000 (implied), buy 1 000 (implied), then the sale brings 2 000 in: cash 2 000, outside money 6 000
		expect(c.flows).toEqual([{ date: '2026-01-05', ils: 6000 }]);
		expect(c.cash).toBeCloseTo(2000, 6);
	});

	it('selling more than is held is refused', () => {
		expect(() => fifo(trades([...U, ev(9, 'sell', '2026-04-02', 7, 120, 0, 3.7)]), 1)).toThrow(OversellError);
	});

	it('a storno takes the event out but both stay; a cancelled event is out too', () => {
		const list = [...A, { ...ev(10, 'buy', '2026-03-03', 5, 1, 0), cancelledAt: '2026-03-03T10:00:00Z' }, { ...ev(11, 'reverse', '2026-03-05', null, null, null), reversesEventId: 4 }];
		expect(effective(list).map((e) => e.id)).toEqual([1, 3]);
		expect(fifo(trades(list), 0.01).qty).toBe(150);
	});

	it('a split brings old trades to the current scale', () => {
		const t = trades([ev(1, 'buy', '2026-01-05', 10, 300, 0)], [{ date: '2026-02-01', ratio: 3 }]);
		expect(t[0]).toMatchObject({ qty: 30, price: 100 });
	});

	it('stages', () => {
		const w = ev(1, 'watch', '2026-01-01', null, null, null);
		const pb = ev(2, 'plan_buy', '2026-01-02', null, null, null);
		const b = ev(3, 'buy', '2026-01-03', 1, 10, 0);
		const ps = ev(4, 'plan_sell', '2026-01-04', null, null, null);
		const d = ev(5, 'drop', '2026-01-05', null, null, null);
		const s = ev(6, 'sell', '2026-01-06', 1, 12, 0);
		expect(stageOf([w], 0)).toBe('watch');
		expect(stageOf([w, pb], 0)).toBe('plan_buy');
		expect(stageOf([w, pb, d], 0)).toBe('closed');
		expect(stageOf([w, pb, b], 1)).toBe('holding');
		expect(stageOf([w, pb, b, ps], 1)).toBe('plan_sell');
		expect(stageOf([w, pb, b, ps, d], 1)).toBe('holding');
		expect(stageOf([w, pb, b, ps, s], 0)).toBe('closed');
	});
});
