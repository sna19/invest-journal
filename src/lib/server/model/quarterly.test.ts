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
	return { id, symbol: `S${id}`, name: `Share ${id}`, market: 'US', exchange: 'NASDAQ', capUsd: null, shares: null, sector: 'technology', unit: 'USD', start: START, adj, close: adj.slice(), volume: new Float64Array(n).fill(1e6), ...o };
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

	it('market cap (T-021): groups by bounds or by rank in the own market; the chance is counted after the filter', async () => {
		const { capAt } = await import('./quarterly.js');
		const big = series(1, (_, m) => (m <= 3 ? 0.01 : 0), { capUsd: 300e9, shares: 3e9 });
		const mid = series(2, (_, m) => (m <= 3 ? 0.02 : 0), { capUsd: 5e9, shares: 5e7, sector: 'energy' });
		const tiny = series(3, (_, m) => (m <= 3 ? 0.03 : 0), { capUsd: 1e8, shares: 1e6, sector: 'utilities' });
		const nocap = series(4, (_, m) => (m <= 3 ? 0.04 : 0), { sector: 'x' });
		const uni = u([big, mid, tiny, nocap]);
		const all = runModel(uni, 'A', 1, DEFAULTS);
		expect(all.capCounts).toEqual({ mega: 1, mid: 1, micro: 1, unknown: 1 });
		expect(all.candidates).toHaveLength(4);
		const large = runModel(uni, 'A', 1, cleanParams({ capGroups: 'mega,large' }));
		expect(large.candidates.map((c) => c.symbol)).toEqual(['S1']);
		expect(large).toMatchObject({ universe: 1, capOut: 3 });
		expect(large.candidates[0]).toMatchObject({ capGroup: 'mega', capUsd: 300e9 });
		// by rank in the market: of three with a cap, the biggest is the top 20%… of 3 → 1 share
		const top = runModel(uni, 'A', 1, cleanParams({ capMode: 'rel', capGroups: 'top' }));
		expect(top.candidates.map((c) => c.symbol)).toEqual(['S1']);
		// the bounds can move: «mega» from 400B leaves S1 large
		expect(runModel(uni, 'A', 1, cleanParams({ capBounds: '400e9,10e9,2e9,0.3e9' })).candidates.find((c) => c.symbol === 'S1')!.capGroup).toBe('large');
		// the cap at an earlier month: shares × the close then
		expect(capAt(big, START + 1, 3.7)).toBeCloseTo(3e9 * big.close[1], 0);
	});

	it('the placebo (T-010): no seasonality reads as chance, a built-in one as a signal', () => {
		// 300 shares; noise: every quarter up or down at random
		let seed = 11;
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
		const noise = Array.from({ length: 300 }, (_, i) => series(i + 1, () => rnd() * 0.06, { sector: `s${i}` }));
		const n = runModel(u(noise), 'A', 1, { ...DEFAULTS, k: 8 });
		expect(n.placebo.runs).toBe(100);
		expect(n.placebo.verdict).toBe('chance');
		// the same, but 20 shares rise in every first quarter
		const seasonal = noise.map((s, i) => (i < 20 ? series(i + 1, (_, m) => (m <= 3 ? 0.02 + rnd() * 0.01 : rnd() * 0.06), { sector: `s${i}` }) : s));
		const r = runModel(u(seasonal), 'A', 1, { ...DEFAULTS, k: 8 });
		expect(r.placebo.real).toBeGreaterThan(r.placebo.mean + 10);
		expect(r.placebo.verdict).toBe('signal');
		// the same seed: the same placebo on every request
		expect(runModel(u(seasonal), 'A', 1, { ...DEFAULTS, k: 8 }).placebo).toEqual(r.placebo);
	});

	it('variant C (T-011): «+3% every year» stands above «+40% once and about zero otherwise»', async () => {
		const { tScore } = await import('./quarterly.js');
		// a Q1 of +3% is +0.99%/month; +40% once is +11.87%/month in Q1 of 2020
		const steady = series(1, (y, m) => (m <= 3 ? 1.03 ** (1 / 3) - 1 + (y % 2 ? 0.001 : -0.001) : 0));
		const once = series(2, (y, m) => (m <= 3 ? (y === 2020 ? 1.4 ** (1 / 3) - 1 : y % 2 ? 0.001 : -0.001) : 0), { sector: 'energy' });
		const r = runModel(u([steady, once]), 'C', 1, DEFAULTS);
		expect(r.candidates.map((c) => c.symbol)).toEqual(['S1', 'S2']);
		expect(r.candidates[0].score!).toBeGreaterThan(2);
		expect(r.candidates[1].score!).toBeLessThan(1);
		// the mean of «once» is larger — the score is not the mean
		expect(r.candidates[1].mean).toBeGreaterThan(r.candidates[0].mean);
		expect(r.passed).toBe(1);
		// shrunk towards zero for few years: the same steady excess scores less over 4 years than over 10
		expect(tScore([0.03, 0.02, 0.04, 0.03])!).toBeLessThan(tScore([0.03, 0.02, 0.04, 0.03, 0.03, 0.02, 0.04, 0.03, 0.03, 0.03])!);
		expect(tScore([0.03, 0.03])).toBeNull();
		// the placebo runs for C as well, with its own seed
		expect(r.placebo.runs).toBe(100);
	});

	it('the costs (T-012): the fee and the tax; «hold if chosen again» spares the trades of a share chosen every quarter', async () => {
		const { costRun } = await import('./quarterly.js');
		// +3% every month: chosen in every quarter by A (it rose every year)
		const always = series(1, () => 0.03);
		const r = costRun(u([always]), 'A', { ...DEFAULTS, k: 7, count: 1 }, 12);
		expect(r.quarters).toHaveLength(12);
		expect(r.quarters.every((q) => q.picked === 1)).toBe(true);
		expect(r.start).toBe(3000);
		// without costs: 1.03³ a quarter → (1.03¹²) a year
		expect(r.gross).toBeCloseTo((1.03 ** 12 - 1) * 100, 1);
		// with the rule: bought once, sold once — two fees; without: 24
		expect(r.hold.kept).toBe(11);
		expect(r.noHold.kept).toBe(0);
		expect(r.noHold.fees).toBeGreaterThan(r.hold.fees * 5);
		// the tax: without the rule paid every year; with it — all at the end, on the same gain, so less money is lost
		expect(r.hold.taxes).toBeGreaterThan(0);
		expect(r.hold.cagr!).toBeLessThan(r.gross!);
		expect(r.hold.cagr!).toBeGreaterThan(r.noHold.cagr!);
		expect(r.hold.turnover).toBe(0);
		// no fee, no tax: the books are the market itself
		const free = costRun(u([always]), 'A', { ...DEFAULTS, k: 7, count: 1, commissionPct: 0, commissionMinUsd: 0, taxPct: 0 }, 12);
		expect(free.hold.cagr).toBeCloseTo(free.gross!, 1);
		expect(free.noHold.cagr).toBeCloseTo(free.gross!, 1);
	});

	it('T-018: SMA by monthly closes, the trend filter and the exit, the months of a quarter, the usual quarter', async () => {
		const q = await import('./quarterly.js');
		// closes 1, 2, …: SMA 10 at month i is the mean of the 10 closes up to it
		const lin = series(1, () => 0);
		for (let j = 0; j < lin.close.length; j++) lin.close[j] = lin.adj[j] = j + 1;
		const i = START + 50;
		expect(q.smaMonths(lin, i, 10)).toBeCloseTo((51 + 50 + 49 + 48 + 47 + 46 + 45 + 44 + 43 + 42) / 10, 10);
		expect(q.smaMonths(lin, i, 3)).toBeCloseTo(50, 10);
		expect(q.trendOk(lin, i, 'price_sma10')).toBe(true);
		expect(q.trendOk(lin, i, 'sma3_sma10')).toBe(true);
		expect(q.vsSma10(lin, i)).toBeCloseTo((51 / 46.5 - 1) * 100, 1);
		// a falling share fails both filters
		const fall = series(2, () => -0.02);
		expect(q.trendOk(fall, i, 'price_sma10')).toBe(false);
		expect(q.trendOk(fall, i, 'none')).toBe(true);
		// the exit: a close below SMA 3 at the end of the 1st month sells — the 2nd and 3rd months are not held
		const dip = series(3, (y, m) => (y === 2020 && m === 1 ? -0.1 : y === 2020 && m <= 3 ? 0.2 : 0));
		const held = q.quarterPath(dip, 2020, 1, 'none');
		const out = q.quarterPath(dip, 2020, 1, 'sma3');
		expect(held.ret).toBeCloseTo(0.9 * 1.2 * 1.2 - 1, 10);
		expect(out.exitMonth).toBe(1);
		expect(out.ret).toBeCloseTo(-0.1, 10);
		// the months of a quarter
		const m = q.monthReturns(dip, 2020, 1);
		expect(m.map((x) => Math.round(x * 100) / 100)).toEqual([-0.1, 0.2, 0.2]);
		// the usual quarter: +1% a month in Q1 only → Q1 ≈ 3.03%, the year's mean of four ≈ 0.76%
		const s1 = series(4, (_, mo) => (mo <= 3 ? 0.01 : 0));
		const own = q.ownQuarter(s1, [2018, 2019, 2020], 1, LAST);
		expect(own.mean!).toBeCloseTo((1.01 ** 3 - 1) * 0.75 * 100, 1);
		expect(own.up).toBe(3);
		// a share with a steady trend: every quarter alike — no seasonality left
		const trend = series(5, () => 0.03);
		expect(Math.abs(q.ownQuarter(trend, [2018, 2019, 2020], 4, LAST).mean!)).toBeLessThan(0.01);
	});

	it('T-018 variant D picks a quarter better than the share\'s own usual quarter, not a share in a trend', () => {
		const trend = series(1, () => 0.03);
		const seasonal = series(2, (_, m) => (m <= 3 ? 0.03 : 0), { sector: 'energy' });
		const a = runModel(u([trend, seasonal]), 'A', 1, DEFAULTS).candidates.map((c) => c.symbol);
		const d = runModel(u([trend, seasonal]), 'D', 1, DEFAULTS).candidates.map((c) => c.symbol);
		expect(a).toContain('S1');
		expect(d).toEqual(['S2']);
	});

	it('T-013: the reason labels and variant G — only shares with a label', async () => {
		const q = await import('./quarterly.js');
		const years = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
		// reports every February, May, August, November; a dividend every March
		const ev = { earnings: new Set<number>(), dividends: new Set<number>() };
		for (const y of years) {
			for (const m of [1, 4, 7, 10]) ev.earnings.add(y * 12 + m);
			ev.dividends.add(y * 12 + 2);
		}
		const a = series(1, (_, m) => (m <= 3 ? 0.01 : 0), { events: ev });
		expect(q.reasonLabels(a, 1, years, new Set())).toEqual({ earnings: true, dividend: true, sector: false });
		expect(q.reasonLabels(a, 2, years, new Set())).toEqual({ earnings: true, dividend: false, sector: false });
		// no calendar loaded: unknown
		expect(q.reasonLabels(series(2, () => 0), 1, years, new Set(['technology'])).earnings).toBeNull();
		// the sector: five shares beating a flat market in Q1 every year
		const sec = [3, 4, 5, 6, 7].map((i) => series(i, (_, m) => (m <= 3 ? 0.01 : 0), { sector: 'energy' }));
		const rows = sec.map((s) => ({ s, r: years.map((y) => q.quarterReturn(s, y, 1)) }));
		expect([...q.seasonalSectors(u(sec), rows, years, 1, 9)]).toEqual(['energy']);
		// G: the same seasonal shares; only the one with a calendar label (or a seasonal sector) stays
		const lone = series(8, (_, m) => (m <= 3 ? 0.012 : 0), { sector: 'utilities' });
		const withCal = series(9, (_, m) => (m <= 3 ? 0.011 : 0), { sector: 'industrials', events: ev });
		const g = runModel(u([lone, withCal]), 'G', 1, DEFAULTS).candidates.map((c) => c.symbol);
		const c = runModel(u([lone, withCal]), 'C', 1, DEFAULTS).candidates.map((c) => c.symbol);
		expect(c).toContain('S8');
		expect(g).toEqual(['S9']);
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
