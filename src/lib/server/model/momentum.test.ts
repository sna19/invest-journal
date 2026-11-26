import { describe, expect, it } from 'vitest';
import { choose, cleanMParams, MDEFAULTS, metrics, monthAdd, runBases, runVariant, signal, simulate, windowMonths, type Series } from './momentum.js';

/** five funds with simple monthly growth rates; SPY 1%, BIL 0.2% */
function series(): Series {
	const rate: Record<string, (i: number) => number> = {
		AAA: () => 0.03,
		BBB: (i) => (i < 30 ? 0.02 : -0.02),
		CCC: () => 0.005,
		DDD: (i) => (i < 30 ? -0.01 : 0.04),
		SPY: () => 0.01,
		BIL: () => 0.002
	};
	const s: Series = new Map();
	for (const [k, f] of Object.entries(rate)) {
		const m = new Map<string, number>();
		let v = 100;
		for (let i = 0; i < 60; i++) {
			m.set(monthAdd('2020-01', i), Math.round(v * 1e6) / 1e6);
			v *= 1 + f(i);
		}
		s.set(k, m);
	}
	return s;
}
const P = cleanMParams({ universe: ['AAA', 'BBB', 'CCC', 'DDD', 'SPY'], lookback: 12, skip: 1, top: 2, rebalance: 'month', years: 3, commissionPct: 0, taxPct: 0 });

describe('T-017: country momentum', () => {
	it('the choice at two rebalances matches the hand calculation', () => {
		const s = series();
		// 2022-01: the signal runs 2020-11 → 2021-11 (12 months, the last month 2021-12 left out) — all in the first phase
		const a = choose(s, P, '2022-01', 'A');
		const hand = (k: string, from: string, to: string) => s.get(k)!.get(to)! / s.get(k)!.get(from)! - 1;
		expect(a.ranking.map((x) => x.symbol)).toEqual(['AAA', 'BBB', 'SPY', 'CCC', 'DDD']);
		expect(a.ranking[0].signal).toBeCloseTo(hand('AAA', '2020-11', '2021-11'), 10);
		expect(a.picks.map((x) => x.symbol)).toEqual(['AAA', 'BBB']);
		// 2024-01: 2022-11 → 2023-11, all in the second phase: DDD +4%/mo leads, BBB falls below BIL
		const b = choose(s, P, '2024-01', 'B');
		expect(b.ranking.slice(0, 2).map((x) => x.symbol)).toEqual(['DDD', 'AAA']);
		expect(b.ranking.at(-1)!.symbol).toBe('BBB');
		expect(b.picks[0].signal).toBeCloseTo(1.04 ** 12 - 1, 4);
		expect(b.safeSignal).toBeCloseTo(1.002 ** 12 - 1, 4);
		expect(b.picks.every((x) => !x.toSafe)).toBe(true);
		// B with N 5: the last two (CCC +0.5%/mo is above BIL; BBB is not) — BBB's part goes to the refuge
		const b5 = choose(s, { ...P, top: 5 }, '2024-01', 'B');
		expect(b5.picks.filter((x) => x.toSafe).map((x) => x.symbol)).toEqual(['BBB']);
	});

	it("the SPY curve is SPY's adjusted close, to the cent", () => {
		const s = series();
		const months = windowMonths(s, P, '2024-12');
		const { spy } = runBases(s, P, months);
		const a0 = s.get('SPY')!.get(monthAdd(months[0], -1))!;
		for (const pt of spy.curve.slice(1)) expect(pt.value).toBeCloseTo(s.get('SPY')!.get(pt.month)! / a0, 8);
	});

	it('a variant holds its picks: two months by hand', () => {
		const s = series();
		const months = ['2022-01', '2022-02'];
		const r = runVariant(s, P, months, 'A');
		const g = (k: string, m: string) => s.get(k)!.get(m)! / s.get(k)!.get(monthAdd(m, -1))! - 1;
		expect(r.returns[0]).toBeCloseTo((g('AAA', '2022-01') + g('BBB', '2022-01')) / 2, 10);
		expect(r.holdings[0].weights).toEqual({ AAA: 0.5, BBB: 0.5 });
		expect(signal(s.get('AAA'), '2022-01', 12, 1)).toBeCloseTo(1.03 ** 12 - 1, 4);
	});

	it('costs: the commission on what is traded and the tax on a realized gain', () => {
		const s: Series = new Map([
			['X', new Map([['2020-01', 100], ['2020-02', 100], ['2020-03', 150], ['2020-04', 150]])],
			['Y', new Map([['2020-01', 100], ['2020-02', 100], ['2020-03', 100], ['2020-04', 100]])]
		]);
		const r = simulate(s, ['2020-02', '2020-03', '2020-04'], (m): Record<string, number> => (m === '2020-04' ? { Y: 1 } : { X: 1 }), () => true, { commissionPct: 1, taxPct: 25, safe: 'BIL' });
		// buy 1 → 1% commission → 0.99 in X (cost basis 1, the commission in it); ×1.5 → 1.485; sell all: gain 0.485 × 25% = 0.12125, trade 2.97 × 1% = 0.0297
		expect(r.curve.at(-1)!.value).toBeCloseTo(1.485 - 0.12125 - 0.0297, 6);
	});

	it('metrics: the year return, the deepest fall', () => {
		const m = metrics([0.1, -0.5, 0.2], [0, 0, 0]);
		expect(m.maxDrawdown).toBeCloseTo(-0.5, 10);
		expect(m.cagr).toBeCloseTo((1.1 * 0.5 * 1.2) ** 4 - 1, 10);
		expect(cleanMParams({ lookback: 99, top: 0 }).lookback).toBe(MDEFAULTS.lookback);
	});
});
