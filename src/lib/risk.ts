/**
 * T-023 «Карта риска и «Что если?»» — the arithmetic (Markowitz), shared by the server and the screen: the
 * simulator recomputes «было → стало» on the phone without asking the server again.
 *
 * Returns are weekly, in the portfolio's currency. The covariance is estimated pair by pair over the weeks both
 * securities have; the correlations are shrunk toward their mean (the constant-correlation target) with Ledoit–Wolf's
 * intensity (measured on the portfolio's securities with the whole window); made positive semi-definite.
 * Everything annualised by 52 weeks.
 */

export type Matrix = number[][];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/** the sample covariance of two series over the weeks both have (NaN — a missing week); null if under 8 */
export function pairCov(a: number[], b: number[]): number | null {
	const xs: number[] = [];
	const ys: number[] = [];
	for (let t = 0; t < a.length; t++) if (Number.isFinite(a[t]) && Number.isFinite(b[t])) (xs.push(a[t]), ys.push(b[t]));
	if (xs.length < 8) return null;
	const mx = mean(xs);
	const my = mean(ys);
	let s = 0;
	for (let i = 0; i < xs.length; i++) s += (xs[i] - mx) * (ys[i] - my);
	return s / (xs.length - 1);
}

/**
 * Ledoit–Wolf (2004) toward m·I on complete data X (T weeks × N): the shrinkage intensity δ in [0, 1].
 * Σ* = δ·m·I + (1 − δ)·S.
 */
export function ledoitWolfIntensity(X: Matrix): number {
	const T = X.length;
	const N = X[0]?.length ?? 0;
	if (T < 3 || N < 2) return 0;
	const mu = Array.from({ length: N }, (_, j) => mean(X.map((r) => r[j])));
	const Y = X.map((r) => r.map((v, j) => v - mu[j]));
	const S = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => Y.reduce((n, r) => n + r[i] * r[j], 0) / T));
	const m = S.reduce((n, r, i) => n + r[i], 0) / N;
	let d2 = 0;
	for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) d2 += (S[i][j] - (i === j ? m : 0)) ** 2;
	d2 /= N;
	let b2 = 0;
	for (const r of Y) {
		let f = 0;
		for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) f += (r[i] * r[j] - S[i][j]) ** 2;
		b2 += f / N;
	}
	b2 /= T * T;
	b2 = Math.min(b2, d2);
	return d2 > 0 ? b2 / d2 : 0;
}

/** eigen decomposition of a symmetric matrix (Jacobi): values and vectors (columns) */
export function eigSym(A: Matrix): { values: number[]; vectors: Matrix } {
	const n = A.length;
	const a = A.map((r) => [...r]);
	const v: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)));
	for (let sweep = 0; sweep < 100; sweep++) {
		let off = 0;
		for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
		if (off < 1e-22) break;
		for (let p = 0; p < n; p++)
			for (let q = p + 1; q < n; q++) {
				if (Math.abs(a[p][q]) < 1e-300) continue;
				const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
				const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
				const c = 1 / Math.sqrt(t * t + 1);
				const s = t * c;
				for (let k = 0; k < n; k++) {
					const akp = a[k][p];
					const akq = a[k][q];
					a[k][p] = c * akp - s * akq;
					a[k][q] = s * akp + c * akq;
				}
				for (let k = 0; k < n; k++) {
					const apk = a[p][k];
					const aqk = a[q][k];
					a[p][k] = c * apk - s * aqk;
					a[q][k] = s * apk + c * aqk;
				}
				for (let k = 0; k < n; k++) {
					const vkp = v[k][p];
					const vkq = v[k][q];
					v[k][p] = c * vkp - s * vkq;
					v[k][q] = s * vkp + c * vkq;
				}
			}
	}
	return { values: a.map((r, i) => r[i]), vectors: v };
}

/** the nearest positive semi-definite matrix by clipping negative eigenvalues */
function psd(A: Matrix): Matrix {
	const { values, vectors } = eigSym(A);
	if (values.every((x) => x >= 0)) return A;
	const n = A.length;
	const l = values.map((x) => Math.max(x, 0));
	return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => vectors[i].reduce((s, _, k) => s + vectors[i][k] * l[k] * vectors[j][k], 0)));
}

/**
 * The annualised covariance of weekly series (NaN — a missing week): pairwise; Σ*ij = (1 − δ)·Sij + δ·r̄·σi·σj off the
 * diagonal (r̄ — the mean correlation of `base`, δ — Ledoit–Wolf's intensity on its securities without gaps), the
 * variances unchanged; positive semi-definite. A pair with under 8 common weeks counts as uncorrelated.
 */
export function covariance(series: number[][], base?: number[]): { cov: Matrix; delta: number } {
	const N = series.length;
	const S: Matrix = Array.from({ length: N }, () => new Array(N).fill(0));
	for (let i = 0; i < N; i++)
		for (let j = i; j < N; j++) {
			const c = pairCov(series[i], series[j]);
			S[i][j] = S[j][i] = c ?? 0;
		}
	// the target and the intensity from `base` (the portfolio's own securities): a tried one does not move them
	const pool = base?.length ? base : series.map((_, i) => i);
	const full = pool.filter((i) => series[i].every((v) => Number.isFinite(v)));
	const T = series[0]?.length ?? 0;
	const delta = full.length >= 2 ? ledoitWolfIntensity(Array.from({ length: T }, (_, t) => full.map((i) => series[i][t]))) : 0;
	// toward the mean correlation (Ledoit–Wolf's constant-correlation target): the variances stay, the correlations
	// move toward their mean among the portfolio's own securities — not toward zero, which would show a diversification
	// that is not there
	const sd = S.map((r, i) => Math.sqrt(Math.max(r[i], 0)));
	let sum = 0;
	let n = 0;
	for (const i of pool) for (const j of pool) if (i < j && sd[i] > 0 && sd[j] > 0) (sum += S[i][j] / (sd[i] * sd[j]), n++);
	const rbar = n ? sum / n : 0;
	const shrunk = S.map((r, i) => r.map((v, j) => (i === j || !(sd[i] > 0 && sd[j] > 0) ? v : (1 - delta) * v + delta * rbar * sd[i] * sd[j])));
	return { cov: psd(shrunk).map((r) => r.map((v) => v * 52)), delta };
}

export const corrOf = (cov: Matrix): Matrix => cov.map((r, i) => r.map((v, j) => (cov[i][i] > 0 && cov[j][j] > 0 ? v / Math.sqrt(cov[i][i] * cov[j][j]) : i === j ? 1 : 0)));

export interface Stats {
	/** annual volatility of the portfolio, a fraction */
	vol: number;
	/** each position's share of the risk (sums to 1; can be negative for a hedge) */
	rc: number[];
	/** the effective number of bets: 1 / Σ share² */
	bets: number;
	/** the portfolio's correlation with the employer's share (null — none set) */
	job: number | null;
}

/** w — weights of the securities of `cov` (cash is the rest, without risk); job — the index of the employer's share in cov */
export function stats(cov: Matrix, w: number[], job: number | null = null): Stats {
	const n = w.length;
	const sw = Array.from({ length: n }, (_, i) => w.reduce((s, wj, j) => s + cov[i][j] * wj, 0));
	const v = w.reduce((s, wi, i) => s + wi * sw[i], 0);
	const rc = v > 0 ? w.map((wi, i) => (wi * sw[i]) / v) : w.map(() => 0);
	const sq = rc.reduce((s, x) => s + x * x, 0);
	let jobCorr: number | null = null;
	if (job !== null && v > 0 && cov[job][job] > 0) jobCorr = sw[job] / Math.sqrt(v * cov[job][job]);
	return { vol: Math.sqrt(Math.max(v, 0)), rc, bets: sq > 0 ? 1 / sq : 0, job: jobCorr };
}

/**
 * Classical MDS of the distance 1 − correlation into two dimensions; each axis turned so that the largest weight
 * lies on its positive side — the same picture on every open.
 */
export function mds(corr: Matrix, weights: number[]): { coords: [number, number][]; basis: { v: Matrix; l: number[]; d2mean: number[]; d2all: number } } {
	const n = corr.length;
	const D2 = corr.map((r) => r.map((c) => (1 - c) ** 2));
	const rm = D2.map((r) => mean(r));
	const all = mean(rm);
	const B = D2.map((r, i) => r.map((d, j) => -0.5 * (d - rm[i] - rm[j] + all)));
	const { values, vectors } = eigSym(B);
	const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 2);
	const big = weights.reduce((bi, w, i) => (w > weights[bi] ? i : bi), 0);
	const v = order.map(([, k]) => {
		const col = vectors.map((r) => r[k]);
		return col[big] < 0 ? col.map((x) => -x) : col;
	});
	const l = order.map(([val]) => Math.max(val, 1e-12));
	const coords = Array.from({ length: n }, (_, i) => [v[0][i] * Math.sqrt(l[0]), (v[1]?.[i] ?? 0) * Math.sqrt(l[1] ?? 0)] as [number, number]);
	return { coords, basis: { v, l, d2mean: rm, d2all: all } };
}

/** a new point placed into an MDS map by its correlations with the mapped ones (Gower's formula) */
export function mdsPlace(basis: ReturnType<typeof mds>['basis'], corrToMapped: number[]): [number, number] {
	const d2 = corrToMapped.map((c) => (1 - c) ** 2);
	const dm = mean(d2);
	const b = d2.map((d, i) => -0.5 * (d - dm - basis.d2mean[i] + basis.d2all));
	return [0, 1].map((k) => (basis.v[k] ? basis.v[k].reduce((s, x, i) => s + x * b[i], 0) / Math.sqrt(basis.l[k]) : 0)) as [number, number];
}

/** weights summing to 1 with every weight in [0, cap]: the projection on the capped simplex (bisection) */
function project(w: number[], cap: number): number[] {
	let lo = Math.min(...w) - 1;
	let hi = Math.max(...w);
	for (let k = 0; k < 100; k++) {
		const mid = (lo + hi) / 2;
		const s = w.reduce((n, x) => n + Math.min(cap, Math.max(0, x - mid)), 0);
		if (s > 1) lo = mid;
		else hi = mid;
	}
	return w.map((x) => Math.min(cap, Math.max(0, x - hi)));
}

/** the portfolio of minimal risk from the same securities, each at most `cap` (projected gradient) */
export function minVariance(cov: Matrix, cap = 0.15): number[] {
	const n = cov.length;
	const capEff = Math.max(cap, 1 / n);
	let w = project(new Array(n).fill(1 / n), capEff);
	const L = Math.max(...cov.map((r) => r.reduce((s, x) => s + Math.abs(x), 0))) * 2 || 1;
	for (let it = 0; it < 2000; it++) {
		const g = cov.map((r) => 2 * r.reduce((s, x, j) => s + x * w[j], 0));
		w = project(w.map((x, i) => x - g[i] / L), capEff);
	}
	return w;
}

/** risk parity: every security the same share of the risk, each at most `cap` */
export function riskParity(cov: Matrix, cap = 0.15): number[] {
	const n = cov.length;
	const capEff = Math.max(cap, 1 / n);
	let w = new Array(n).fill(1 / n);
	for (let it = 0; it < 500; it++) {
		const s = stats(cov, w);
		const next = w.map((x, i) => x * Math.sqrt(1 / n / Math.max(s.rc[i], 1e-9)));
		w = project(next.map((x) => x / next.reduce((a, b) => a + b, 0)), capEff);
	}
	return w;
}

export type Label = 'reduces' | 'neutral' | 'duplicates';

/**
 * The label of a purchase: «дублирует X» — its correlation with a held position or with the invested part as a whole
 * is at least 0.7, the map's «strong tie» (X — the most correlated position); «снижает риск» — the invested part's volatility falls by more than 2% of itself, or the independent
 * bets grow by at least 0.3 while the volatility grows by at most 2%; otherwise «нейтрально».
 */
export function labelOf(before: Stats, after: Stats, maxCorr: number): Label {
	if (maxCorr >= 0.7) return 'duplicates';
	// more bets count only if the swings do not grow: a leveraged fund adds a «bet» and a lot of risk
	if (after.vol < before.vol * 0.98 || (after.bets >= before.bets + 0.3 && after.vol <= before.vol * 1.02)) return 'reduces';
	return 'neutral';
}

/** what the simulator needs of the server's view */
export interface RiskData {
	cov: Matrix;
	corr: Matrix;
	job: number | null;
	securities: { id: number; symbol: string; role: 'held' | 'add' | 'job'; weight: number }[];
}

export interface WhatIf {
	before: { vol: number; bets: number; job: number | null };
	after: { vol: number; bets: number; job: number | null };
	label: Label;
	/** the held position most tied to the tried security, and the correlation */
	twin: { id: number; symbol: string; corr: number } | null;
	/** the tried securities' highest correlation with the invested part of the portfolio */
	portfolioCorr: number;
}

/**
 * «Что если?»: the tried securities bought for `amount` (a share of the portfolio's value each) from the cash or
 * instead of a held position. The label compares the invested part's risk (cash aside): a security bought from
 * the cash adds risk to the whole portfolio anyway, the question is whether it is a new bet.
 */
export function whatIf(r: RiskData, adds: number[], amount: number, insteadOf: number | null = null): WhatIf {
	const w0 = r.securities.map((s) => s.weight);
	const w1 = [...w0];
	const idx = adds.map((id) => r.securities.findIndex((s) => s.id === id)).filter((i) => i >= 0);
	let money = amount * idx.length;
	if (insteadOf !== null) {
		const j = r.securities.findIndex((s) => s.id === insteadOf);
		if (j >= 0) {
			money = Math.min(money, w1[j]);
			w1[j] -= money;
		}
	}
	for (const i of idx) w1[i] += money / Math.max(1, idx.length);
	const norm = (w: number[]) => {
		const s = w.reduce((a, b, i) => a + (r.securities[i].role === 'job' ? 0 : b), 0);
		return w.map((x, i) => (s > 0 && r.securities[i].role !== 'job' ? x / s : 0));
	};
	const b = stats(r.cov, w0, r.job);
	const a = stats(r.cov, w1, r.job);
	const bn = stats(r.cov, norm(w0), r.job);
	const an = stats(r.cov, norm(w1), r.job);
	let twin: WhatIf['twin'] = null;
	for (const i of idx)
		r.securities.forEach((s, j) => {
			if (s.role !== 'held' || j === i || s.id === insteadOf) return;
			const c = r.corr[i][j];
			if (!twin || c > twin.corr) twin = { id: s.id, symbol: s.symbol, corr: c };
		});
	const t = twin as WhatIf['twin'];
	// against the invested part as a whole: three semis are one bet even if no single pair passes 0.8
	const wp = norm(w0);
	let pc = 0;
	for (const i of idx) {
		const cip = wp.reduce((s, x, j) => s + x * r.cov[i][j], 0);
		const vp = wp.reduce((s, x, j) => s + x * wp.reduce((u, y, k) => u + y * r.cov[j][k], 0), 0);
		if (vp > 0 && r.cov[i][i] > 0) pc = Math.max(pc, cip / Math.sqrt(vp * r.cov[i][i]));
	}
	return { before: { vol: b.vol, bets: bn.bets, job: b.job }, after: { vol: a.vol, bets: an.bets, job: a.job }, label: labelOf(bn, an, Math.max(t?.corr ?? 0, pc)), twin: t, portfolioCorr: pc };
}
