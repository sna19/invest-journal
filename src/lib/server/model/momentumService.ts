import type Database from 'better-sqlite3';
import { israelDate } from '../../hypothesis.js';
import type { AppDb } from '../db.js';
import { createHypothesis } from '../journal.js';
import { setAuto } from '../portfolio.js';
import { loadMonthly, type MonthlySec } from '../market/monthly.js';
import { makeFetcher } from '../market/http.js';
import { choose, cleanMParams, MDEFAULTS, metrics, monthAdd, placebo, runBases, runVariant, verdict, windowMonths, type MParams, type MVariant, type Run, type Series } from './momentum.js';

/**
 * T-017 «Страновой моментум» in a user's journal: its parameters (model_settings, «M»), the data (monthly adjusted
 * closes of the countries' funds, SPY and BIL — loaded with the nightly monthly bars, or at once when the screen finds
 * them missing), the screen's numbers and, on the first trading day of a month, the hypotheses of variants A and B with
 * their automatic portfolios — as the quarterly model does (T-009).
 */

export const MSOURCE: Record<MVariant, string> = { A: 'Страновой моментум — относительный', B: 'Страновой моментум — двойной' };
const US = ['NYSE', 'NASDAQ', 'NYSE_AMERICAN', 'NYSE_ARCA', 'CBOE_BZX'];

export function readMParams(app: Database.Database): MParams {
	const r = app.prepare(`select params from model_settings where variant = 'M'`).get() as { params: string } | undefined;
	return r ? cleanMParams(JSON.parse(r.params)) : { ...MDEFAULTS };
}
export function writeMParams(app: Database.Database, input: Record<string, unknown>) {
	const p = cleanMParams(input, readMParams(app));
	app.prepare(`insert into model_settings (variant, params, updated_at) values ('M', ?, ?) on conflict (variant) do update set params = excluded.params, updated_at = excluded.updated_at`).run(JSON.stringify(p), new Date().toISOString());
	return p;
}

/** the funds by symbol on a US exchange */
function idsOf(market: Database.Database, symbols: string[]) {
	const q = market.prepare(`select s.id, s.symbol, p.provider_symbol as yahoo from ref_securities s join ref_provider_symbols p on p.security_id = s.id and p.provider_code = 'yahoo'
		where s.symbol = ? and s.active = 1 and s.exchange_code in (${US.map(() => '?').join(',')}) order by s.id limit 1`);
	return symbols.map((s) => q.get(s, ...US) as MonthlySec | undefined).filter((x): x is MonthlySec => !!x);
}

/** the symbols every user's momentum needs — for the nightly monthly load */
export function momentumSymbols(apps: Database.Database[]) {
	return [...new Set(apps.flatMap((a) => { const p = readMParams(a); return [...p.universe, p.safe, 'SPY']; }))];
}
export const momentumIds = (market: Database.Database, symbols: string[]) => idsOf(market, symbols);

export function seriesOf(market: Database.Database, symbols: string[]): { series: Series; lastMonth: string | null } {
	const series: Series = new Map();
	const q = market.prepare('select month, adj_close as a from market_prices_monthly where security_id = ? order by month');
	for (const s of idsOf(market, symbols)) {
		const rows = q.all(s.id) as { month: string; a: number }[];
		if (rows.length) series.set(s.symbol, new Map(rows.map((r) => [r.month, r.a])));
	}
	const spy = series.get('SPY');
	const lastMonth = spy ? [...spy.keys()].at(-1)! : null;
	return { series, lastMonth };
}

let loading: Promise<unknown> | null = null;
/** the funds without monthly prices are loaded now (in the background) — the screen says so meanwhile */
export function ensureData(market: Database.Database, p: MParams) {
	const all = [...p.universe, p.safe, 'SPY'];
	const have = new Set(market.prepare(`select distinct security_id as id from market_prices_monthly`).all().map((r) => (r as { id: number }).id));
	const missing = idsOf(market, all).filter((s) => !have.has(s.id));
	if (missing.length && !loading) loading = loadMonthly(market, missing, makeFetcher({ retries: 1 }), { pause: 300 }).catch((e) => console.error(`momentum: ${e}`)).finally(() => (loading = null));
	return { missing: missing.map((s) => s.symbol), unknown: all.filter((s) => !idsOf(market, [s]).length), loading: !!loading };
}

/** the slow parts of the screen (the walk, the placebo) by their inputs — the last few */
const memo = new Map<string, unknown>();
function cached<T>(key: string, f: () => T): T {
	if (memo.has(key)) return memo.get(key) as T;
	const v = f();
	memo.set(key, v);
	if (memo.size > 40) memo.delete(memo.keys().next().value!);
	return v;
}

const r1 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 10);

function row(name: string, run: Run, rf: number[], months: string[], check: number) {
	const full = metrics(run.returns, rf);
	const last = metrics(run.returns.slice(-check), rf.slice(-check));
	return {
		name,
		full: { cagr: r1(full.cagr), maxDrawdown: r1(full.maxDrawdown), vol: r1(full.vol), sharpe: full.sharpe === null ? null : Math.round(full.sharpe * 100) / 100 },
		check: { cagr: r1(last.cagr), maxDrawdown: r1(last.maxDrawdown), vol: r1(last.vol), sharpe: last.sharpe === null ? null : Math.round(last.sharpe * 100) / 100 },
		safeShare: r1(run.safeShare),
		turnover: r1(run.turnover)
	};
}

/**
 * The screen: the current signal and what changed since last month; the table of A, B and the three bases over the
 * window and over its last 3 years («проверочные годы»); the check without peeking (L and N chosen on the earlier years,
 * judged on the last 3); the placebo; the curves.
 */
export function momentumView(app: Database.Database, market: Database.Database, over: Record<string, unknown> = {}) {
	const t0 = Date.now();
	const p = cleanMParams(over, readMParams(app));
	const data = ensureData(market, p);
	const { series, lastMonth } = seriesOf(market, [...p.universe, p.safe, 'SPY']);
	if (!lastMonth || !series.get(p.safe)) return { params: p, data, ready: false as const, ms: Date.now() - t0 };
	const months = windowMonths(series, p, lastMonth);
	const rf = months.map((m) => {
		const s = series.get(p.safe)!;
		const a = s.get(monthAdd(m, -1));
		const b = s.get(m);
		return a && b ? b / a - 1 : 0;
	});
	const check = Math.min(36, Math.floor(months.length / 3));
	const A = runVariant(series, p, months, 'A');
	const B = runVariant(series, p, months, 'B');
	const bases = runBases(series, p, months);
	const table = [row('A', A, rf, months, check), row('B', B, rf, months, check), row('SPY', bases.spy, rf, months, check), row('EQUAL', bases.eq, rf, months, check), row('LEADERS', bases.leaders, rf, months, check)];

	// without peeking: L and N chosen by Sharpe on the years before the last 3, then run on the last 3
	const early = months.slice(0, months.length - check);
	const late = months.slice(months.length - check);
	const base = [p.universe.join(','), p.safe, p.rebalance, p.years, p.commissionPct, p.taxPct, lastMonth, series.size].join('|');
	const walk = cached(`walk|${base}|${p.skip}`, () => (['A', 'B'] as const).map((v) => {
		let best: { L: number; N: number; sharpe: number } | null = null;
		for (const L of [3, 6, 9, 12])
			for (const N of [1, 2, 3, 4, 5]) {
				const q = { ...p, lookback: L, top: N };
				const run = runVariant(series, q, early, v);
				const s = metrics(run.returns, rf.slice(0, early.length)).sharpe ?? -9;
				if (!best || s > best.sharpe) best = { L, N, sharpe: s };
			}
		const q = { ...p, lookback: best!.L, top: best!.N };
		const run = runVariant(series, q, late, v);
		const m = metrics(run.returns, rf.slice(-check));
		return { variant: v, lookback: best!.L, top: best!.N, cagr: r1(m.cagr), sharpe: m.sharpe === null ? null : Math.round(m.sharpe * 100) / 100 };
	}));

	// the placebo does not depend on L and S: a change of L is answered without it
	const rnd = cached(`placebo|${base}|${p.top}`, () => placebo(series, p, months, 100));
	const pl = (['A', 'B'] as const).map((v) => {
		const c = metrics(v === 'A' ? A.returns : B.returns, rf).cagr;
		const vd = verdict(c, rnd);
		return { variant: v, share: r1(vd.share), verdict: vd.verdict };
	});

	// now: the choice for the coming month, and what changed since the last rebalance
	const next = monthAdd(lastMonth, 1);
	const current = (['A', 'B'] as const).map((v) => {
		const c = choose(series, p, next, v);
		const prev = choose(series, p, lastMonth, v);
		const hold = c.picks.map((x) => (x.toSafe ? p.safe : x.symbol));
		const before = prev.picks.map((x) => (x.toSafe ? p.safe : x.symbol));
		return { variant: v, month: next, picks: c.picks.map((x) => ({ ...x, signal: r1(x.signal) })), hold, in: [...new Set(hold.filter((s) => !before.includes(s)))], out: [...new Set(before.filter((s) => !hold.includes(s)))] };
	});
	const ranking = choose(series, p, next, 'A').ranking.map((x) => ({ symbol: x.symbol, signal: r1(x.signal) }));
	const safeSignal = r1(choose(series, p, next, 'A').safeSignal);
	const curve = (run: Run) => run.curve.map((x) => ({ date: `${x.month}-28`, value: Math.round((x.value - 1) * 10000) / 100 }));
	return {
		ready: true as const,
		params: p,
		data,
		lastMonth,
		window: { from: months[0], to: months.at(-1), checkFrom: late[0] },
		current,
		ranking,
		safeSignal,
		table,
		walk,
		placebo: pl,
		costs: { A: Math.round(A.costs * 1000) / 10, B: Math.round(B.costs * 1000) / 10 },
		curves: { A: curve(A), B: curve(B), SPY: curve(bases.spy), EQUAL: curve(bases.eq), LEADERS: curve(bases.leaders) },
		ms: Date.now() - t0
	};
}

function sourceOf(app: Database.Database, v: MVariant) {
	const r = app.prepare('select id from sources where name = ?').get(MSOURCE[v]) as { id: number } | undefined;
	if (r) return r.id;
	return Number(app.prepare(`insert into sources (name, kind, market, notes) values (?, 'model', 'any', 'T-017: модель «Страновой моментум»')`).run(MSOURCE[v]).lastInsertRowid);
}
function versionOf(app: Database.Database, v: MVariant, p: MParams, sourceId: number) {
	const json = JSON.stringify(p);
	const key = `M${v}`;
	const r = app.prepare('select id from model_versions where variant = ? and params = ?').get(key, json) as { id: number } | undefined;
	if (r) return r.id;
	return Number(app.prepare('insert into model_versions (variant, params, source_id) values (?, ?, ?)').run(key, json, sourceId).lastInsertRowid);
}

/**
 * On the first weekday of a month (a quarter, with that rebalance): the variant's choice becomes hypotheses — «Рекомендация»,
 * long, until the next rebalance, simulation — once per month; its automatic portfolio buys them. The refuge is not
 * recorded (B's part in BIL is «no country»).
 */
export function recordMomentum(db: AppDb, app: Database.Database, market: Database.Database, v: MVariant, now = new Date(), force = false) {
	const today = israelDate(now);
	const month = today.slice(0, 7);
	const key = `M${v}`;
	const out = { variant: key, month, recorded: 0, skipped: null as string | null };
	if (app.prepare('select 1 from model_quarters where variant = ? and quarter = ?').get(key, month)) return { ...out, skipped: 'already' };
	const p = readMParams(app);
	const day = Number(today.slice(8, 10));
	const wd = new Date(today + 'T12:00:00Z').getUTCDay();
	const rebalance = p.rebalance === 'month' || ['01', '04', '07', '10'].includes(today.slice(5, 7));
	if (!force && (!rebalance || day > 5 || wd === 0 || wd === 6)) return { ...out, skipped: 'not a rebalance day' };
	const { series, lastMonth } = seriesOf(market, [...p.universe, p.safe, 'SPY']);
	if (lastMonth !== monthAdd(month, -1)) return { ...out, skipped: `the monthly prices end at ${lastMonth}` };
	const c = choose(series, p, month, v);
	const ids = new Map(idsOf(market, c.picks.map((x) => x.symbol)).map((s) => [s.symbol, s.id]));
	const sourceId = sourceOf(app, v);
	const versionId = versionOf(app, v, p, sourceId);
	const [y, m] = month.split('-').map(Number);
	const end = new Date(Date.UTC(y, m - 1 + (p.rebalance === 'quarter' ? 3 : 1), 0)).toISOString().slice(0, 10);
	app.transaction(() => {
		c.picks.forEach((x, i) => {
			if (x.toSafe || !ids.get(x.symbol)) return;
			createHypothesis(
				db,
				market,
				{
					sourceId,
					securityId: ids.get(x.symbol)!,
					signalType: 'recommendation',
					direction: 'long',
					directionSource: 'article',
					thesis: `${month}: рост за ${p.lookback} мес.${p.skip ? ` без последнего` : ''} ${(x.signal * 100).toFixed(1).replace('.', ',')}% — место ${i + 1} из ${c.ranking.length}${v === 'B' ? `, выше убежища ${p.safe}` : ''}`,
					invalidation: 'Фонд страны не обгонит рынок до следующей ребалансировки',
					mode: 'sim',
					horizon: 'date',
					horizonDate: end,
					tags: `страновой моментум ${v}, ${month}`
				},
				now,
				{ modelVersionId: versionId }
			);
			out.recorded++;
		});
		app.prepare('insert into model_quarters (variant, quarter, version_id, hypotheses) values (?, ?, ?, ?)').run(key, month, versionId, out.recorded);
	})();
	setAuto(app, market, sourceId, true, now);
	return out;
}
