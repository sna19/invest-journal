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

// ── Spec sections 7 and 9 — the «Статистика» screen ──────────────────────────────────────────────────────

export interface CalRow {
	status: string;
	outcome: string | null;
	confidencePct: number | null;
}

export interface CalBucket {
	/** confidence range, both ends included: 50–59, …, 90–99; «до 49» for the rest */
	from: number;
	to: number;
	label: string;
	n: number;
	hits: number;
	/** the mean confidence put down in this bucket, percent */
	meanConf: number;
	/** the share that worked, fraction, and its interval; null when there are none */
	rate: number | null;
	ci: [number, number] | null;
	level: Level;
}

export const CAL_BUCKETS: [number, number][] = [
	[1, 49],
	[50, 59],
	[60, 69],
	[70, 79],
	[80, 89],
	[90, 99]
];

/**
 * Calibration: hypotheses closed in their term (any type — the confidence is the user's own) that have the
 * confidence filled in, grouped by the stated confidence; next to it the actual share that worked.
 * Early closes and cancelled ones do not count: their outcome was not decided by the term.
 */
export function calibration(rows: CalRow[]) {
	const used = rows.filter((r) => r.status === 'closed' && r.confidencePct !== null && (r.outcome === 'hit' || r.outcome === 'miss'));
	const buckets: CalBucket[] = CAL_BUCKETS.map(([from, to]) => {
		const rs = used.filter((r) => r.confidencePct! >= from && r.confidencePct! <= to);
		const n = rs.length;
		const hits = rs.filter((r) => r.outcome === 'hit').length;
		return {
			from,
			to,
			label: from === 1 ? 'до 49%' : `${from}–${to}%`,
			n,
			hits,
			meanConf: n ? rs.reduce((a, r) => a + r.confidencePct!, 0) / n : 0,
			rate: n ? hits / n : null,
			ci: n ? wilson(hits, n) : null,
			level: level(n)
		};
	}).filter((b) => b.n);
	const n = used.length;
	const hits = used.filter((r) => r.outcome === 'hit').length;
	return {
		buckets,
		n,
		hits,
		meanConf: n ? used.reduce((a, r) => a + r.confidencePct!, 0) / n : null,
		rate: n ? hits / n : null,
		/** Brier score: the mean of (confidence − outcome)², 0 is perfect, 0.25 is «always 50%» */
		brier: n ? used.reduce((a, r) => a + (r.confidencePct! / 100 - (r.outcome === 'hit' ? 1 : 0)) ** 2, 0) / n : null,
		/** closed hypotheses without a confidence: they stay out of the calibration */
		without: rows.filter((r) => r.status === 'closed' && r.confidencePct === null).length
	};
}

/** «Hedge, Fund» → the tags of a hypothesis, compared without case. */
export function tagsOf(s: string | null | undefined): string[] {
	return [...new Set((s ?? '').split(',').map((t) => t.trim()).filter(Boolean))];
}

/** A tag is shown once it has 10 closed hypotheses in the rating (section 7). */
export const TAG_MIN = FEW;
