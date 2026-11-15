import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';

/**
 * Spec section 6 — prices and the result of a hypothesis.
 * Entry: the close of the first trading day from the record date. Exit: the close of the last trading day not
 * later than the horizon. Return: exit / entry − 1 on dividend-adjusted closes; for a «down» hypothesis the sign
 * changes — for the benchmark too, so that the excess tells whether the security did worse than the market.
 * Hit — excess > 0. Prices and the outcome are copied into the hypothesis row: a later fix of market data does
 * not change a closed hypothesis (section 14; the app.db trigger enforces it).
 */

export interface Point {
	date: string;
	close: number;
	adj: number;
}

export interface Result {
	returnPct: number;
	benchmarkReturnPct: number;
	excessPct: number;
}

export function result(direction: string, entry: { s: Point; b: Point }, exit: { s: Point; b: Point }): Result {
	const sign = direction === 'short' ? -1 : 1;
	const r = sign * (exit.s.adj / entry.s.adj - 1) * 100;
	const rb = sign * (exit.b.adj / entry.b.adj - 1) * 100;
	const round = (x: number) => Math.round(x * 10000) / 10000;
	return { returnPct: round(r), benchmarkReturnPct: round(rb), excessPct: round(r - rb) };
}

/** A pair of the security's and the benchmark's prices on the same trading day. */
export class Prices {
	private onOrAfter: Database.Statement;
	private onOrBefore: Database.Statement;
	private latest: Database.Statement;
	constructor(private market: Database.Database) {
		const pair = (cmp: string, order: string) =>
			market.prepare(
				`select s.date, s.close as sc, s.adj_close as sa, b.close as bc, b.adj_close as ba
				   from market_prices_adjusted s join market_prices_adjusted b on b.date = s.date and b.security_id = ?
				  where s.security_id = ? and s.date ${cmp} ? order by s.date ${order} limit 1`
			);
		this.onOrAfter = pair('>=', 'asc');
		this.onOrBefore = pair('<=', 'desc');
		this.latest = market.prepare('select max(date) as d from market_prices_daily where security_id = ?');
	}
	private row(r: { date: string; sc: number; sa: number; bc: number; ba: number } | undefined) {
		return r ? { date: r.date, s: { date: r.date, close: r.sc, adj: r.sa }, b: { date: r.date, close: r.bc, adj: r.ba } } : null;
	}
	firstFrom(sec: number, bench: number, date: string) {
		return this.row(this.onOrAfter.get(bench, sec, date) as never);
	}
	lastUpTo(sec: number, bench: number, date: string) {
		return this.row(this.onOrBefore.get(bench, sec, date) as never);
	}
	lastDate(sec: number): string | null {
		return (this.latest.get(sec) as { d: string | null }).d;
	}
}

interface Open {
	id: number;
	security_id: number;
	benchmark_id: number;
	direction: string;
	entry_date: string;
	entry_price: number | null;
	entry_price_date: string | null;
	horizon_date: string;
}

export interface Summary {
	entries: number;
	updated: number;
	closed: number;
	waiting: { id: number; why: string }[];
}

/** Days a horizon may stay without a benchmark price after it before the hypothesis closes on what there is. */
const GRACE_DAYS = 5;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * The daily step for hypotheses: entry prices for those «ожидает цену», the current result of open ones,
 * closing those whose horizon has come. Never closes on incomplete data.
 */
export function updateHypotheses(app: Database.Database, market: Database.Database, now = new Date()): Summary {
	const today = israelDate(now);
	const p = new Prices(market);
	const out: Summary = { entries: 0, updated: 0, closed: 0, waiting: [] };
	const open = app
		.prepare(`select id, security_id, benchmark_id, direction, entry_date, entry_price, entry_price_date, horizon_date from hypotheses where status = 'open'`)
		.all() as Open[];
	const setEntry = app.prepare('update hypotheses set entry_price = ?, benchmark_entry = ?, entry_price_date = ? where id = ?');
	const setCurrent = app.prepare(
		`update hypotheses set last_date = ?, last_price = ?, benchmark_last = ?, current_return_pct = ?, current_benchmark_return_pct = ?,
		        current_excess_pct = ? where id = ?`
	);
	const close = app.prepare(
		`update hypotheses set status = 'closed', exit_date = ?, exit_price = ?, benchmark_exit = ?, return_pct = ?, benchmark_return_pct = ?,
		        excess_pct = ?, outcome = ?, last_date = ?, last_price = ?, benchmark_last = ?, current_return_pct = ?,
		        current_benchmark_return_pct = ?, current_excess_pct = ? where id = ? and status = 'open'`
	);

	for (const h of open) {
		let entry = h.entry_price_date ? p.firstFrom(h.security_id, h.benchmark_id, h.entry_price_date) : null;
		if (h.entry_price === null) {
			entry = p.firstFrom(h.security_id, h.benchmark_id, h.entry_date);
			if (!entry || entry.date > today) {
				out.waiting.push({ id: h.id, why: 'нет цены входа' });
				continue;
			}
			setEntry.run(entry.s.close, entry.b.close, entry.date, h.id);
			out.entries++;
		}
		if (!entry) continue;

		const due = h.horizon_date < today;
		const benchLast = p.lastDate(h.benchmark_id);
		const exitDay = p.lastUpTo(h.security_id, h.benchmark_id, due ? h.horizon_date : today);
		if (!exitDay || exitDay.date < entry.date) continue;
		const r = result(h.direction, entry, exitDay);

		if (due) {
			// all trading days up to the horizon must be known: the benchmark has a day on/after it, or the grace passed
			const known = benchLast !== null && (benchLast >= h.horizon_date || today > addDays(h.horizon_date, GRACE_DAYS));
			// and the security itself must have a price near the horizon, not a week before it
			const calendarLast = (market
				.prepare(
					`select max(t.date) as d from ref_trading_days t
					   join ref_securities s on s.id = ? join ref_exchanges e on e.code = s.exchange_code
					  where t.exchange_code = case e.country when 'IL' then 'TASE' else 'US' end and t.date <= ?`
				)
				.get(h.security_id, h.horizon_date) as { d: string | null }).d;
			const behind = calendarLast
				? (market.prepare('select count(*) as n from ref_trading_days t join ref_securities s on s.id = ? join ref_exchanges e on e.code = s.exchange_code where t.exchange_code = case e.country when \'IL\' then \'TASE\' else \'US\' end and t.date > ? and t.date <= ?').get(h.security_id, exitDay.date, calendarLast) as { n: number }).n
				: 0;
			if (known && behind <= 2) {
				close.run(
					exitDay.date, exitDay.s.close, exitDay.b.close, r.returnPct, r.benchmarkReturnPct, r.excessPct, r.excessPct > 0 ? 'hit' : 'miss',
					exitDay.date, exitDay.s.close, exitDay.b.close, r.returnPct, r.benchmarkReturnPct, r.excessPct, h.id
				);
				out.closed++;
				continue;
			}
			out.waiting.push({ id: h.id, why: known ? `нет цены бумаги за ${behind} торг. дн. до срока` : 'нет данных по сроку' });
		}
		setCurrent.run(exitDay.date, exitDay.s.close, exitDay.b.close, r.returnPct, r.benchmarkReturnPct, r.excessPct, h.id);
		out.updated++;
	}
	return out;
}

/** Spec section 6: early close by hand, with a reason; the result is fixed on the last trading day up to today. */
export function closeEarly(app: Database.Database, market: Database.Database, id: number, reason: string, now = new Date()) {
	const h = app
		.prepare(`select id, security_id, benchmark_id, direction, entry_price, entry_price_date, status from hypotheses where id = ?`)
		.get(id) as (Open & { status: string }) | undefined;
	if (!h) return { error: 'нет такой гипотезы' } as const;
	if (h.status !== 'open') return { error: 'гипотеза уже закрыта' } as const;
	if (!reason.trim()) return { error: 'Укажите причину досрочного закрытия' } as const;
	if (h.entry_price === null || !h.entry_price_date) return { error: 'Цены входа ещё нет — закрыть можно после первой цены' } as const;
	const p = new Prices(market);
	const entry = p.firstFrom(h.security_id, h.benchmark_id, h.entry_price_date)!;
	const exit = p.lastUpTo(h.security_id, h.benchmark_id, israelDate(now));
	if (!exit) return { error: 'Нет цен для закрытия' } as const;
	const r = result(h.direction, entry, exit);
	app
		.prepare(
			`update hypotheses set status = 'closed_early', exit_date = ?, exit_price = ?, benchmark_exit = ?, return_pct = ?,
			        benchmark_return_pct = ?, excess_pct = ?, outcome = ?, close_reason = ? where id = ? and status = 'open'`
		)
		.run(exit.date, exit.s.close, exit.b.close, r.returnPct, r.benchmarkReturnPct, r.excessPct, r.excessPct > 0 ? 'hit' : 'miss', reason.trim().slice(0, 500), id);
	return { ok: true, ...r, exitDate: exit.date } as const;
}

/** Security against benchmark from the entry, both starting at 100 — for the small chart in the list. */
export function spark(market: Database.Database, sec: number, bench: number, from: string, to: string, points = 32) {
	const rows = market
		.prepare(
			`select s.date, s.adj_close as s, b.adj_close as b from market_prices_adjusted s
			   join market_prices_adjusted b on b.security_id = ? and b.date = s.date
			  where s.security_id = ? and s.date between ? and ? order by s.date`
		)
		.all(bench, sec, from, to) as { date: string; s: number; b: number }[];
	if (rows.length < 2) return null;
	const step = Math.max(1, Math.ceil(rows.length / points));
	const pick = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
	return pick.map((r) => [Math.round((r.s / rows[0].s) * 10000) / 100, Math.round((r.b / rows[0].b) * 10000) / 100]);
}
