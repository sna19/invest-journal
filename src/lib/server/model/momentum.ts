/**
 * T-017 «Страновой моментум» — dual momentum after Gary Antonacchi, on country ETFs listed in the US. The idea the
 * owner had followed by hand (country funds bought on last year's rise, held without a rule) checked as a rule:
 *  - the signal of a fund at a rebalance is its return over L months, leaving out the last S (by default 12 and 1),
 *    by the month-end adjusted closes (dividends in);
 *  - on the first trading day of a month (or a quarter) hold the N best, in equal parts;
 *  - variant A «Относительный» — always the N best; variant B «Двойной» — a fund is taken only if its signal is above
 *    the one of the safe fund (BIL, US treasury bills), otherwise its part goes into BIL;
 *  - the bases: SPY bought and held; all the countries in equal parts, rebalanced each January; «last year's leaders» —
 *    each January the 4 best of the past calendar year, held for a year (the way the owner did it).
 * Pure functions over monthly series; the data and the journal are in momentumService.ts.
 */

export type MVariant = 'A' | 'B';
export interface MParams {
	/** the countries' funds; SPY is the market, BIL the refuge */
	universe: string[];
	safe: string;
	lookback: number;
	skip: number;
	top: number;
	rebalance: 'month' | 'quarter';
	years: number;
	/** costs, as T-012: a commission in % of the traded sum and a tax on realized gains */
	commissionPct: number;
	taxPct: number;
}

export const MDEFAULTS: MParams = {
	universe: ['EWJ', 'EWG', 'EWU', 'EWQ', 'EWI', 'EWP', 'EWL', 'EWN', 'EWD', 'EPOL', 'EWZ', 'EWW', 'ECH', 'EPU', 'EWH', 'EWT', 'EWY', 'INDA', 'EWA', 'EWC', 'EIS', 'EZA', 'SPY'],
	safe: 'BIL',
	lookback: 12,
	skip: 1,
	top: 3,
	rebalance: 'month',
	years: 10,
	commissionPct: 0.1,
	taxPct: 25
};

export function cleanMParams(input: Record<string, unknown>, base: MParams = MDEFAULTS): MParams {
	const int = (v: unknown, lo: number, hi: number, d: number) => {
		const x = Math.round(Number(v));
		return Number.isFinite(x) && x >= lo && x <= hi ? x : d;
	};
	const num = (v: unknown, lo: number, hi: number, d: number) => {
		const x = Number(v);
		return Number.isFinite(x) && x >= lo && x <= hi ? x : d;
	};
	const uni = Array.isArray(input.universe)
		? [...new Set((input.universe as unknown[]).map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z.]{1,8}$/.test(s)))].slice(0, 60)
		: base.universe;
	return {
		universe: uni.length >= 2 ? uni : base.universe,
		safe: typeof input.safe === 'string' && /^[A-Z]{1,6}$/.test(input.safe) ? input.safe : base.safe,
		lookback: int(input.lookback, 3, 12, base.lookback),
		skip: int(input.skip, 0, 1, base.skip),
		top: int(input.top, 1, 10, base.top),
		rebalance: input.rebalance === 'quarter' || input.rebalance === 'month' ? input.rebalance : base.rebalance,
		years: int(input.years, 3, 20, base.years),
		commissionPct: num(input.commissionPct, 0, 2, base.commissionPct),
		taxPct: num(input.taxPct, 0, 50, base.taxPct)
	};
}

/** monthly adjusted closes by symbol: month «YYYY-MM» → adjClose */
export type Series = Map<string, Map<string, number>>;

export const monthAdd = (m: string, n: number) => {
	const [y, mo] = m.split('-').map(Number);
	const t = y * 12 + mo - 1 + n;
	return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** the signal of a fund for a rebalance at the start of `month`: its return over L months ending S months before */
export function signal(s: Map<string, number> | undefined, month: string, L: number, S: number): number | null {
	if (!s) return null;
	const end = s.get(monthAdd(month, -1 - S));
	const start = s.get(monthAdd(month, -1 - S - L));
	return end && start ? end / start - 1 : null;
}

export interface Choice {
	symbol: string;
	signal: number;
	/** B: the part went into the refuge */
	toSafe: boolean;
}

/** the choice at a rebalance: the N best by signal (B: a fund below the refuge's signal gives its part to the refuge) */
export function choose(series: Series, p: MParams, month: string, variant: MVariant): { picks: Choice[]; ranking: { symbol: string; signal: number }[]; safeSignal: number | null } {
	const ranking = p.universe
		.map((symbol) => ({ symbol, signal: signal(series.get(symbol), month, p.lookback, p.skip) }))
		.filter((x): x is { symbol: string; signal: number } => x.signal !== null && series.get(x.symbol)?.has(monthAdd(month, -1)) === true)
		.sort((a, b) => b.signal - a.signal || a.symbol.localeCompare(b.symbol));
	const safeSignal = signal(series.get(p.safe), month, p.lookback, p.skip);
	const picks = ranking.slice(0, p.top).map((x) => ({ ...x, toSafe: variant === 'B' && safeSignal !== null && x.signal <= safeSignal }));
	return { picks, ranking, safeSignal };
}

export interface Run {
	/** month-end values, starting at 1 the month before the first month */
	curve: { month: string; value: number }[];
	returns: number[];
	/** per rebalance: what was held */
	holdings: { month: string; weights: Record<string, number> }[];
	turnover: number;
	safeShare: number;
	costs: number;
}

/**
 * A strategy over `months` (each a month held): at each rebalance month the target weights; between them the parts
 * drift with their funds. A commission on what is traded and a tax on the gains realized by a sale are paid from the
 * portfolio at once.
 */
export function simulate(series: Series, months: string[], target: (month: string) => Record<string, number> | null, rebalanceAt: (month: string, i: number) => boolean, p: Pick<MParams, 'commissionPct' | 'taxPct' | 'safe'> = MDEFAULTS): Run {
	let value = 1;
	let parts: Record<string, number> = {};
	let basis: Record<string, number> = {};
	const curve = [{ month: monthAdd(months[0], -1), value: 1 }];
	const returns: number[] = [];
	const holdings: Run['holdings'] = [];
	let traded = 0;
	let safeMonths = 0;
	let costs = 0;
	months.forEach((m, i) => {
		if (rebalanceAt(m, i) || i === 0) {
			const t = target(m);
			if (t) {
				const now = { ...parts };
				let trade = 0;
				let tax = 0;
				for (const k of new Set([...Object.keys(now), ...Object.keys(t)])) {
					const want = value * (t[k] ?? 0);
					const have = now[k] ?? 0;
					trade += Math.abs(want - have);
					if (have > want && have > 0) {
						const sold = have - want;
						const gain = sold * (1 - (basis[k] ?? have) / have);
						if (gain > 0) tax += (gain * p.taxPct) / 100;
						basis[k] = (basis[k] ?? have) * (want / have);
					} else if (want > have) basis[k] = (basis[k] ?? 0) + (want - have);
				}
				const cost = (trade * p.commissionPct) / 100 + tax;
				costs += cost;
				traded += trade / 2 / value;
				const after = value - cost;
				parts = Object.fromEntries(Object.entries(t).filter(([, w]) => w > 0).map(([k, w]) => [k, after * w]));
				basis = Object.fromEntries(Object.keys(parts).map((k) => [k, basis[k] ?? parts[k]]));
				value = after;
				holdings.push({ month: m, weights: t });
			}
		}
		const before = value;
		let next = 0;
		for (const k of Object.keys(parts)) {
			const s = series.get(k);
			const a = s?.get(monthAdd(m, -1));
			const b = s?.get(m);
			const r = a && b ? b / a - 1 : 0;
			parts[k] *= 1 + r;
			next += parts[k];
		}
		if (parts[p.safe]) safeMonths += parts[p.safe] / Math.max(next, 1e-12);
		value = next || value;
		returns.push(value / before - 1);
		curve.push({ month: m, value });
	});
	const years = months.length / 12;
	return { curve, returns, holdings, turnover: years > 0 ? traded / years : 0, safeShare: months.length ? safeMonths / months.length : 0, costs };
}

export interface Metrics {
	cagr: number | null;
	maxDrawdown: number | null;
	vol: number | null;
	sharpe: number | null;
	safeShare?: number;
	turnover?: number;
}

/** the year's return, the deepest fall, the yearly swings, the Sharpe ratio over the refuge's return */
export function metrics(returns: number[], rf: number[]): Metrics {
	if (!returns.length) return { cagr: null, maxDrawdown: null, vol: null, sharpe: null };
	let v = 1;
	let peak = 1;
	let dd = 0;
	for (const r of returns) {
		v *= 1 + r;
		peak = Math.max(peak, v);
		dd = Math.min(dd, v / peak - 1);
	}
	const n = returns.length;
	const mean = returns.reduce((a, b) => a + b, 0) / n;
	const sd = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
	const ex = returns.map((r, i) => r - (rf[i] ?? 0));
	const exMean = ex.reduce((a, b) => a + b, 0) / n;
	const exSd = Math.sqrt(ex.reduce((a, b) => a + (b - exMean) ** 2, 0) / Math.max(1, n - 1));
	return { cagr: v ** (12 / n) - 1, maxDrawdown: dd, vol: sd * Math.sqrt(12), sharpe: exSd > 0 ? (exMean / exSd) * Math.sqrt(12) : null };
}

/** the complete months of the window: from `years` back to the last month every chosen fund and the market have */
export function windowMonths(series: Series, p: MParams, lastMonth: string) {
	const first = monthAdd(lastMonth, -12 * p.years + 1);
	const out: string[] = [];
	for (let m = first; m <= lastMonth; m = monthAdd(m, 1)) out.push(m);
	return out;
}

const isRebalance = (p: MParams) => (m: string) => p.rebalance === 'month' || ['01', '04', '07', '10'].includes(m.slice(5, 7));
const equal = (syms: string[]) => (syms.length ? Object.fromEntries(syms.map((s) => [s, 1 / syms.length])) : null);

/** the strategy of a variant over `months` */
export function runVariant(series: Series, p: MParams, months: string[], variant: MVariant) {
	return simulate(
		series,
		months,
		(m) => {
			const { picks } = choose(series, p, m, variant);
			if (!picks.length) return null;
			const w: Record<string, number> = {};
			for (const x of picks) {
				const k = x.toSafe ? p.safe : x.symbol;
				w[k] = (w[k] ?? 0) + 1 / picks.length;
			}
			return w;
		},
		isRebalance(p),
		p
	);
}

/** the three bases */
export function runBases(series: Series, p: MParams, months: string[]) {
	const countries = p.universe.filter((s) => s !== 'SPY');
	const yearly = (m: string) => m.slice(5, 7) === '01';
	const spy = simulate(series, months, () => ({ SPY: 1 }), () => false, { ...p, commissionPct: 0, taxPct: 0 });
	const eq = simulate(series, months, (m) => equal(countries.filter((s) => series.get(s)?.has(monthAdd(m, -1)))), yearly, p);
	const leaders = simulate(
		series,
		months,
		(m) => {
			// the past calendar year's 4 best — as bought by hand each January
			const y = Number(m.slice(0, 4)) - 1;
			const ret = countries
				.map((s) => {
					const a = series.get(s)?.get(`${y - 1}-12`);
					const b = series.get(s)?.get(`${y}-12`);
					return { s, r: a && b ? b / a - 1 : null };
				})
				.filter((x): x is { s: string; r: number } => x.r !== null)
				.sort((a, b) => b.r - a.r);
			return equal(ret.slice(0, 4).map((x) => x.s));
		},
		yearly,
		p
	);
	return { spy, eq, leaders };
}

/** a random choice of N each rebalance — the placebo: how often chance does as well */
export function placebo(series: Series, p: MParams, months: string[], runs = 100, seed = 7) {
	let x = seed;
	const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
	const out: number[] = [];
	for (let k = 0; k < runs; k++) {
		const r = simulate(
			series,
			months,
			(m) => {
				const live = p.universe.filter((s) => series.get(s)?.has(monthAdd(m, -1)) && series.get(s)?.has(m));
				const pick: string[] = [];
				while (pick.length < Math.min(p.top, live.length)) {
					const s = live[Math.floor(rnd() * live.length)];
					if (!pick.includes(s)) pick.push(s);
				}
				return equal(pick);
			},
			isRebalance(p),
			p
		);
		out.push(metrics(r.returns, []).cagr ?? 0);
	}
	return out;
}

/** the share of random runs at least as good, and the verdict (the T-010 thresholds) */
export function verdict(model: number | null, random: number[]) {
	if (model === null || !random.length) return { share: null, verdict: 'unclear' as const };
	const share = random.filter((r) => r >= model).length / random.length;
	return { share, verdict: share < 0.05 ? ('signal' as const) : share < 0.25 ? ('unclear' as const) : ('chance' as const) };
}
