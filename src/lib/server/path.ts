import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { fifo, twr } from '../portfolio.js';
import { FLAG_DEFAULTS, FLAGS, flagsOf, monthAdd, monthlyReturns, type Flag, type FlagParams, type MonthPt } from '../path.js';
import { getSetting, setSetting } from './risk.js';
import { addEntry } from './diary.js';
import { addSnapshot } from './snapshots.js';
import { FLAG_NAME } from '../path.js';
import { benchmarkId, book, marketView } from './portfolio.js';
import { splitScale } from './market/splits.js';

/**
 * T-033 «Путь доходности» (owner, 26.11.2026): «+85% за 3 года» hides that all of it was made in the first two
 * years. Here the server's part: the daily value with dividends in the current split scale, the periods, the month
 * ends, the drawdowns, the relative strength, the marks and their states (a new mark of a held position is a signal
 * until «Пересмотрел»), and the same path for a portfolio by its time-weighted return.
 */

export interface Pt {
	date: string;
	v: number;
}

/** the daily value of a security with its dividends reinvested on their ex-dates, in the current split scale */
export function trSeries(market: Database.Database, id: number, from?: string): Pt[] {
	const scale = splitScale(market, id);
	const rows = market.prepare(`select date, close from market_prices_daily where security_id = ? ${from ? 'and date >= ?' : ''} order by date`).all(...(from ? [id, from] : [id])) as { date: string; close: number }[];
	const divs = market.prepare(`select ex_date as date, amount from market_corporate_actions where security_id = ? and kind = 'dividend' and amount > 0 order by ex_date`).all(id) as { date: string; amount: number }[];
	const out: Pt[] = [];
	let v = 1;
	let j = 0;
	for (let i = 0; i < rows.length; i++) {
		const c = rows[i].close / scale(rows[i].date);
		if (i > 0) {
			const p = rows[i - 1].close / scale(rows[i - 1].date);
			let d = 0;
			while (j < divs.length && divs[j].date <= rows[i].date) {
				if (divs[j].date > rows[i - 1].date) d += divs[j].amount / scale(divs[j].date);
				j++;
			}
			// a dividend larger than the price is a data error: left out
			v *= p > 0 ? (c + (d < p ? d : 0)) / p : 1;
		} else while (j < divs.length && divs[j].date <= rows[0].date) j++;
		out.push({ date: rows[i].date, v });
	}
	return out;
}

/** the index's closes as a series (a price index: no dividends, as everywhere in the app) */
function indexSeries(market: Database.Database, id: number | null | undefined, from?: string): Pt[] {
	if (!id) return [];
	return (market.prepare(`select date, close as v from market_prices_daily where security_id = ? ${from ? 'and date >= ?' : ''} order by date`).all(...(from ? [id, from] : [id])) as Pt[]);
}

/** the market of a security: TA-125 for Tel Aviv, the S&P 500 for the rest */
export function marketIndexOf(market: Database.Database, securityId: number) {
	const ex = (market.prepare('select exchange_code as e from ref_securities where id = ?').get(securityId) as { e: string } | undefined)?.e;
	const key = ex === 'TASE' ? ('benchmark:TA125' as const) : ('benchmark:SPX' as const);
	return { id: benchmarkId(market, key), label: ex === 'TASE' ? 'ТА-125' : 'S&P 500' };
}

/** the last value on or before a date (binary search) */
export function valueAt(s: Pt[], date: string): number | null {
	let lo = 0;
	let hi = s.length - 1;
	let ans = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (s[mid].date <= date) {
			ans = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return ans < 0 ? null : s[ans].v;
}

const dayAdd = (d: string, months: number, years = 0) => {
	const t = new Date(d + 'T12:00:00Z');
	t.setUTCFullYear(t.getUTCFullYear() + years, t.getUTCMonth() + months);
	return t.toISOString().slice(0, 10);
};

export const PERIODS = ['1m', '3m', '6m', 'ytd', '1y', '3y', '5y'] as const;
export type PeriodKey = (typeof PERIODS)[number] | 'buy';

export interface Period {
	key: PeriodKey;
	from: string;
	ret: number | null;
	/** a period longer than a year: the yearly rate */
	perYear: number | null;
	/** over the market: the return minus the market's (a year rate for the long ones) */
	excess: number | null;
}

/** the row of periods: each from the last value on or before its start to the last value */
export function periods(s: Pt[], b: Pt[], buy: string | null = null): Period[] {
	if (!s.length) return [];
	const end = s.at(-1)!.date;
	const first = s[0].date;
	const starts: [PeriodKey, string][] = [
		['1m', dayAdd(end, -1)],
		['3m', dayAdd(end, -3)],
		['6m', dayAdd(end, -6)],
		['ytd', `${Number(end.slice(0, 4)) - 1}-12-31`],
		['1y', dayAdd(end, 0, -1)],
		['3y', dayAdd(end, 0, -3)],
		['5y', dayAdd(end, 0, -5)]
	];
	if (buy) starts.push(['buy', buy]);
	const vEnd = s.at(-1)!.v;
	const bEnd = b.length ? valueAt(b, end) : null;
	return starts.map(([key, from]) => {
		// not enough history: the period starts before the first day (a buy period always has its start)
		// a few days short (holidays, a period starting on a weekend) count as enough
		const enough = key === 'buy' || from >= first || Date.parse(first) - Date.parse(from) <= 7 * 86_400_000;
		const v0 = valueAt(s, from) ?? (enough ? s[0].v : null);
		const ret = enough && v0 ? vEnd / v0 - 1 : null;
		const days = (Date.parse(end) - Date.parse(from)) / 86_400_000;
		const b0 = b.length ? valueAt(b, from) : null;
		const bret = b0 && bEnd ? bEnd / b0 - 1 : null;
		const long = days > 370;
		const perYear = ret !== null && long ? (1 + ret) ** (365.25 / days) - 1 : null;
		const bPerYear = bret !== null && long ? (1 + bret) ** (365.25 / days) - 1 : null;
		const excess = ret === null || bret === null ? null : long ? perYear! - bPerYear! : ret - bret;
		return { key, from, ret, perYear, excess };
	});
}

/** the value at each month's last day (the current month: its last day so far) */
export function monthEnds(s: Pt[], b: Pt[]): MonthPt[] {
	const out: MonthPt[] = [];
	for (let i = 0; i < s.length; i++) {
		const m = s[i].date.slice(0, 7);
		if (i === s.length - 1 || s[i + 1].date.slice(0, 7) !== m) out.push({ m, v: s[i].v, b: b.length ? valueAt(b, s[i].date) : null });
	}
	return out;
}

export interface Drawdown {
	peak: string;
	trough: string;
	depth: number;
	/** calendar days peak → trough, trough → back at the peak (null — not yet) */
	fall: number;
	recovery: number | null;
}

/** «под водой»: how far under its high the value is, since when, and the three deepest drawdowns */
export function drawdowns(s: Pt[]) {
	const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
	let peak = s[0];
	let peakIdx = 0;
	const eps: Drawdown[] = [];
	let cur: Drawdown | null = null;
	const water: { date: string; value: number }[] = [];
	s.forEach((p, i) => {
		if (p.v >= peak.v) {
			if (cur) {
				cur.recovery = days(cur.trough, p.date);
				eps.push(cur);
				cur = null;
			}
			peak = p;
			peakIdx = i;
		} else {
			const d = p.v / peak.v - 1;
			if (!cur) cur = { peak: peak.date, trough: p.date, depth: d, fall: days(peak.date, p.date), recovery: null };
			else if (d < cur.depth) {
				cur.depth = d;
				cur.trough = p.date;
				cur.fall = days(peak.date, p.date);
			}
		}
		// weekly points are enough for the chart
		if (i === s.length - 1 || i % 5 === 0) water.push({ date: p.date, value: Math.round((p.v / peak.v - 1) * 1000) / 10 });
	});
	if (cur) eps.push(cur);
	const last = s.at(-1)!;
	return {
		current: last.v / peak.v - 1,
		high: peak.date,
		calendarDaysNoHigh: days(peak.date, last.date),
		tradingDaysNoHigh: s.length - 1 - peakIdx,
		top: [...eps].sort((a, b) => a.depth - b.depth).slice(0, 3),
		water
	};
}

/** the price over the index, 100 at the start (weekly points) */
export function relative(s: Pt[], b: Pt[], from: string) {
	const xs = s.filter((p) => p.date >= from);
	if (!xs.length || !b.length) return [];
	const b0 = valueAt(b, xs[0].date);
	if (!b0) return [];
	const out: { date: string; value: number }[] = [];
	xs.forEach((p, i) => {
		if (i % 5 && i !== xs.length - 1) return;
		const bv = valueAt(b, p.date);
		if (bv) out.push({ date: p.date, value: Math.round(((p.v / xs[0].v) / (bv / b0)) * 1000) / 10 });
	});
	return out;
}

export function readFlagParams(app: Database.Database): FlagParams {
	const raw = getSetting(app, 'path_flags');
	const p = { ...FLAG_DEFAULTS };
	if (!raw) return p;
	const x = JSON.parse(raw) as Record<string, unknown>;
	for (const k of Object.keys(p) as (keyof FlagParams)[]) if (Number.isFinite(Number(x[k])) && x[k] !== null && x[k] !== '') p[k] = Number(x[k]);
	if (![6, 12, 36].includes(p.window)) p.window = 12;
	return p;
}
export function writeFlagParams(app: Database.Database, input: Record<string, unknown>) {
	const p = { ...readFlagParams(app) };
	for (const k of Object.keys(p) as (keyof FlagParams)[]) if (input[k] !== undefined && Number.isFinite(Number(input[k]))) p[k] = Number(input[k]);
	if (![6, 12, 36].includes(p.window)) p.window = 12;
	setSetting(app, 'path_flags', JSON.stringify(p));
	return p;
}

/** the marks of a security from its series */
function flagsFrom(s: Pt[], b: Pt[], p: FlagParams): Flag[] {
	if (s.length < 30) return [];
	const per = periods(s, b);
	const get = (k: PeriodKey) => per.find((x) => x.key === k)!;
	const end = s.at(-1)!.date;
	const pts = monthEnds(s.filter((x) => x.date >= dayAdd(end, -1, -3)), b);
	const dd = drawdowns(s.filter((x) => x.date >= dayAdd(end, 0, -5)));
	return flagsOf({ cagr3: get('3y').perYear, ret12: get('1y').ret, excess12: get('1y').excess, ret1: get('1m').ret, daysNoHigh: dd.tradingDaysNoHigh, rets3: monthlyReturns(pts).slice(-36) }, p);
}

const flagCache = new Map<string, Flag[]>();
/** the marks of several securities (lists: positions, «Наблюдаю», candidates) — cached by their last day */
export function flagsFor(app: Database.Database, market: Database.Database, ids: number[]) {
	const p = readFlagParams(app);
	const lastQ = market.prepare('select date as d, close as c from market_prices_daily where security_id = ? order by date desc limit 1');
	const out: Record<number, Flag[]> = {};
	for (const id of [...new Set(ids)].slice(0, 200)) {
		const last = lastQ.get(id) as { d: string; c: number } | undefined;
		if (!last) continue;
		const d = last.d;
		const key = `${id}|${d}|${last.c}|${JSON.stringify(p)}`;
		if (!flagCache.has(key)) {
			const from = dayAdd(d, -1, -5);
			const idx = marketIndexOf(market, id);
			flagCache.set(key, flagsFrom(trSeries(market, id, from), indexSeries(market, idx.id, from), p));
			if (flagCache.size > 2000) flagCache.delete(flagCache.keys().next().value!);
		}
		if (flagCache.get(key)!.length) out[id] = flagCache.get(key)!;
	}
	return out;
}

/** the block «Как набиралась прибыль» of a security (and of a position: «с покупки», the months held) */
export function securityPath(app: Database.Database, market: Database.Database, id: number, opts: { positionId?: number } = {}) {
	const t0 = Date.now();
	const s = trSeries(market, id);
	if (s.length < 2) return null;
	const end = s.at(-1)!.date;
	const from10 = dayAdd(end, -1, -10);
	const series = s.filter((x) => x.date >= from10);
	const idx = marketIndexOf(market, id);
	const b = indexSeries(market, idx.id, from10);
	const p = readFlagParams(app);
	let buy: string | null = null;
	let held: { from: string; to: string | null }[] = [];
	if (opts.positionId) {
		const r = app.prepare('select opened_at as o, closed_at as c from positions where id = ?').get(opts.positionId) as { o: string; c: string | null } | undefined;
		const first = app.prepare(`select min(date) as d from position_events e where position_id = ? and kind in ('buy', 'opening') and not exists (select 1 from position_events r where r.reverses_event_id = e.id)`).get(opts.positionId) as { d: string | null };
		buy = first.d ?? r?.o ?? null;
		if (buy) held = [{ from: buy, to: r?.c ?? null }];
	} else {
		// the months it was held in any real portfolio
		held = (
			app
				.prepare(`select (select min(date) from position_events e where e.position_id = s.id and e.kind in ('buy', 'opening')) as "from", s.closed_at as "to" from positions s join portfolios p on p.id = s.portfolio_id where s.security_id = ? and p.kind = 'real' and p.auto_source_id is null`)
				.all(id) as { from: string | null; to: string | null }[]
		).filter((x): x is { from: string; to: string | null } => !!x.from);
	}
	const per = periods(series, b, buy);
	const pts = monthEnds(series, b);
	const dd = drawdowns(series);
	const flags = flagsFrom(series, b, p);
	return {
		securityId: id,
		asOf: end,
		market: idx.label,
		periods: per,
		months: pts.map((x) => ({ m: x.m, v: Math.round(x.v * 1e6) / 1e6, b: x.b === null ? null : Math.round(x.b * 1e4) / 1e4 })),
		held,
		drawdown: { ...dd, current: dd.current, top: dd.top },
		relative: relative(series, b, dayAdd(end, 0, -3)),
		flags,
		params: p,
		ms: Date.now() - t0
	};
}

// ── the marks of held positions: new ones are signals until «Пересмотрел» ─────────────────────────────────

export interface FlagState {
	id: number;
	securityId: number;
	flag: Flag;
	since: string;
	clearedAt: string | null;
	reviewedAt: string | null;
}

/** the securities held in the real portfolios */
function heldIds(app: Database.Database) {
	return (app.prepare(`select distinct s.security_id as id from positions s join portfolios p on p.id = s.portfolio_id where s.stage in ('holding', 'plan_sell') and p.kind = 'real' and p.auto_source_id is null and p.archived_at is null`).all() as { id: number }[]).map((r) => r.id);
}

/**
 * The daily pass (after the prices): a mark that appears on a held security opens a state (and, with `onNew`, a diary
 * entry); a mark that went away closes it. A state reviewed («Пересмотрел») stays quiet for 90 days.
 */
export function updateFlagStates(app: Database.Database, market: Database.Database, today = israelDate(), onNew?: (s: FlagState) => void) {
	const now = flagsFor(app, market, heldIds(app));
	const open = app.prepare('select id, security_id as securityId, flag, since, cleared_at as clearedAt, reviewed_at as reviewedAt from path_flags where cleared_at is null').all() as FlagState[];
	const has = new Set(open.map((s) => `${s.securityId}|${s.flag}`));
	let added = 0;
	let cleared = 0;
	app.transaction(() => {
		for (const s of open)
			if (!(now[s.securityId] ?? []).includes(s.flag)) {
				app.prepare('update path_flags set cleared_at = ? where id = ?').run(today, s.id);
				cleared++;
			}
		for (const [sid, flags] of Object.entries(now))
			for (const f of flags) {
				if (has.has(`${sid}|${f}`)) continue;
				const id = Number(app.prepare('insert into path_flags (security_id, flag, since) values (?, ?, ?)').run(Number(sid), f, today).lastInsertRowid);
				added++;
				onNew?.({ id, securityId: Number(sid), flag: f, since: today, clearedAt: null, reviewedAt: null });
			}
	})();
	return { added, cleared };
}

/** the marks that ask for a look now: open, and not reviewed in the last 90 days */
export function flagSignals(app: Database.Database, today = israelDate()) {
	const quiet = dayAdd(today, -3);
	return app.prepare('select id, security_id as securityId, flag, since, cleared_at as clearedAt, reviewed_at as reviewedAt from path_flags where cleared_at is null and (reviewed_at is null or reviewed_at <= ?)').all(quiet) as FlagState[];
}
export function reviewFlag(app: Database.Database, id: number, today = israelDate()) {
	return app.prepare('update path_flags set reviewed_at = ? where id = ?').run(today, id).changes;
}

/** a new mark: a system entry in the diary with the mosaic as it was (the snapshot «path») */
export function flagEntry(app: Database.Database, market: Database.Database, s: FlagState) {
	const v = securityPath(app, market, s.securityId);
	const sym = (market.prepare('select symbol from ref_securities where id = ?').get(s.securityId) as { symbol: string } | undefined)?.symbol ?? '';
	if (!v) return null;
	const per = (k: string) => v.periods.find((x) => x.key === k);
	const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')}%`);
	const body = `<p>Метка «${FLAG_NAME[s.flag][0]}» у ${sym}: за 3 года ${pct(per('3y')?.ret)} (${pct(per('3y')?.perYear)} в год), за 12 месяцев ${pct(per('1y')?.ret)}, к рынку ${pct(per('1y')?.excess)}, за месяц ${pct(per('1m')?.ret)}. Не команда продать — повод пересмотреть тезис.</p>`;
	const entryId = addEntry(app, market, { kind: 'observation', body, format: 'html', links: [{ type: 'security', id: String(s.securityId), primary: true }] }, { origin: `path:${s.id}` });
	if (entryId) addSnapshot(app, entryId, { type: 'path', params: { symbol: sym, flag: s.flag, asOf: v.asOf, market: v.market }, data: { months: v.months.slice(-121), periods: v.periods, held: v.held } });
	return entryId;
}

// ── a portfolio ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The portfolio's path by its time-weighted return in its currency: month ends (and the periods' starts) as marks of
 * the chain, its market's index alongside; the positions' contribution by year: each one's gain of the year (its
 * value at the year's end and its sales, less its value at the start and its purchases) over the portfolio's value
 * at the year's start.
 */
export function portfolioPath(app: Database.Database, market: Database.Database, portfolioId: number, today = israelDate()) {
	const p = app.prepare('select currency from portfolios where id = ?').get(portfolioId) as { currency: string } | undefined;
	if (!p) return null;
	const m = marketView(market);
	const { book: b, rows } = book(app, m, portfolioId);
	const firstTrade = b.positions.flatMap((x) => x.trades.map((t) => t.date)).sort()[0];
	if (!firstTrade) return null;
	const marks: string[] = [];
	for (let mo = firstTrade.slice(0, 7); mo <= today.slice(0, 7); mo = monthAdd(mo, 1)) {
		const last = new Date(Date.UTC(Number(mo.slice(0, 4)), Number(mo.slice(5, 7)), 0)).toISOString().slice(0, 10);
		marks.push(last < today ? last : today);
	}
	const starts = PERIODS.map((k) => (k === 'ytd' ? `${Number(today.slice(0, 4)) - 1}-12-31` : k.endsWith('m') ? dayAdd(today, -Number(k[0])) : dayAdd(today, 0, -Number(k[0])))).filter((d) => d > firstTrade);
	const t = twr(b, m, today, [...marks, ...starts]);
	const s: Pt[] = t.series.map((x) => ({ date: x.date, v: x.growth })).filter((x) => x.v > 0);
	const idx = benchmarkId(market, p.currency === 'USD' ? 'benchmark:SPX' : 'benchmark:TA125');
	const bench = indexSeries(market, idx, dayAdd(firstTrade, -1));
	const per = periods(s, bench).map((x) => (x.from < firstTrade ? { ...x, ret: null, perYear: null, excess: null } : x));
	const pts = monthEnds(s, bench);

	// the positions' contribution by year
	const years: number[] = [];
	for (let y = Number(firstTrade.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) years.push(y);
	const sym = new Map(rows.map((r) => [r.id, r.symbol]));
	const valueOf = (pos: (typeof b.positions)[number], d: string) => {
		const q = fifo(pos.trades, pos.f, d).qty;
		if (q <= 1e-9) return 0;
		const price = m.price(pos.securityId, d) ?? pos.trades.filter((x) => x.date <= d).at(-1)?.price ?? 0;
		return q * price * pos.f * m.conv(pos.currency, p.currency, d);
	};
	const total = (d: string) => t.series.filter((x) => x.date <= d).at(-1)?.value ?? 0;
	const contrib = b.positions
		.map((pos) => {
			const cells = years.map((y) => {
				const s0 = `${y - 1}-12-31`;
				const e = `${y}-12-31` < today ? `${y}-12-31` : today;
				let flow = 0;
				for (const x of pos.trades) {
					if (x.date <= s0 || x.date > e) continue;
					const money = (x.qty * x.price * pos.f + (x.kind === 'sell' ? -x.fee : x.fee)) * x.fx;
					flow += x.kind === 'sell' ? -money : money;
				}
				const gain = valueOf(pos, e) - valueOf(pos, s0) - flow;
				const base = total(s0) || t.series.find((x) => x.date.startsWith(String(y)))?.value || 0;
				return Math.abs(gain) < 0.005 ? null : { gain, pp: base > 0 ? (gain / base) * 100 : null };
			});
			return { positionId: pos.id, symbol: sym.get(pos.id) ?? '', cells };
		})
		.filter((r) => r.cells.some((c) => c !== null));
	return {
		portfolioId,
		currency: p.currency,
		market: p.currency === 'USD' ? 'S&P 500' : 'ТА-125',
		periods: per,
		months: pts,
		years,
		contrib,
		flagNames: FLAGS
	};
}
