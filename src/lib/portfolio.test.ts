import { describe, expect, it } from 'vitest';
import { cashFlow, effective, fifo, holding, OversellError, stageOf, trades, twr, valueOn, type Book, type Ev, type Market } from './portfolio.js';

/**
 * Stage 7 criterion — a shekel portfolio with partial buys and sells, a dividend and a dollar position; every
 * number below is worked out by hand from the events (not from the code). Money is kept by currency, as the
 * broker shows it; dollars are valued at the day's rate.
 *
 *   01-05  deposit 10 000 ₪                                           ₪ 10 000
 *   01-05  buy  A (TASE, agorot) 100 @ 5000 ag, fee 10 ₪ → −5 010 ₪    ₪ 4 990
 *   01-06  buy  U 10 @ 100 $, fee 1 $ → −1 001 $: no dollars — implied deposit 1 001 × 3.5 = 3 503.5 ₪
 *   02-02  buy  A 50 @ 6000 ag, fee 10 ₪ → −3 010 ₪                    ₪ 1 980
 *   03-02  sell A 120 @ 7000 ag, fee 20 ₪ → +8 380 ₪; FIFO 100 × 50.1 + 20 × 60.2 = 6 214 → realized 2 166 ₪   ₪ 10 360
 *   03-10  dividend U 10 $                                            $ 10
 *   04-01  sell U 4 @ 120 $, fee 1 $ → +479 $; cost 4 × 100.1 = 400.4 $ → realized 78.6 $, in ₪ 479 × 3.7 − 400.4 × 3.5 = 370.9   $ 489
 *   04-01  withdraw 5 000 ₪                                           ₪ 5 360
 *   04-30  A 6500 ag, U 110 $, $ = 3.8: 5 360 + 30 × 65 + 6 × 110 × 3.8 + 489 × 3.8 = 5 360 + 1 950 + 2 508 + 1 858.2 = 11 676.2 ₪
 *   TWR (money comes at the day's close; the first day starts from the money):
 *        01-05  9 990 / 10 000
 *        01-06  (13 490 − 3 503.5) / 9 990                       (13 490 = 4 990 + 5 000 + 10 × 100 × 3.5)
 *        04-01  (11 873.3 + 5 000) / 13 490                      (11 873.3 = 5 360 + 2 040 + 2 664 + 1 809.3)
 *        04-30  11 676.2 / 11 873.3
 *        → 0.999 × 0.999650 × 1.250801 × 0.983400 − 1 = +22.8376%
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
	currency: 'ILS',
	positions: [
		{ id: 1, securityId: 101, f: 0.01, currency: 'ILS', trades: trades(A) },
		{ id: 2, securityId: 102, f: 1, currency: 'USD', trades: trades(U) }
	],
	cash: [
		{ id: 1, date: '2026-01-05', kind: 'deposit', amount: 10000, currency: 'ILS' },
		{ id: 2, date: '2026-03-10', kind: 'dividend', amount: 10, currency: 'USD' },
		{ id: 3, date: '2026-04-01', kind: 'withdraw', amount: 5000, currency: 'ILS' }
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
const usd = (d: string) => last(rates, d)!;
const market: Market = {
	price: (s, d) => last(table[s], d),
	conv: (from, to, d) => (from === to ? 1 : from === 'USD' ? usd(d) : 1 / usd(d))
};

describe('portfolio arithmetic (stage 7 criterion)', () => {
	it('FIFO: realized and what is left, in the currency and in shekels', () => {
		const a = fifo(book.positions[0].trades, 0.01);
		expect(a.realized).toBeCloseTo(2166, 6);
		expect(a.qty).toBe(30);
		expect(a.cost).toBeCloseTo(1806, 6);
		const u = fifo(book.positions[1].trades, 1);
		expect(u.realized).toBeCloseTo(78.6, 6);
		expect(u.realizedPc).toBeCloseTo(370.9, 6);
		expect(u.qty).toBe(6);
	});

	it('holdings in shekels; the US one splits into price and rate', () => {
		const a = holding(fifo(book.positions[0].trades, 0.01), 0.01, 6500, 1);
		expect(a.valuePc).toBeCloseTo(1950, 6);
		expect(a.unrealizedPc).toBeCloseTo(144, 6);
		const u = holding(fifo(book.positions[1].trades, 1), 1, 110, 3.8);
		expect(u.valuePc).toBeCloseTo(2508, 6);
		expect(u.unrealizedPc).toBeCloseTo(405.9, 6);
		expect(u.fromPrice).toBeCloseTo(207.9, 6);
		expect(u.fromFx).toBeCloseTo(198, 6);
		expect(u.avgPrice).toBe(100);
	});

	it('money by currency with the implied deposit; value; TWR', () => {
		const c = cashFlow(book, market);
		expect(c.flows).toEqual([
			{ date: '2026-01-05', value: 10000 },
			{ date: '2026-01-06', value: 3503.5 },
			{ date: '2026-04-01', value: -5000 }
		]);
		expect(c.twr.ILS).toBeCloseTo(5360, 6);
		expect(c.twr.USD).toBeCloseTo(489, 6);
		// as the broker shows: the dollar buy without dollars leaves −1 001 $ before the sale and dividend
		expect(c.raw.USD).toBeCloseTo(-512, 6);
		expect(valueOn(book, market, '2026-04-30')).toBeCloseTo(11676.2, 6);
		const t = twr(book, market, '2026-04-30');
		expect(t.series.map((s) => [s.date, Math.round(s.value * 10) / 10])).toEqual([
			['2026-01-05', 9990],
			['2026-01-06', 13490],
			['2026-04-01', 11873.3],
			['2026-04-30', 11676.2]
		]);
		expect(t.twr!).toBeCloseTo(0.2283764, 6);
		expect(t.invested).toBeCloseTo(8503.5, 6);
	});

	it('an opening comes in from outside at the day value; its profit counts from the purchase price once it is known', () => {
		const open = { ...ev(1, 'opening', '2026-01-05', 10, 100, 0), createdAt: 'a' };
		const b: Book = { currency: 'USD', positions: [{ id: 1, securityId: 102, f: 1, currency: 'USD', trades: trades([open]) }], cash: [] };
		const m: Market = { price: () => 110, conv: () => 1 };
		expect(cashFlow(b, m).flows).toEqual([{ date: '2026-01-05', value: 1000 }]);
		expect(twr(b, m, '2026-04-30').twr!).toBeCloseTo(0.1, 9);
		const f0 = fifo(trades([open]), 1);
		expect(f0.fromTransfer).toBe(true);
		expect(holding(f0, 1, 110, 1).unrealized).toBeCloseTo(100, 9);
		// the average price added later: profit from the purchase; TWR stays from the transfer
		const basis = { ...ev(2, 'basis', '2026-02-01', null, 80, null), createdAt: 'b' };
		const f1 = fifo(trades([open, basis]), 1);
		expect(f1.fromTransfer).toBe(false);
		expect(holding(f1, 1, 110, 1).unrealized).toBeCloseTo(300, 9);
		// or the whole purchase cost in the portfolio's currency
		const cost = { ...ev(3, 'basis', '2026-02-01', null, null, null), costTotal: 700, createdAt: 'c' };
		expect(holding(fifo(trades([open, cost]), 1), 1, 110, 1).unrealized).toBeCloseTo(400, 9);
	});

	it('a conversion: in a dollar portfolio it brings dollars from outside; in a shekel one it moves money', () => {
		const conv = { id: 1, date: '2026-01-05', kind: 'convert', amount: 3600, currency: 'ILS', toAmount: 1000, toCurrency: 'USD' };
		const usdBook: Book = { currency: 'USD', positions: [], cash: [conv] };
		expect(cashFlow(usdBook, market).flows).toEqual([{ date: '2026-01-05', value: 1000 }]);
		expect(cashFlow(usdBook, market).raw).toEqual({ USD: 1000 });
		const ilsBook: Book = { currency: 'ILS', positions: [], cash: [{ id: 2, date: '2026-01-05', kind: 'deposit', amount: 5000, currency: 'ILS' }, conv] };
		const c = cashFlow(ilsBook, market);
		expect(c.flows).toEqual([{ date: '2026-01-05', value: 5000 }]);
		expect(c.raw).toEqual({ ILS: 1400, USD: 1000 });
	});

	it('within a day the order of entry counts: a sale entered after a buy does not pay for it', () => {
		const at = (e: Ev, t: string) => ({ ...e, createdAt: t });
		const b: Book = {
			currency: 'ILS',
			positions: [
				{ id: 1, securityId: 101, f: 0.01, currency: 'ILS', trades: trades([at(ev(1, 'buy', '2026-01-05', 100, 5000, 0), '10:00'), at(ev(2, 'sell', '2026-01-05', 40, 5000, 0), '10:05')]) },
				{ id: 2, securityId: 102, f: 1, currency: 'ILS', trades: trades([at(ev(3, 'buy', '2026-01-05', 10, 100, 0), '10:01')]) }
			],
			cash: []
		};
		const c = cashFlow(b);
		// buy 5 000 (implied), buy 1 000 (implied), then the sale brings 2 000 in: cash 2 000, outside money 6 000
		expect(c.flows).toEqual([{ date: '2026-01-05', value: 6000 }]);
		expect(c.twr.ILS).toBeCloseTo(2000, 6);
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
