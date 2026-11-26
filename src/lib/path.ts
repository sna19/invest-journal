/**
 * T-033 «Путь доходности» — the pure part shared by the server and the phone: from month-end values (with
 * dividends) the mosaic «year × month», the rolling return, the ladder «where the profit was made», the concentration
 * of the profit and the marks. Switching a mosaic or a window on the phone recomputes here, without a request.
 */

/** a month-end value of the security (with dividends) and of its market's index */
export interface MonthPt {
	m: string;
	v: number;
	b: number | null;
}
export interface MonthRet {
	m: string;
	r: number;
	/** the market's return of the month */
	br: number | null;
}

export const monthAdd = (m: string, n: number) => {
	const [y, mo] = m.split('-').map(Number);
	const t = y * 12 + mo - 1 + n;
	return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** each month against the one before (only consecutive months) */
export function monthlyReturns(pts: MonthPt[]): MonthRet[] {
	const out: MonthRet[] = [];
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		if (monthAdd(a.m, 1) !== b.m || !(a.v > 0)) continue;
		out.push({ m: b.m, r: b.v / a.v - 1, br: a.b && b.b ? b.b / a.b - 1 : null });
	}
	return out;
}

/** «к рынку»: what the security did over the market, as a ratio — (1 + r) / (1 + market) − 1 */
export const over = (r: number, br: number | null) => (br === null ? null : (1 + r) / (1 + br) - 1);

export interface MosaicRow {
	year: number;
	cells: (number | null)[];
	total: number | null;
	/** the year has fewer months than its columns (the first or the current one) */
	partial: boolean;
}

/** rows by year (newest first): months or quarters, as they are or against the market, and the year's total */
export function mosaic(rets: MonthRet[], unit: 'month' | 'quarter', rel: boolean, years = 10): MosaicRow[] {
	const by = new Map<number, Map<number, number>>();
	for (const x of rets) {
		const r = rel ? over(x.r, x.br) : x.r;
		if (r === null) continue;
		const y = Number(x.m.slice(0, 4));
		const mo = Number(x.m.slice(5, 7));
		if (!by.has(y)) by.set(y, new Map());
		by.get(y)!.set(mo, r);
	}
	return [...by.keys()]
		.sort((a, b) => b - a)
		.slice(0, years)
		.map((year) => {
			const ms = by.get(year)!;
			const cols = unit === 'month' ? 12 : 4;
			const cells: (number | null)[] = [];
			for (let c = 0; c < cols; c++) {
				const months = unit === 'month' ? [c + 1] : [c * 3 + 1, c * 3 + 2, c * 3 + 3];
				const have = months.filter((mo) => ms.has(mo));
				cells.push(have.length ? have.reduce((g, mo) => g * (1 + ms.get(mo)!), 1) - 1 : null);
			}
			const total = ms.size ? [...ms.values()].reduce((g, r) => g * (1 + r), 1) - 1 : null;
			return { year, cells, total, partial: ms.size < 12 };
		});
}

/** the return over the `window` months before each month-end, and the same over the market */
export function rolling(pts: MonthPt[], window: number) {
	const at = new Map(pts.map((p) => [p.m, p]));
	const out: { date: string; value: number; rel: number | null }[] = [];
	for (const p of pts) {
		const a = at.get(monthAdd(p.m, -window));
		if (!a || !(a.v > 0)) continue;
		const r = p.v / a.v - 1;
		const br = a.b && p.b ? p.b / a.b - 1 : null;
		const o = over(r, br);
		out.push({ date: `${p.m}-28`, value: Math.round(r * 1000) / 10, rel: o === null ? null : Math.round(o * 1000) / 10 });
	}
	return out;
}

export interface Step {
	label: string;
	/** the step's own growth */
	growth: number;
	/** its part of the period's total: the growth times what had been made before it (chain-linked) */
	contribution: number;
}

/**
 * «Где набрана прибыль»: the period's total as a ladder by years (or quarters). A step's contribution is the value
 * accumulated before it times its growth, so the steps add up to the total exactly (+48 / +37 / 0 = +85).
 */
export function ladder(pts: MonthPt[], fromMonth: string, unit: 'year' | 'quarter'): { steps: Step[]; total: number } | null {
	const i0 = pts.findIndex((p) => p.m >= fromMonth);
	if (i0 < 0) return null;
	// the period starts at the month-end before its first month
	const start = i0 > 0 ? pts[i0 - 1] : pts[i0];
	const key = (m: string) => (unit === 'year' ? m.slice(0, 4) : `${m.slice(0, 4)} Q${Math.ceil(Number(m.slice(5, 7)) / 3)}`);
	const steps: Step[] = [];
	let acc = 1;
	let prev = start.v;
	for (let i = i0 > 0 ? i0 : i0 + 1; i < pts.length; i++) {
		const p = pts[i];
		const k = key(p.m);
		const last = i === pts.length - 1 || key(pts[i + 1].m) !== k;
		if (!last) continue;
		const growth = p.v / prev - 1;
		steps.push({ label: k, growth, contribution: acc * growth });
		acc *= 1 + growth;
		prev = p.v;
	}
	return { steps, total: acc - 1 };
}

/**
 * How much of the period's profit came from its best 1, 3 and 5 months (by their log growth, so the shares are of
 * the same whole), and what the period would have made without its best 3.
 */
export function concentration(rets: MonthRet[]) {
	const logs = rets.map((x) => Math.log(1 + x.r));
	const total = logs.reduce((a, b) => a + b, 0);
	const best = [...logs].sort((a, b) => b - a);
	const share = (k: number) => (total > 0 ? Math.min(1, best.slice(0, k).reduce((a, b) => a + Math.max(0, b), 0) / total) : null);
	return {
		total: Math.exp(total) - 1,
		best1: share(1),
		best3: share(3),
		best5: share(5),
		withoutBest3: Math.exp(total - best.slice(0, 3).reduce((a, b) => a + b, 0)) - 1,
		months: rets.length
	};
}

// ── the marks ─────────────────────────────────────────────────────────────────────────────────────────────

export const FLAGS = ['fading', 'stuck', 'spike', 'bounce'] as const;
export type Flag = (typeof FLAGS)[number];

export interface FlagParams {
	/** «выдыхается»: 3 years at least fadeCagr % a year, and 12 months at most fadeYear % or fadeExcess pp under the market */
	fadeCagr: number;
	fadeYear: number;
	fadeExcess: number;
	/** «застряла»: stuckDays trading days without a new high and 12 months within ±stuckBand % */
	stuckDays: number;
	stuckBand: number;
	/** «всплеск»: at least spikeShare % of 3 years' profit in its best spikeMonths months */
	spikeShare: number;
	spikeMonths: number;
	/** «отскок»: 12 months at bounceYear % or worse, the last month bounceMonth % or better */
	bounceYear: number;
	bounceMonth: number;
	/** the rolling window, months */
	window: number;
}
export const FLAG_DEFAULTS: FlagParams = { fadeCagr: 10, fadeYear: 2, fadeExcess: -5, stuckDays: 250, stuckBand: 10, spikeShare: 50, spikeMonths: 2, bounceYear: -15, bounceMonth: 15, window: 12 };

export interface FlagInput {
	/** fractions: 0.1 = 10% */
	cagr3: number | null;
	ret12: number | null;
	excess12: number | null;
	ret1: number | null;
	/** trading days since the last high */
	daysNoHigh: number | null;
	/** the 3 years' month returns */
	rets3: MonthRet[];
}

export function flagsOf(x: FlagInput, p: FlagParams = FLAG_DEFAULTS): Flag[] {
	const out: Flag[] = [];
	if (x.cagr3 !== null && x.ret12 !== null && x.cagr3 * 100 >= p.fadeCagr && (x.ret12 * 100 <= p.fadeYear || (x.excess12 !== null && x.excess12 * 100 <= p.fadeExcess))) out.push('fading');
	if (x.daysNoHigh !== null && x.ret12 !== null && x.daysNoHigh >= p.stuckDays && Math.abs(x.ret12 * 100) <= p.stuckBand) out.push('stuck');
	if (x.rets3.length >= 24) {
		const logs = x.rets3.map((r) => Math.log(1 + r.r));
		const total = logs.reduce((a, b) => a + b, 0);
		const best = [...logs].sort((a, b) => b - a).slice(0, p.spikeMonths).reduce((a, b) => a + Math.max(0, b), 0);
		if (total > 0 && (best / total) * 100 >= p.spikeShare) out.push('spike');
	}
	if (x.ret12 !== null && x.ret1 !== null && x.ret12 * 100 <= p.bounceYear && x.ret1 * 100 >= p.bounceMonth) out.push('bounce');
	return out;
}

export const FLAG_NAME: Record<Flag, [string, string]> = {
	fading: ['выдыхается', 'fading'],
	stuck: ['застряла', 'stuck'],
	spike: ['всплеск', 'spike'],
	bounce: ['отскок', 'bounce']
};
