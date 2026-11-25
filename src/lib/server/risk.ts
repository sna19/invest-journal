import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { corrOf, covariance, mds, mdsPlace, minVariance, riskParity, stats, type Matrix } from '../risk.js';
import { marketView, portfolioView } from './portfolio.js';

/**
 * T-023 «Карта риска» on the server: weekly returns in the portfolio's currency (daily closes, split-adjusted — the
 * dividends are not in them), the covariance, the three numbers, the map, money against risk, the details, and what
 * the simulator needs to recompute on the phone.
 */

const US = ['NASDAQ', 'NYSE', 'NYSE_AMERICAN', 'NYSE_ARCA', 'CBOE_BZX'];

export function getSetting(app: Database.Database, key: string): string | null {
	return (app.prepare('select value from user_settings where key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}
export function setSetting(app: Database.Database, key: string, value: string | null) {
	if (value === null || value === '') app.prepare('delete from user_settings where key = ?').run(key);
	else app.prepare(`insert into user_settings (key, value, updated_at) values (?, ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`).run(key, value, new Date().toISOString());
}

/** the employer's share: a symbol of a US exchange first, then TASE */
export function employerOf(app: Database.Database, market: Database.Database): { id: number; symbol: string } | null {
	const sym = getSetting(app, 'employer');
	if (!sym) return null;
	return (
		(market
			.prepare(`select id, symbol from ref_securities where symbol = ? and active = 1 and type <> 'index' order by exchange_code in (${US.map(() => '?').join(',')}) desc, id limit 1`)
			.get(sym.toUpperCase(), ...US) as { id: number; symbol: string } | undefined) ?? null
	);
}

/** the week of a date: weeks counted from a Thursday, so a week runs Monday to Sunday */
const weekOf = (date: string) => Math.floor((Date.parse(date + 'T12:00:00Z') / 86_400_000 + 3) / 7);

/**
 * Weekly returns of the securities in currency `pc` over the last `weeks` weeks: the last close of each week, times
 * the rate of its day; NaN — a week without two closes. Also how many weeks each has.
 */
export function weeklyReturns(market: Database.Database, ids: number[], pc: string, weeks: number, today = israelDate()) {
	const m = marketView(market);
	const end = weekOf(today);
	const start = end - weeks;
	const from = new Date((start * 7 - 3 - 7) * 86_400_000).toISOString().slice(0, 10);
	const q = market.prepare('select date, close from market_prices_daily where security_id = ? and date >= ? and date <= ? order by date');
	const cur = market.prepare('select currency, price_unit as unit from ref_securities where id = ?');
	return ids.map((id) => {
		const c = cur.get(id) as { currency: string; unit: string } | undefined;
		const currency = c?.unit === 'ILA' || c?.currency === 'ILS' ? 'ILS' : 'USD';
		const lastOfWeek = new Map<number, number>();
		for (const r of q.all(id, from, today) as { date: string; close: number }[]) {
			if (!(r.close > 0)) continue;
			lastOfWeek.set(weekOf(r.date), r.close * (currency === pc ? 1 : m.conv(currency, pc, r.date)));
		}
		const out: number[] = [];
		for (let w = start + 1; w <= end; w++) {
			const a = lastOfWeek.get(w - 1);
			const b = lastOfWeek.get(w);
			out.push(a && b ? b / a - 1 : NaN);
		}
		return { id, returns: out, weeks: out.filter((x) => Number.isFinite(x)).length };
	});
}

export interface RiskSecurity {
	id: number;
	symbol: string;
	name: string;
	sector: string | null;
	exchange: string;
	/** held: a position of the portfolio; add: a security the simulator tries; job: the employer's share */
	role: 'held' | 'add' | 'job';
	/** the weight in the portfolio (of its whole value, cash included) */
	weight: number;
	weeks: number;
	/** under 52 weeks of history */
	short: boolean;
	/** a point on the map */
	xy: [number, number];
}

export interface RiskView {
	currency: string;
	value: number;
	cash: number;
	years: number;
	weeks: number;
	delta: number;
	securities: RiskSecurity[];
	/** the annualised covariance and the correlation, in the order of `securities` */
	cov: Matrix;
	corr: Matrix;
	job: number | null;
	now: { vol: number; bets: number; job: number | null; held: number };
	/** each held position: its share of the money (of what is invested) and of the risk */
	rows: { id: number; money: number; risk: number }[];
	/** the pairs of held positions tied above 0.7 (indices) */
	links: [number, number, number][];
	details: {
		/** the mean correlation of the held pairs over rolling 26-week windows */
		rolling: { week: string; value: number }[];
		minRisk: { vol: number; bets: number; top: { id: number; w: number }[] };
		parity: { vol: number; bets: number; top: { id: number; w: number }[] };
	};
	/** securities still without daily history: their history is being loaded */
	loading: number[];
}

export function riskView(app: Database.Database, market: Database.Database, portfolioId: number, opts: { years?: number; add?: number[]; today?: string } = {}): RiskView | null {
	const today = opts.today ?? israelDate();
	const v = portfolioView(app, market, portfolioId, today);
	if (!v) return null;
	const years = Math.min(3, Math.max(1, opts.years ?? 2));
	const weeks = years * 52;
	const pc = v.summary.currency;
	const total = v.summary.held + Math.max(0, v.summary.cash);
	// held positions by security (a security in two positions counts once)
	const held = new Map<number, { symbol: string; name: string; exchange: string; sector: string | null; value: number }>();
	for (const p of v.positions) {
		if (p.stage !== 'holding' || !(p.valuePc > 0)) continue;
		const e = held.get(p.securityId);
		if (e) e.value += p.valuePc;
		else held.set(p.securityId, { symbol: p.symbol, name: p.name, exchange: p.exchange, sector: p.profile?.sector ?? null, value: p.valuePc });
	}
	const employer = employerOf(app, market);
	const meta = market.prepare(
		`select s.id, s.symbol, s.name_en as name, s.exchange_code as exchange, p.sector from ref_securities s left join ref_security_profiles p on p.security_id = s.id where s.id = ?`
	);
	const list: Omit<RiskSecurity, 'weeks' | 'short' | 'xy'>[] = [...held].map(([id, h]) => ({ id, symbol: h.symbol, name: h.name, sector: h.sector, exchange: h.exchange, role: 'held' as const, weight: total > 0 ? h.value / total : 0 }));
	const addOne = (id: number, role: 'add' | 'job') => {
		if (list.some((x) => x.id === id)) return;
		const r = meta.get(id) as { id: number; symbol: string; name: string; exchange: string; sector: string | null } | undefined;
		if (r) list.push({ ...r, role, weight: 0 });
	};
	if (employer) addOne(employer.id, 'job');
	for (const id of opts.add ?? []) addOne(id, 'add');
	const series = weeklyReturns(market, list.map((x) => x.id), pc, weeks, today);
	const { cov, delta } = covariance(
		series.map((s) => s.returns),
		list.map((x, i) => (x.role !== 'add' ? i : -1)).filter((i) => i >= 0)
	);
	const corr = corrOf(cov);
	const w = list.map((x) => x.weight);
	const jobIdx = employer ? list.findIndex((x) => x.id === employer.id) : -1;
	const now = stats(cov, w, jobIdx >= 0 ? jobIdx : null);
	const heldIdx = list.map((x, i) => (x.role === 'held' ? i : -1)).filter((i) => i >= 0);
	const investedSum = heldIdx.reduce((n, i) => n + w[i], 0);
	// the map: the held positions and the job's share; the tried ones are placed into it
	const mapped = list.map((x, i) => (x.role !== 'add' ? i : -1)).filter((i) => i >= 0);
	const sub = mapped.map((i) => mapped.map((j) => corr[i][j]));
	const xy: [number, number][] = list.map(() => [0, 0]);
	if (mapped.length >= 2) {
		const { coords, basis } = mds(sub, mapped.map((i) => w[i] || 1e-6));
		mapped.forEach((i, k) => (xy[i] = coords[k]));
		list.forEach((x, i) => {
			if (x.role === 'add') xy[i] = mdsPlace(basis, mapped.map((j) => corr[i][j]));
		});
	}
	const links: [number, number, number][] = [];
	for (const i of mapped) for (const j of mapped) if (i < j && corr[i][j] > 0.7) links.push([i, j, Math.round(corr[i][j] * 100) / 100]);
	// details: the rolling mean correlation of the held pairs, 26-week windows
	const rolling: { week: string; value: number }[] = [];
	const W = 26;
	const endWeek = weekOf(today);
	for (let t = W; t <= weeks; t += 2) {
		let sum = 0;
		let n = 0;
		for (const a of heldIdx)
			for (const b of heldIdx) {
				if (a >= b) continue;
				const x = series[a].returns.slice(t - W, t);
				const y = series[b].returns.slice(t - W, t);
				const ok = x.map((_, k) => Number.isFinite(x[k]) && Number.isFinite(y[k]));
				const xs = x.filter((_, k) => ok[k]);
				const ys = y.filter((_, k) => ok[k]);
				if (xs.length < 13) continue;
				const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
				const my = ys.reduce((s, v) => s + v, 0) / ys.length;
				let sxy = 0;
				let sxx = 0;
				let syy = 0;
				for (let k = 0; k < xs.length; k++) {
					sxy += (xs[k] - mx) * (ys[k] - my);
					sxx += (xs[k] - mx) ** 2;
					syy += (ys[k] - my) ** 2;
				}
				if (sxx > 0 && syy > 0) (sum += sxy / Math.sqrt(sxx * syy), n++);
			}
		if (n) rolling.push({ week: new Date(((endWeek - weeks + t) * 7 - 3) * 86_400_000).toISOString().slice(0, 10), value: Math.round((sum / n) * 100) / 100 });
	}
	const subCov = heldIdx.map((i) => heldIdx.map((j) => cov[i][j]));
	const alt = (ws: number[]) => {
		const st = stats(subCov, ws);
		return { vol: st.vol, bets: st.bets, top: ws.map((x, k) => ({ id: list[heldIdx[k]].id, w: Math.round(x * 1000) / 1000 })).sort((a, b) => b.w - a.w) };
	};
	const r3 = (x: number) => Math.round(x * 10000) / 10000;
	return {
		currency: pc,
		value: total,
		cash: Math.max(0, v.summary.cash),
		years,
		weeks,
		delta: r3(delta),
		securities: list.map((x, i) => ({ ...x, weeks: series[i].weeks, short: series[i].weeks < 52, xy: [r3(xy[i][0]), r3(xy[i][1])] })),
		cov: cov.map((r) => r.map((x) => Number(x.toPrecision(8)))),
		corr: corr.map((r) => r.map((x) => Math.round(x * 1000) / 1000)),
		job: jobIdx >= 0 ? jobIdx : null,
		now: { vol: now.vol, bets: now.bets, job: now.job, held: heldIdx.length },
		rows: heldIdx.map((i) => ({ id: list[i].id, money: investedSum > 0 ? w[i] / investedSum : 0, risk: now.rc[i] })).sort((a, b) => b.risk - b.money - (a.risk - a.money)),
		links,
		details: { rolling, minRisk: heldIdx.length >= 2 ? alt(minVariance(subCov, 0.15)) : alt(heldIdx.map(() => 1)), parity: heldIdx.length >= 2 ? alt(riskParity(subCov, 0.15)) : alt(heldIdx.map(() => 1)) },
		loading: list.filter((_, i) => series[i].weeks === 0).map((x) => x.id)
	};
}

