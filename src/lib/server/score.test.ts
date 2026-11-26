import { describe, expect, it } from 'vitest';
import { colorOf, grade, percentile, scoreAll, type Input } from './score.js';

/** 10 software shares with margins 5…50% and P/S 2…20, 10 retail shares with margins 1…10% and P/S 0.2…2 */
function peers(): Input[] {
	const out: Input[] = [];
	for (let i = 0; i < 10; i++) {
		out.push({ id: 100 + i, sector: 'technology', market: 'US', values: { operatingMargin: 0.05 * (i + 1), roe: 0.03 * (i + 1), revenueGrowth: 0.02 * i, ps: 2 * (i + 1), forwardPe: 10 + 3 * i, mom12: -0.1 + 0.05 * i } });
		out.push({ id: 200 + i, sector: 'consumer_cyclical', market: 'US', values: { operatingMargin: 0.01 * (i + 1), roe: 0.02 * (i + 1), revenueGrowth: 0.01 * i, ps: 0.2 * (i + 1), forwardPe: 8 + 2 * i, mom12: 0.02 * i } });
	}
	return out;
}

describe('T-034: the quant score', () => {
	it('a percentile counts the peers it beats, ties half', () => {
		expect(percentile(5, [1, 2, 3, 5, 9], true)).toBeCloseTo((3 + 0.5) / 5, 10);
		expect(percentile(5, [1, 2, 3, 5, 9], false)).toBeCloseTo((1 + 0.5) / 5, 10);
		expect([0.9, 0.7, 0.5, 0.3, 0.1].map(grade)).toEqual(['A', 'B', 'C', 'D', 'F']);
	});

	it('P/S is ranked within the sector: 8 is average for software, the worst for retail', () => {
		const all = [...peers(), { id: 1, sector: 'technology', market: 'US' as const, values: { ps: 8 } }, { id: 2, sector: 'consumer_cyclical', market: 'US' as const, values: { ps: 8 } }];
		const [soft, retail] = scoreAll(all, [1, 2], () => null);
		const p = (s: typeof soft) => s.factors.valuation.metrics.find((m) => m.key === 'ps')!.pct;
		// software, by hand: the 11 values 2, 4, …, 20 and itself 8 — 6 are dearer (10 … 20), two are 8 (half each) → (6 + 1) / 11
		expect(p(soft)).toBeCloseTo((6 + 1) / 11, 3);
		// retail: 8 is above all of 0.2 … 2 → the worst
		expect(p(retail)).toBeCloseTo(0.5 / 11, 3);
	});

	it('the best software share is green; under its SMA200 — yellow; few factors — grey', () => {
		const all = peers();
		const best = scoreAll(all, [109], () => ({ price: 110, sma200: 100, above: true }))[0];
		// margin, ROE, growth, momentum the highest; P/S and P/E the dearest — valuation F
		expect(best.factors.quality.grade).toBe('A');
		expect(best.factors.valuation.grade).toBe('F');
		expect(best.total).toBeGreaterThan(0.65);
		expect(best.color).toBe('green');
		expect(scoreAll(all, [109], () => ({ price: 90, sma200: 100, above: false }))[0].color).toBe('yellow');
		expect(colorOf(0.9, 2, true)).toBe('grey');
		expect(scoreAll(all, [999], () => null)[0].color).toBe('grey');
	});
});
