import { describe, expect, it } from 'vitest';
import { corrOf, covariance, eigSym, labelOf, mds, mdsPlace, minVariance, riskParity, stats } from './risk.js';

/** four weekly series, 104 weeks: A and B move together, C is half of A plus noise, D is its own */
function series() {
	let seed = 5;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
	const A: number[] = [];
	const B: number[] = [];
	const C: number[] = [];
	const D: number[] = [];
	for (let t = 0; t < 104; t++) {
		const m = rnd() * 0.06;
		A.push(m + rnd() * 0.01);
		B.push(m + rnd() * 0.012);
		C.push(0.5 * m + rnd() * 0.03);
		D.push(rnd() * 0.02);
	}
	return [A, B, C, D];
}

describe('the risk arithmetic (T-023)', () => {
	it('covariance, volatility and risk shares of 4 securities as by hand', () => {
		const s = series();
		const { cov, delta } = covariance(s);
		// by hand: the sample covariance (n − 1), Ledoit–Wolf's δ on the biased one, Σij = 52 · ((1 − δ)·Sij + δ·r̄·σi·σj)
		const T = 104;
		const N = 4;
		const mu = s.map((x) => x.reduce((a, b) => a + b, 0) / T);
		const S = s.map((x, i) => s.map((y, j) => x.reduce((n, _, t) => n + (x[t] - mu[i]) * (y[t] - mu[j]), 0) / (T - 1)));
		const Sb = S.map((r) => r.map((v) => (v * (T - 1)) / T));
		const mb = Sb.reduce((n, r, i) => n + r[i], 0) / N;
		let d2 = 0;
		for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) d2 += (Sb[i][j] - (i === j ? mb : 0)) ** 2;
		d2 /= N;
		let b2 = 0;
		for (let t = 0; t < T; t++) {
			let f = 0;
			for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) f += ((s[i][t] - mu[i]) * (s[j][t] - mu[j]) - Sb[i][j]) ** 2;
			b2 += f / N;
		}
		b2 = Math.min(b2 / (T * T), d2);
		const d = b2 / d2;
		expect(delta).toBeCloseTo(d, 10);
		// the constant-correlation target: the mean of the six correlations
		const sdv = S.map((r, i) => Math.sqrt(r[i]));
		let rs = 0;
		for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) rs += S[i][j] / (sdv[i] * sdv[j]);
		const rbar = rs / 6;
		const hand = S.map((r, i) => r.map((v, j) => 52 * (i === j ? v : (1 - d) * v + d * rbar * sdv[i] * sdv[j])));
		for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) expect(cov[i][j]).toBeCloseTo(hand[i][j], 12);
		// the portfolio: 40% A, 20% B, 20% C, 10% D, 10% cash
		const w = [0.4, 0.2, 0.2, 0.1];
		let v = 0;
		for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) v += w[i] * w[j] * hand[i][j];
		const st = stats(cov, w, 0);
		expect(st.vol).toBeCloseTo(Math.sqrt(v), 10);
		const rcHand = w.map((wi, i) => (wi * hand[i].reduce((n, x, j) => n + x * w[j], 0)) / v);
		st.rc.forEach((x, i) => expect(x).toBeCloseTo(rcHand[i], 10));
		expect(st.bets).toBeCloseTo(1 / rcHand.reduce((n, x) => n + x * x, 0), 10);
		// the job's tie: the portfolio's correlation with A
		const covPA = hand[0].reduce((n, x, j) => n + x * w[j], 0);
		expect(st.job!).toBeCloseTo(covPA / Math.sqrt(v * hand[0][0]), 10);
		// correlations: A–B high, D low
		const c = corrOf(cov);
		expect(c[0][1]).toBeGreaterThan(0.8);
		expect(Math.abs(c[0][3])).toBeLessThan(0.3);
	});

	it('a missing stretch of history is handled pair by pair; the matrix stays positive', () => {
		const s = series();
		s[3] = s[3].map((v, t) => (t < 60 ? NaN : v));
		const { cov } = covariance(s);
		expect(eigSym(cov).values.every((x) => x > -1e-12)).toBe(true);
		expect(cov[3][3]).toBeGreaterThan(0);
	});

	it('the map puts the tied ones together; a new one lands next to its twin', () => {
		const s = series();
		const { cov } = covariance(s);
		const c = corrOf(cov);
		const { coords, basis } = mds(c, [0.4, 0.2, 0.2, 0.1]);
		const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
		expect(dist(coords[0], coords[1])).toBeLessThan(dist(coords[0], coords[3]));
		// the largest weight (A) lies on the positive side of both axes: the same picture every time
		expect(coords[0][0]).toBeGreaterThanOrEqual(0);
		// a copy of B placed by its correlations sits where B is
		const p = mdsPlace(basis, c[1]);
		expect(dist(p, coords[1])).toBeLessThan(0.05);
	});

	it('minimal risk and risk parity keep the cap; the labels', () => {
		const s = series();
		const { cov } = covariance(s);
		const mv = minVariance(cov, 0.4);
		expect(mv.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
		expect(Math.max(...mv)).toBeLessThanOrEqual(0.4 + 1e-9);
		expect(stats(cov, mv).vol).toBeLessThanOrEqual(stats(cov, [0.25, 0.25, 0.25, 0.25]).vol + 1e-9);
		const rp = riskParity(cov, 1);
		const r = stats(cov, rp).rc;
		r.forEach((x) => expect(x).toBeCloseTo(0.25, 2));
		const a = { vol: 0.2, rc: [], bets: 3, job: null };
		expect(labelOf(a, { ...a, vol: 0.21 }, 0.9)).toBe('duplicates');
		expect(labelOf(a, { ...a, vol: 0.18 }, 0.2)).toBe('reduces');
		expect(labelOf(a, { ...a, vol: 0.2 }, 0.5)).toBe('neutral');
		expect(labelOf(a, { ...a, vol: 0.2 }, 0.72)).toBe('duplicates');
		// more bets but much more swing (a leveraged fund): not «reduces»
		expect(labelOf(a, { ...a, vol: 0.26, bets: 3.8 }, 0.6)).toBe('neutral');
		expect(labelOf(a, { ...a, vol: 0.201, bets: 3.5 }, 0.5)).toBe('reduces');
	});
});
