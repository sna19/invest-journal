import type Database from 'better-sqlite3';
import { israelDate, type Errors } from '../hypothesis.js';
import { InputError } from './journal.js';
import { addEntry } from './diary.js';
import { marketView } from './portfolio.js';
import { signals, type Signal } from './discipline.js';
import { sanitize, plainText } from './richtext.js';

/**
 * T-032 11г «Напоминания» (spec 23, Д-27 — Д-31). A reminder belongs to an entry (a decision has one too): by a date or by
 * a condition on the prices or the calendar. The check runs with the daily prices, every five minutes with the live
 * quotes and whenever «Сигналы» is read. A fired one stands until snoozed (a day, a week, a month, a date — counted, from
 * the third time marked) or closed with a conclusion (a linked entry «вывод»). The trade discipline's signals (T-015)
 * stand in the same block and are snoozed the same way.
 */

export const CONDITIONS = ['date', 'price_above', 'price_below', 'change', 'drawdown', 'report', 'quarter_start', 'horizon'] as const;
export type Condition = (typeof CONDITIONS)[number];

const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(String(v).replace(',', '.')));
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
export function addMonths(d: string, n: number) {
	const [y, m, day] = d.split('-').map(Number);
	const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
	return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}
const quarterStart = (d: string) => {
	const [y, m] = d.split('-').map(Number);
	return `${y}-${String((Math.ceil(m / 3) - 1) * 3 + 1).padStart(2, '0')}-01`;
};

interface Row {
	id: number;
	entryId: number;
	condition: Condition;
	params: string;
	title: string;
	state: string;
	nextDue: string | null;
	snoozes: number;
	firedAt: string | null;
	closedAt: string | null;
	createdAt: string;
}
const SELECT = `select id, entry_id as entryId, condition, params, title, state, next_due as nextDue, snoozes, fired_at as firedAt, closed_at as closedAt, created_at as createdAt from reminders`;
const event = (app: Database.Database, id: number, kind: string, note: string | null = null) =>
	app.prepare('insert into reminder_events (reminder_id, kind, note) values (?, ?, ?)').run(id, kind, note);

export interface ReminderInput {
	entryId?: unknown;
	condition?: unknown;
	title?: unknown;
	date?: unknown;
	securityId?: unknown;
	positionId?: unknown;
	hypothesisId?: unknown;
	level?: unknown;
	days?: unknown;
	pct?: unknown;
}

/** Д-27, Д-28: a reminder to an entry, its condition checked */
export function addReminder(app: Database.Database, input: ReminderInput) {
	const errors: Record<string, string> = {};
	const entryId = Number(input.entryId);
	const entry = app.prepare('select id, body_text as t from journal_entries where id = ?').get(entryId) as { id: number; t: string } | undefined;
	if (!entry) errors.entryId = 'Нет такой записи';
	const c = (CONDITIONS as readonly string[]).includes(String(input.condition)) ? (input.condition as Condition) : null;
	if (!c) errors.condition = 'Условие напоминания';
	let params: Record<string, unknown> = {};
	let nextDue: string | null = null;
	const sec = Number(input.securityId);
	if (c === 'date') {
		if (!isDate(input.date)) errors.date = 'Дата';
		else (params = { date: input.date }), (nextDue = input.date);
	} else if (c === 'price_above' || c === 'price_below') {
		const level = num(input.level);
		if (!(sec > 0)) errors.securityId = 'Бумага';
		if (!(level > 0)) errors.level = 'Уровень цены больше нуля';
		params = { securityId: sec, level };
	} else if (c === 'change') {
		const days = Math.round(num(input.days));
		const pct = num(input.pct);
		if (!(sec > 0)) errors.securityId = 'Бумага';
		if (!(days >= 1 && days <= 365)) errors.days = 'От 1 до 365 дней';
		if (!(pct > 0)) errors.pct = 'Изменение больше нуля, %';
		params = { securityId: sec, days, pct };
	} else if (c === 'drawdown') {
		const pos = Number(input.positionId);
		const pct = num(input.pct);
		if (!(pos > 0) || !app.prepare('select 1 from positions where id = ?').get(pos)) errors.positionId = 'Позиция';
		if (!(pct > 0)) errors.pct = 'Просадка больше нуля, %';
		params = { positionId: pos, pct };
	} else if (c === 'report') {
		const days = Math.round(num(input.days));
		if (!(sec > 0)) errors.securityId = 'Бумага';
		if (!(days >= 0 && days <= 60)) errors.days = 'От 0 до 60 дней';
		params = { securityId: sec, days };
	} else if (c === 'horizon') {
		const h = Number(input.hypothesisId);
		if (!(h > 0) || !app.prepare('select 1 from hypotheses where id = ?').get(h)) errors.hypothesisId = 'Гипотеза';
		params = { hypothesisId: h };
	} else if (c === 'quarter_start') params = {};
	if (Object.keys(errors).length) throw new InputError(errors as Errors);
	const title = (typeof input.title === 'string' && input.title.trim() ? input.title.trim() : entry!.t.split('\n')[0]).slice(0, 140) || 'Напоминание';
	return app.transaction(() => {
		const id = (app.prepare('insert into reminders (entry_id, condition, params, title, next_due) values (?, ?, ?, ?, ?) returning id').get(entryId, c, JSON.stringify(params), title, nextDue) as { id: number }).id;
		event(app, id, 'created', describe(c!, params));
		return id;
	})();
}

/** a reminder's condition in words: «цена ≥ 120», «±8% за 5 дн.», «за 3 дн. до отчёта» */
export function describe(c: Condition, p: Record<string, unknown>) {
	if (c === 'date') return `дата ${String(p.date).split('-').reverse().join('.')}`;
	if (c === 'price_above') return `цена ≥ ${p.level}`;
	if (c === 'price_below') return `цена ≤ ${p.level}`;
	if (c === 'change') return `изменение ≥ ${p.pct}% за ${p.days} дн.`;
	if (c === 'drawdown') return `просадка позиции ≥ ${p.pct}%`;
	if (c === 'report') return `за ${p.days} дн. до отчёта`;
	if (c === 'quarter_start') return 'начало квартала';
	return 'конец горизонта гипотезы';
}

/** whether a waiting reminder's condition holds today */
function holds(app: Database.Database, market: Database.Database, m: ReturnType<typeof marketView>, r: Row, today: string): boolean {
	const p = JSON.parse(r.params) as { date: string; securityId: number; level: number; days: number; pct: number; positionId: number; hypothesisId: number };
	const price = (id: number) => m.dayMove(id)?.now ?? m.last(id)?.close ?? null;
	if (r.condition === 'date') return today >= p.date;
	if (r.condition === 'price_above' || r.condition === 'price_below') {
		const x = price(p.securityId);
		return x !== null && (r.condition === 'price_above' ? x >= p.level : x <= p.level);
	}
	if (r.condition === 'change') {
		const x = price(p.securityId);
		const then = m.price(p.securityId, addDays(today, -p.days));
		return x !== null && !!then && Math.abs((x / then - 1) * 100) >= p.pct;
	}
	if (r.condition === 'drawdown') {
		const pos = app.prepare('select security_id as s from positions where id = ?').get(p.positionId) as { s: number } | undefined;
		if (!pos) return false;
		const avg = app
			.prepare(
				`select sum(qty * price) / sum(qty) as a from position_events e where position_id = ? and kind in ('buy', 'opening') and cancelled_at is null
				   and not exists (select 1 from position_events r where r.reverses_event_id = e.id and r.cancelled_at is null)`
			)
			.get(p.positionId) as { a: number | null };
		const x = price(pos.s);
		return x !== null && !!avg.a && (1 - x / avg.a) * 100 >= p.pct;
	}
	if (r.condition === 'report') {
		const next = market.prepare(`select min(date) as d from ref_security_events where security_id = ? and kind = 'earnings' and date >= ?`).get(p.securityId, today) as { d: string | null };
		return !!next.d && addDays(today, p.days) >= next.d;
	}
	if (r.condition === 'quarter_start') return quarterStart(today) > r.createdAt.slice(0, 10);
	if (r.condition === 'horizon') {
		const h = app.prepare('select horizon_date as d from hypotheses where id = ?').get(p.hypothesisId) as { d: string } | undefined;
		return !!h && today >= h.d;
	}
	return false;
}

/**
 * The check: a waiting reminder whose condition holds fires; a snoozed one whose day came fires again. Returns the
 * reminders that fired now (the push sends them, if the owner turned that on).
 */
export function checkReminders(app: Database.Database, market: Database.Database, today = israelDate()) {
	const m = marketView(market);
	const fired: Row[] = [];
	const rows = app.prepare(`${SELECT} where state in ('waiting', 'snoozed')`).all() as Row[];
	for (const r of rows) {
		const due = r.state === 'snoozed' ? !!r.nextDue && today >= r.nextDue : holds(app, market, m, r, today);
		if (!due) continue;
		app.prepare(`update reminders set state = 'fired', fired_at = ? where id = ?`).run(new Date().toISOString(), r.id);
		event(app, r.id, 'fired', r.state === 'snoozed' ? 'после отсрочки' : null);
		fired.push(r);
	}
	return fired;
}

/** Д-30: snooze for a day, a week, a month or to a date; the count grows */
export function snooze(app: Database.Database, id: number, how: unknown, today = israelDate()) {
	const r = app.prepare(`${SELECT} where id = ?`).get(id) as Row | undefined;
	if (!r) throw new InputError({ id: 'Нет такого напоминания' } as Errors);
	const until = how === 'day' ? addDays(today, 1) : how === 'week' ? addDays(today, 7) : how === 'month' ? addMonths(today, 1) : isDate(how) && how > today ? how : null;
	if (!until) throw new InputError({ until: 'На день, неделю, месяц или дату позже сегодняшней' } as Errors);
	app.transaction(() => {
		app.prepare(`update reminders set state = 'snoozed', next_due = ?, snoozes = snoozes + 1 where id = ?`).run(until, id);
		event(app, id, 'snoozed', until);
	})();
	return until;
}

/** Д-30: close with a conclusion — an entry «вывод» in the chain of the reminder's entry */
export function closeReminder(app: Database.Database, market: Database.Database, id: number, conclusion: unknown) {
	const r = app.prepare(`${SELECT} where id = ?`).get(id) as Row | undefined;
	if (!r) throw new InputError({ id: 'Нет такого напоминания' } as Errors);
	const html = typeof conclusion === 'string' ? sanitize(conclusion) : '';
	return app.transaction(() => {
		let entryId: number | null = null;
		if (plainText(html)) {
			const links = app.prepare('select object_type as type, object_id as id from entry_links where entry_id = ? and object_type <> ?').all(r.entryId, 'event') as { type: string; id: string }[];
			entryId = addEntry(app, market, { kind: 'conclusion', body: html, format: 'html', parentId: r.entryId, links });
		}
		app.prepare(`update reminders set state = 'closed', closed_at = ? where id = ?`).run(new Date().toISOString(), id);
		event(app, id, 'closed', entryId ? `вывод #${entryId}` : null);
		return entryId;
	})();
}

export function remindersOf(app: Database.Database, entryIds: number[]) {
	if (!entryIds.length) return new Map<number, ReturnType<typeof view>[]>();
	const rows = app.prepare(`${SELECT} where entry_id in (${entryIds.map(() => '?').join(',')}) order by id`).all(...entryIds) as Row[];
	const out = new Map<number, ReturnType<typeof view>[]>();
	for (const r of rows) out.set(r.entryId, [...(out.get(r.entryId) ?? []), view(r)]);
	return out;
}

const view = (r: Row) => ({ id: r.id, title: r.title, condition: r.condition, what: describe(r.condition, JSON.parse(r.params)), state: r.state, nextDue: r.nextDue, snoozes: r.snoozes, firedAt: r.firedAt });

export function historyOfReminder(app: Database.Database, id: number) {
	return app.prepare('select kind, at, note from reminder_events where reminder_id = ? order by id').all(id) as { kind: string; at: string; note: string | null }[];
}

// ── «Сигналы» (Д-29): the fired reminders and the trade discipline's signals, snoozed alike ─────────────────────

const signalKey = (s: Signal) => `${s.kind}|${s.positionId}|${s.planId}`;

export function snoozeSignal(app: Database.Database, key: unknown, how: unknown, today = israelDate()) {
	const k = String(key ?? '');
	if (!/^(stop|target|review|model_end)\|\d+\|\d+$/.test(k)) throw new InputError({ key: 'Нет такого сигнала' } as Errors);
	const until = how === 'day' ? addDays(today, 1) : how === 'week' ? addDays(today, 7) : how === 'month' ? addMonths(today, 1) : isDate(how) && how > today ? how : null;
	if (!until) throw new InputError({ until: 'На день, неделю, месяц или дату позже сегодняшней' } as Errors);
	app.prepare(`insert into signal_snoozes (key, until, count) values (?, ?, 1) on conflict(key) do update set until = excluded.until, count = count + 1`).run(k, until);
	return until;
}

/** the trade discipline's signals not snoozed today, each with its snooze count */
export function liveSignals(app: Database.Database, market: Database.Database, today = israelDate()) {
	const sn = new Map((app.prepare('select key, until, count from signal_snoozes').all() as { key: string; until: string; count: number }[]).map((x) => [x.key, x]));
	return signals(app, market, today)
		.map((s) => ({ ...s, key: signalKey(s), snoozes: sn.get(signalKey(s))?.count ?? 0, snoozedUntil: sn.get(signalKey(s))?.until ?? null }))
		.filter((s) => !s.snoozedUntil || today >= s.snoozedUntil);
}

/** the block «Сигналы» on the main screen */
export function signalsBlock(app: Database.Database, market: Database.Database, today = israelDate()) {
	checkReminders(app, market, today);
	const fired = app.prepare(`${SELECT} where state = 'fired' order by fired_at`).all() as Row[];
	const entry = app.prepare('select id, kind, body_text as t, created_at as at from journal_entries where id = ?');
	const link = app.prepare(`select object_type as type, object_id as id from entry_links where entry_id = ? and object_type in ('security', 'position', 'hypothesis') order by is_primary desc limit 1`);
	return {
		reminders: fired.map((r) => {
			const e = entry.get(r.entryId) as { id: number; kind: string; t: string; at: string };
			return { ...view(r), entry: { id: e.id, kind: e.kind, at: e.at, text: e.t.length > 200 ? e.t.slice(0, 197) + '…' : e.t }, link: link.get(r.entryId) ?? null };
		}),
		trade: liveSignals(app, market, today)
	};
}
