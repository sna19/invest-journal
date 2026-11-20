import { describe, expect, it } from 'vitest';
import { binomTail, cleanParams, DEFAULTS, monthIndex, quarterReturn, runModel, windowYears, type Series, type Universe } from './quarterly.js';

const START = monthIndex('2014-12');
const LAST = monthIndex('2026-10');

/** a share whose price moves by `f(year, month)` each month; volume enough to be liquid */
function series(id: number, f: (y: number, m: number) => number, o: Partial<Series> = {}): Series {
	const n = LAST - START + 1;
	const adj = new Float64Array(n);
	let p = 100;
	for (let j = 0; j < n; j++) {
		const i = START + j;
		if (j > 0) p *= 1 + f(Math.floor(i / 12), (i % 12) + 1);
		adj[j] = p;
	}
	return { id, symbol: `S${id}`, name: `Share ${id}`, market: 'US', sector: 'technology', unit: 'USD', start: START, adj, close: adj.slice(), volume: new Float64Array(n).fill(1e6), ...o };
}

const flat = series(100, () => 0);
const u = (stocks: Series[]): Universe => ({ stocks, bench: { US: flat, IL: flat }, lastMonth: LAST, usdIls: 3.7, builtAt: '' });

describe('quarterly model 10a', () => {
	it('the window: the last 10 complete first quarters, for the next year', () => {
		expect(windowYears(LAST, 1, 10)).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
		expect(windowYears(LAST, 4, 10).at(-1)).toBe(2025);
	});

	it('a quarter is the close before it to its last close', () => {
		// +1% every month in Q1 (Jan, Feb, Mar), flat otherwise: Q1 = 1.01³ − 1
		const s = series(1, (_, m) => (m <= 3 ? 0.01 : 0));
		expect(quarterReturn(s, 2020, 1)).toBeCloseTo(1.01 ** 3 - 1, 10);
		expect(quarterReturn(s, 2020, 2)).toBeCloseTo(0, 10);
	});

	it('variant A keeps shares that rose in K of 10 years and sorts by the mean', () => {
		const every = series(1, (_, m) => (m <= 3 ? 0.01 : -0.01));
		const nineOfTen = series(2, (y, m) => (m <= 3 ? (y === 2020 ? -0.05 : 0.03) : 0), { sector: 'energy' });
		const never = series(3, (_, m) => (m <= 3 ? -0.01 : 0.02));
		const r = runModel(u([every, nineOfTen, never]), 'A', 1, DEFAULTS);
		expect(r.universe).toBe(3);
		expect(r.passed).toBe(2);
		expect(r.candidates.map((c) => c.symbol)).toEqual(['S2', 'S1']);
		const c = r.candidates[0];
		expect(c.up).toBe(9);
		expect(c.results).toHaveLength(10);
		expect(c.worst).toBeCloseTo((0.95 ** 3 - 1) * 100, 1);
		// K = 10 drops the share with one bad year
		expect(runModel(u([every, nineOfTen, never]), 'A', 1, { ...DEFAULTS, k: 10 }).candidates.map((c) => c.symbol)).toEqual(['S1']);
	});

	it('variant B counts over the market: a share that only follows a rising market fails', () => {
		const market = series(100, (_, m) => (m <= 3 ? 0.02 : 0));
		const follower = series(1, (_, m) => (m <= 3 ? 0.02 : 0));
		const beater = series(2, (_, m) => (m <= 3 ? 0.03 : 0), { sector: 'energy' });
		const uni: Universe = { ...u([follower, beater]), bench: { US: market, IL: market } };
		expect(runModel(uni, 'A', 1, DEFAULTS).candidates).toHaveLength(2);
		expect(runModel(uni, 'B', 1, DEFAULTS).candidates.map((c) => c.symbol)).toEqual(['S2']);
	});

	it('at most 2 per sector and 7 per market; illiquid and cheap shares stay out', () => {
		const many = Array.from({ length: 5 }, (_, i) => series(i + 1, (_, m) => (m <= 3 ? 0.01 * (i + 1) : 0)));
		const r = runModel(u(many), 'A', 1, DEFAULTS);
		expect(r.candidates).toHaveLength(2);
		expect(r.capped).toBe(3);
		const thin = series(9, (_, m) => (m <= 3 ? 0.05 : 0), { volume: new Float64Array(LAST - START + 1).fill(10), sector: 'x' });
		const cheap = series(10, (_, m) => (m <= 3 ? 0.05 : 0), { sector: 'y', adj: new Float64Array(LAST - START + 1).fill(1), close: new Float64Array(LAST - START + 1).fill(1) });
		const r2 = runModel(u([thin, cheap]), 'A', 1, DEFAULTS);
		expect(r2.illiquid).toBe(2);
	});

	it('chance: N × P(Binomial(10, p) ≥ K)', () => {
		expect(binomTail(10, 10, 0.5)).toBeCloseTo(1 / 1024, 10);
		expect(binomTail(10, 9, 0.5)).toBeCloseTo(11 / 1024, 10);
		expect(binomTail(10, 0, 0.3)).toBeCloseTo(1, 10);
	});

	it('the check without peeking measures the chosen in years they were not chosen on', () => {
		const every = series(1, (_, m) => (m <= 3 ? 0.01 : 0));
		const r = runModel(u([every]), 'A', 1, DEFAULTS);
		expect(r.walk.map((w) => w.year)).toEqual([2024, 2025, 2026]);
		expect(r.walk.every((w) => w.picked === 1 && w.pickedUp === 1)).toBe(true);
	});

	it('one security\'s block (T-020): its years next to the market, its place among the candidates', async () => {
		const { securityResult } = await import('./quarterly.js');
		const every = series(1, (_, m) => (m <= 3 ? 0.01 : 0));
		const never = series(3, (_, m) => (m <= 3 ? -0.01 : 0.02), { sector: 'energy' });
		const r = securityResult(u([every, never]), 1, 'A', 1, DEFAULTS)!;
		expect(r).toMatchObject({ rank: 1, passed: true, inUniverse: true, up: 10, forYear: 2027 });
		expect(r.price[0]).toBeCloseTo((1.01 ** 3 - 1) * 100, 1);
		expect(r.bench.every((b) => b === 0)).toBe(true);
		const r3 = securityResult(u([every, never]), 3, 'A', 1, DEFAULTS)!;
		expect(r3).toMatchObject({ rank: null, passed: false, up: 0 });
		expect(securityResult(u([every]), 99, 'A', 1, DEFAULTS)).toBeNull();
	});

	it('funds labelled as shares are not shares', async () => {
		const { isFund } = await import('./quarterly.js');
		expect(isFund({ kind: 'etf', industry: null, name: 'Invesco DB Gold Double Long ETN' })).toBe(true);
		expect(isFund({ kind: 'stock', industry: 'Asset Management', name: 'BNY Mellon High Yield Strategies Fund' })).toBe(true);
		expect(isFund({ kind: 'stock', industry: 'Asset Management', name: 'BlackRock, Inc.' })).toBe(false);
		expect(isFund({ kind: null, industry: null, name: 'Applied Materials' })).toBe(false);
	});

	it('parameters are kept in their limits', () => {
		expect(cleanParams({ k: '12', years: '10', count: 0, sort: 'worst', compareWith: 'sector' })).toMatchObject({ k: 10, count: 1, sort: 'worst', compareWith: 'sector' });
	});
});
