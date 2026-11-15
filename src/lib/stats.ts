/**
 * Spec sections 7 and 17 — statistics of a source. Pure functions: the screens and the tests use the same.
 *
 * The rating of a source counts only closed hypotheses of the three types whose direction comes from the
 * source (recommendation, target price, opinion). «News» is shown on its own line and stays out of the rating;
 * hypotheses closed early are shown on their own line too; cancelled ones do not count at all.
 */

export const RATED_TYPES = ['recommendation', 'target', 'opinion'] as const;

/** Thresholds of section 7: below FEW — «мало данных», a count only; below FIRM — «предварительно». */
export const FEW = 10;
export const FIRM = 30;

export type Level = 'none' | 'few' | 'prelim' | 'firm';

export interface Closed {
	status: string;
	signalType: string;
	outcome: string | null;
	excessPct: number | null;
}

/** 95% Wilson score interval for k hits out of n, as fractions. 7 of 10 → 0.397…0.892. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
	if (n === 0) return [0, 0];
	const p = k / n;
	const d = 1 + (z * z) / n;
	const c = (p + (z * z) / (2 * n)) / d;
	const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
	return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function level(n: number): Level {
	return n === 0 ? 'none' : n < FEW ? 'few' : n < FIRM ? 'prelim' : 'firm';
}

const median = (xs: number[]) => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Score {
	/** closed hypotheses counted */
	n: number;
	hits: number;
	/** hit rate and its interval (fractions); shown only from FEW */
	rate: number | null;
	ci: [number, number] | null;
	/** the lower bound — for sorting even below FEW, so that 2 of 2 never stands above 20 of 30 */
	lower: number;
	level: Level;
	meanExcess: number | null;
	medianExcess: number | null;
	best: number | null;
	worst: number | null;
}

export function score(rows: { outcome: string | null; excessPct: number | null }[]): Score {
	const n = rows.length;
	const hits = rows.filter((r) => r.outcome === 'hit').length;
	const ex = rows.map((r) => r.excessPct).filter((x): x is number => x !== null);
	const ci = n ? wilson(hits, n) : null;
	return {
		n,
		hits,
		rate: n ? hits / n : null,
		ci,
		lower: ci ? ci[0] : -1,
		level: level(n),
		meanExcess: ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null,
		medianExcess: median(ex),
		best: ex.length ? Math.max(...ex) : null,
		worst: ex.length ? Math.min(...ex) : null
	};
}

/** The parts of section 7: the rating, «news», early closes. */
export function split<T extends Closed>(rows: T[]) {
	const closed = rows.filter((r) => r.status === 'closed');
	return {
		rated: closed.filter((r) => (RATED_TYPES as readonly string[]).includes(r.signalType)),
		news: closed.filter((r) => r.signalType === 'news'),
		early: rows.filter((r) => r.status === 'closed_early')
	};
}

/** «до 3 мес», «3–6 мес», «дольше» — by the term from the entry date to the horizon. */
export function horizonBucket(entryDate: string, horizonDate: string): 'short' | 'mid' | 'long' {
	const days = (Date.parse(horizonDate) - Date.parse(entryDate)) / 86400000;
	return days <= 93 ? 'short' : days <= 186 ? 'mid' : 'long';
}

export const BUCKETS = { short: 'до 3 месяцев', mid: '3–6 месяцев', long: 'дольше 6 месяцев' } as const;

/** Sorting of section 7: by the lower bound of the interval; sources without closed hypotheses last. */
export function byLowerBound<T extends { score: Score }>(a: T, b: T) {
	return b.score.lower - a.score.lower || b.score.n - a.score.n;
}
