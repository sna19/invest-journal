import { describe, expect, it } from 'vitest';
import { byLowerBound, horizonBucket, level, score, split, wilson } from './stats.js';

const rows = (hits: number, n: number, signalType = 'recommendation', status = 'closed') =>
	Array.from({ length: n }, (_, i) => ({ status, signalType, outcome: i < hits ? 'hit' : 'miss', excessPct: i < hits ? 5 : -3 }));

describe('Wilson interval (section 7)', () => {
	it('7 of 10 → about 40–89%', () => {
		const [lo, hi] = wilson(7, 10);
		expect(Math.round(lo * 100)).toBe(40);
		expect(Math.round(hi * 100)).toBe(89);
	});
	it('edges: 0 of n and n of n stay inside 0..1', () => {
		expect(wilson(0, 5)[0]).toBe(0);
		expect(wilson(5, 5)[1]).toBe(1);
		expect(wilson(0, 0)).toEqual([0, 0]);
	});
});

describe('thresholds', () => {
	it('below 10 — few (count only), 10–29 — preliminary, 30+ — firm', () => {
		expect([level(0), level(9), level(10), level(29), level(30)]).toEqual(['none', 'few', 'prelim', 'prelim', 'firm']);
		const s = score(rows(7, 9));
		expect(s).toMatchObject({ n: 9, hits: 7, level: 'few' });
	});
});

describe('sorting by the lower bound', () => {
	it('2 of 2 stands below 20 of 30', () => {
		const list = [
			{ name: 'two of two', score: score(rows(2, 2)) },
			{ name: 'twenty of thirty', score: score(rows(20, 30)) },
			{ name: 'nothing yet', score: score([]) }
		].sort(byLowerBound);
		expect(list.map((x) => x.name)).toEqual(['twenty of thirty', 'two of two', 'nothing yet']);
	});
});

describe('rating parts (section 17)', () => {
	it('news and early closes are out of the rating; news does not change it', () => {
		const base = rows(7, 10);
		const withNews = [...base, ...rows(0, 5, 'news'), ...rows(3, 3, 'opinion', 'closed_early')];
		const a = split(base);
		const b = split(withNews);
		expect(score(b.rated)).toEqual(score(a.rated));
		expect(b.news).toHaveLength(5);
		expect(b.early).toHaveLength(3);
	});
	it('mean, median, best and worst excess', () => {
		const s = score([
			{ outcome: 'hit', excessPct: 10 },
			{ outcome: 'miss', excessPct: -4 },
			{ outcome: 'hit', excessPct: 2 },
			{ outcome: 'miss', excessPct: -1 }
		]);
		expect(s).toMatchObject({ meanExcess: 1.75, medianExcess: 0.5, best: 10, worst: -4 });
	});
	it('horizon buckets: up to 3 months, 3–6, longer', () => {
		expect(horizonBucket('2026-01-01', '2026-04-01')).toBe('short');
		expect(horizonBucket('2026-01-01', '2026-07-01')).toBe('mid');
		expect(horizonBucket('2026-01-01', '2027-01-01')).toBe('long');
	});
});
