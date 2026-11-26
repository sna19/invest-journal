import type Database from 'better-sqlite3';
import { israelDate, type Errors } from '../hypothesis.js';
import { InputError } from './journal.js';
import { listPortfolios, marketView } from './portfolio.js';
import { portfolioReport } from './report.js';
import { activeOrder, orderLevel } from './protection.js';
import { flagSignals } from './path.js';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * T-015 «Дисциплина сделки». The review of 20.11.2026: three positions made most of a portfolio's
 * loss, none had an exit condition. Three rules followed: 1) no exit condition — no trade; 2) a model's trade is carried
 * out by the model in full, exit included; 3) speculation only from a play budget. Here: the conditions of a trade
 * (thesis, «что докажет, что я неправ», stop, target, review date), the signals when the prices or the calendar reach
 * them, the short review at a sale and the «Дисциплина» numbers.
 */

export const PLAN_KINDS = ['model', 'hypothesis', 'own', 'spec'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const EXIT_REASONS = ['stop', 'target', 'model', 'thesis_broken', 'changed_mind'] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

export interface Plan {
	id: number;
	positionId: number;
	eventId: number | null;
	kind: PlanKind;
	thesis: string | null;
	wrongIf: string | null;
	stop: number | null;
	target: number | null;
	reviewDate: string | null;
	noStopReason: string | null;
	reason: string | null;
	createdAt: string;
}

export interface PlanInput {
	kind?: unknown;
	thesis?: unknown;
	wrongIf?: unknown;
	stop?: unknown;
	target?: unknown;
	reviewDate?: unknown;
	/** saved without a stop: the reason (rule 1 asks for it) */
	noStopReason?: unknown;
	/** «Пересмотрел»: why */
	reason?: unknown;
}

const SELECT = `select id, position_id as positionId, event_id as eventId, kind, thesis, wrong_if as wrongIf, stop, target,
	review_date as reviewDate, no_stop_reason as noStopReason, reason, created_at as createdAt from trade_plans`;

/** the current conditions of a position — its newest row */
export function planOf(app: Database.Database, positionId: number): Plan | null {
	return (app.prepare(`${SELECT} where position_id = ? order by id desc limit 1`).get(positionId) as Plan | undefined) ?? null;
}

const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);
const num = (v: unknown) => {
	if (v === null || v === undefined || v === '') return null;
	const x = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace(/\s/g, ''));
	return Number.isFinite(x) ? x : NaN;
};
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** the last day of the quarter `date` is in — a model's period */
export function quarterEndOf(date: string) {
	const [y, m] = date.split('-').map(Number);
	const q = Math.ceil(m / 3);
	return new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
}

/** `date` plus `n` months; the 30th of November + 3 is the last day of February */
export function monthsOn(date: string, n: number) {
	const [y, m, d] = date.split('-').map(Number);
	const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
	return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

/** the default review date: a model's trade — the end of its quarter; otherwise three months on */
export function defaultReview(kind: PlanKind, date: string) {
	if (kind === 'model') return quarterEndOf(date);
	return monthsOn(date, 3);
}

/**
 * Checks the conditions of a trade and returns them clean, or throws the errors by field. `entry` — the purchase price
 * (a stop has to be below it, a target above); `strict` — the form of a purchase: the thesis is required and a stop or
 * «без стопа» with a reason (rule 1).
 */
export function checkPlan(input: PlanInput, opts: { entry: number | null; date: string; strict: boolean; fallbackKind: PlanKind }) {
	const errors: Record<string, string> = {};
	const kind = (PLAN_KINDS as readonly string[]).includes(String(input.kind)) ? (input.kind as PlanKind) : opts.fallbackKind;
	const thesis = text(input.thesis);
	const wrongIf = text(input.wrongIf);
	const stop = num(input.stop);
	const target = num(input.target);
	const noStopReason = text(input.noStopReason);
	if (opts.strict && !thesis) errors.thesis = 'Тезис: 1–2 фразы — почему эта сделка';
	if (stop !== null && !(stop > 0)) errors.stop = 'Стоп — цена больше нуля';
	else if (stop !== null && opts.entry && stop >= opts.entry) errors.stop = 'Стоп ниже цены входа';
	if (target !== null && !(target > 0)) errors.target = 'Цель — цена больше нуля';
	else if (target !== null && opts.entry && target <= opts.entry) errors.target = 'Цель выше цены входа';
	if (opts.strict && stop === null && !noStopReason) errors.stop = 'Стоп — или отметка «без стопа» с причиной (правило 1)';
	let reviewDate = input.reviewDate === undefined || input.reviewDate === '' || input.reviewDate === null ? null : input.reviewDate;
	if (reviewDate !== null && !isDate(reviewDate)) errors.reviewDate = 'Дата в виде ГГГГ-ММ-ДД';
	if (Object.keys(errors).length) throw new InputError(errors as Errors);
	reviewDate ??= defaultReview(kind, opts.date);
	return { kind, thesis, wrongIf, stop, target, reviewDate: reviewDate as string, noStopReason: stop === null ? noStopReason : null };
}

export type CleanPlan = ReturnType<typeof checkPlan>;

export function insertPlan(app: Database.Database, positionId: number, eventId: number | null, p: CleanPlan, reason: string | null = null) {
	return app
		.prepare(
			`insert into trade_plans (position_id, event_id, kind, thesis, wrong_if, stop, target, review_date, no_stop_reason, reason)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`
		)
		.get(positionId, eventId, p.kind, p.thesis, p.wrongIf, p.stop, p.target, p.reviewDate, p.noStopReason, reason) as { id: number };
}

const posOf = (app: Database.Database, id: number) =>
	app
		.prepare(
			`select s.id, s.portfolio_id as portfolioId, s.security_id as securityId, s.price_unit as priceUnit, s.stage, p.auto_source_id as autoSourceId
			   from positions s join portfolios p on p.id = s.portfolio_id where s.id = ?`
		)
		.get(id) as { id: number; portfolioId: number; securityId: number; priceUnit: string; stage: string; autoSourceId: number | null } | undefined;

/**
 * The conditions set or changed from the card. A position without conditions (a carried-over one) gets them filled;
 * a position with conditions — «Пересмотрел»: the reason is required and goes into the feed as a note.
 */
export function savePlan(app: Database.Database, positionId: number, input: PlanInput, now = new Date()) {
	const pos = posOf(app, positionId);
	if (!pos) throw new InputError({ positionId: 'Позиции нет' } as Errors);
	if (pos.autoSourceId) throw new InputError({ positionId: 'Позиции автоматического портфеля ведёт приложение' } as Errors);
	const today = israelDate(now);
	const prev = planOf(app, positionId);
	const reason = text(input.reason);
	if (prev && !reason) throw new InputError({ reason: 'Почему пересмотрел — одной фразой' } as Errors);
	// a review date already past moves on by default: «Пересмотрел» answers it
	const keepDate = prev?.reviewDate && prev.reviewDate > today ? prev.reviewDate : undefined;
	const clean = checkPlan(
		{ thesis: prev?.thesis, wrongIf: prev?.wrongIf, kind: prev?.kind, reviewDate: keepDate, ...input },
		{ entry: null, date: today, strict: false, fallbackKind: prev?.kind ?? 'own' }
	);
	let noteEventId: number | null = null;
	return app.transaction(() => {
		const row = insertPlan(app, positionId, null, clean, reason);
		if (prev) {
			const parts = [`Пересмотрел: ${reason}`];
			if (prev.stop !== clean.stop) parts.push(`стоп ${prev.stop ?? '—'} → ${clean.stop ?? '—'}`);
			if (prev.target !== clean.target) parts.push(`цель ${prev.target ?? '—'} → ${clean.target ?? '—'}`);
			if (prev.reviewDate !== clean.reviewDate) parts.push(`пересмотр ${clean.reviewDate.split('-').reverse().join('.')}`);
			const cur = app.prepare('select currency from positions where id = ?').get(positionId) as { currency: string };
			noteEventId = (app.prepare(`insert into position_events (position_id, kind, date, currency, note) values (?, 'note', ?, ?, ?) returning id`).get(positionId, today, cur.currency, parts.join(' · ')) as { id: number }).id;
		}
		return { id: row.id, plan: planOf(app, positionId), noteEventId, reviewed: !!prev, reason };
	})();
}

/** the review at a sale, checked; `strict` — a sale entered by hand asks for it */
export function checkReview(input: unknown, strict: boolean) {
	const r = (input ?? {}) as { reason?: unknown; followed?: unknown };
	const errors: Record<string, string> = {};
	const reason = (EXIT_REASONS as readonly string[]).includes(String(r.reason)) ? (r.reason as ExitReason) : null;
	const followed = r.followed === true || r.followed === 1 ? 1 : r.followed === false || r.followed === 0 ? 0 : null;
	if (strict && !reason) errors.exitReason = 'Причина выхода';
	if (strict && followed === null) errors.followed = 'Соблюдено ли правило';
	if (Object.keys(errors).length) throw new InputError(errors as Errors);
	return reason && followed !== null ? { reason, followed } : null;
}

export function insertReview(app: Database.Database, eventId: number, r: { reason: ExitReason; followed: number }) {
	app.prepare('insert or replace into trade_reviews (event_id, reason, followed) values (?, ?, ?)').run(eventId, r.reason, r.followed);
}

// ── signals ──────────────────────────────────────────────────────────────────────────────────────────────

export type SignalKind = 'stop' | 'target' | 'review' | 'model_end' | 'no_stop' | 'path';
export interface Signal {
	kind: SignalKind;
	positionId: number;
	/** the version of the conditions it comes from: a push goes once per version */
	planId: number;
	portfolioId: number;
	portfolio: string;
	securityId: number;
	symbol: string;
	priceUnit: string;
	price: number | null;
	priceDate: string | null;
	stop: number | null;
	target: number | null;
	reviewDate: string | null;
	/** T-021: the stop is an order placed at the broker («Я выставил») — it should have been filled */
	order?: boolean;
	/** T-033: the mark of the return's path («выдыхается», …) and its state (for «Пересмотрел») */
	flag?: string;
	stateId?: number;
}

/**
 * The signals of the held positions with conditions: the stop is broken or the target reached by the latest quote
 * (the live one in trading hours, otherwise the close), the review date has come, a model's position outlived its
 * quarter. Each stays until «Продал» or «Пересмотрел» changes the conditions.
 */
export function signals(app: Database.Database, market: Database.Database, today = israelDate()): Signal[] {
	const rows = app
		.prepare(
			`select s.id, s.portfolio_id as portfolioId, p.name as portfolio, s.security_id as securityId, s.symbol, s.price_unit as priceUnit
			   from positions s join portfolios p on p.id = s.portfolio_id
			  where s.stage in ('holding', 'plan_sell') and p.auto_source_id is null and p.archived_at is null
			  order by p.sort_order, p.id, s.symbol`
		)
		.all() as { id: number; portfolioId: number; portfolio: string; securityId: number; symbol: string; priceUnit: string }[];
	const m = marketView(market);
	const out: Signal[] = [];
	// the newest purchase (not one carried over, not reversed)
	const lastBuy = app.prepare(`select max(date) as d from position_events e where position_id = ? and kind = 'buy' and not exists (select 1 from position_events r where r.reverses_event_id = e.id)`);
	for (const r of rows) {
		const plan = planOf(app, r.id);
		// T-021: a stop placed at the broker — the trailing one followed by the closes — is the stop that counts
		const order = activeOrder(app, r.id);
		if (!plan && !order) {
			// a fresh purchase without a stop: a day later the app asks for one (T-021), for two weeks
			const d = (lastBuy.get(r.id) as { d: string | null }).d;
			if (d && d < today && daysBetween(d, today) <= 14)
				out.push({ kind: 'no_stop', positionId: r.id, planId: 0, portfolioId: r.portfolioId, portfolio: r.portfolio, securityId: r.securityId, symbol: r.symbol, priceUnit: r.priceUnit, price: null, priceDate: null, stop: null, target: null, reviewDate: null });
			continue;
		}
		const mv = m.dayMove(r.securityId);
		const last = m.last(r.securityId);
		const price = mv?.now ?? last?.close ?? null;
		const priceDate = mv?.date ?? last?.date ?? null;
		const stop = order ? orderLevel(market, order, r.securityId, mv?.live ? mv.now : null) : (plan?.stop ?? null);
		const base = { positionId: r.id, planId: plan?.id ?? 0, portfolioId: r.portfolioId, portfolio: r.portfolio, securityId: r.securityId, symbol: r.symbol, priceUnit: r.priceUnit, price, priceDate, stop, target: plan?.target ?? null, reviewDate: plan?.reviewDate ?? null, order: !!order };
		if (price !== null && stop !== null && price <= stop) out.push({ kind: 'stop', ...base, planId: order ? -order.id : base.planId });
		else if (price !== null && base.target !== null && price >= base.target) out.push({ kind: 'target', ...base });
		if (plan?.reviewDate && today >= plan.reviewDate) out.push({ kind: plan.kind === 'model' ? 'model_end' : 'review', ...base });
		if (!order && !plan?.stop && !plan?.noStopReason) {
			const d = (lastBuy.get(r.id) as { d: string | null }).d;
			if (d && d < today && daysBetween(d, today) <= 14) out.push({ kind: 'no_stop', ...base });
		}
	}
	// T-033: a new mark of the return's path on a held security — until «Пересмотрел»
	const marks = flagSignals(app, today);
	if (marks.length)
		for (const r of rows) {
			for (const f of marks.filter((x) => x.securityId === r.securityId))
				out.push({ kind: 'path', positionId: r.id, planId: f.id, portfolioId: r.portfolioId, portfolio: r.portfolio, securityId: r.securityId, symbol: r.symbol, priceUnit: r.priceUnit, price: null, priceDate: null, stop: null, target: null, reviewDate: null, flag: f.flag, stateId: f.id });
		}
	return out;
}

// ── «Дисциплина» ─────────────────────────────────────────────────────────────────────────────────────────

const r1 = (x: number) => Math.round(x * 10) / 10;
const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

interface Sale {
	sellId: number;
	date: string;
	symbol: string;
	returnPct: number;
	excess: number | null;
	kind: string;
	reason: ExitReason | null;
	followed: number | null;
}

/**
 * The block «Дисциплина» on «Статистика», over the portfolios kept by hand: the share of purchases with an exit
 * condition (a stop), the share of exits by the rule, the result of sales by the rules against the others, the result
 * by kind of trade, and the matrix «процесс × результат». A sale's result is its return in its own currency (the lots
 * it closed weighted by cost), against the market over the same days — so dollars and shekels can be put together.
 */
export function disciplineStats(app: Database.Database, market: Database.Database, today = israelDate()) {
	const ports = listPortfolios(app).filter((p) => !p.auto_source_id);
	const plans = new Map(
		(app.prepare(`${SELECT} where event_id is not null`).all() as Plan[]).map((p) => [p.eventId!, p])
	);
	const reviews = new Map(
		(app.prepare('select event_id as eventId, reason, followed from trade_reviews').all() as { eventId: number; reason: ExitReason; followed: number }[]).map((r) => [r.eventId, r])
	);

	// purchases by hand, each with or without a stop
	const buys = app
		.prepare(
			`select e.id, e.date from position_events e join positions s on s.id = e.position_id join portfolios p on p.id = s.portfolio_id
			  where e.kind = 'buy' and e.auto = 0 and e.cancelled_at is null and p.auto_source_id is null
			    and not exists (select 1 from position_events r where r.reverses_event_id = e.id and r.cancelled_at is null)`
		)
		.all() as { id: number; date: string }[];
	const withPlan = buys.filter((b) => plans.has(b.id));
	const withStop = withPlan.filter((b) => plans.get(b.id)!.stop !== null);

	// sales, one row per sell event
	const sales: Sale[] = [];
	for (const p of ports) {
		const rep = portfolioReport(app, market, p.id, today);
		if (!rep) continue;
		const bySell = new Map<number, typeof rep.trades>();
		for (const t of rep.trades) bySell.set(t.sellId, [...(bySell.get(t.sellId) ?? []), t]);
		for (const [sellId, ts] of bySell) {
			const w = ts.reduce((n, t) => n + t.qty, 0);
			const ret = ts.reduce((n, t) => n + t.returnPct * t.qty, 0) / w;
			const ex = ts.every((t) => t.excess !== null) ? ts.reduce((n, t) => n + t.excess! * t.qty, 0) / w : null;
			const plan = plans.get(ts[0].buyId);
			const rv = reviews.get(sellId);
			sales.push({ sellId, date: ts[0].sellDate, symbol: ts[0].symbol, returnPct: ret, excess: ex, kind: plan?.kind ?? ts[0].kind, reason: rv?.reason ?? null, followed: rv?.followed ?? null });
		}
	}
	const group = (xs: Sale[]) => ({ n: xs.length, avgPct: avg(xs.map((x) => x.returnPct)), avgExcess: avg(xs.filter((x) => x.excess !== null).map((x) => x.excess!)), wins: xs.filter((x) => x.returnPct > 0).length });
	const reviewed = sales.filter((x) => x.followed !== null);
	const kinds = ['model', 'hypothesis', 'own', 'spec', 'transfer'].map((k) => ({ kind: k, ...group(sales.filter((x) => x.kind === k)) })).filter((x) => x.n);
	return {
		buys: { n: buys.length, withPlan: withPlan.length, withStop: withStop.length },
		exits: { n: sales.length, reviewed: reviewed.length, followed: reviewed.filter((x) => x.followed === 1).length },
		byRule: { kept: group(reviewed.filter((x) => x.followed === 1)), broken: group(reviewed.filter((x) => x.followed === 0)) },
		kinds,
		matrix: {
			goodWin: reviewed.filter((x) => x.followed === 1 && x.returnPct > 0).length,
			goodLoss: reviewed.filter((x) => x.followed === 1 && x.returnPct <= 0).length,
			badWin: reviewed.filter((x) => x.followed === 0 && x.returnPct > 0).length,
			badLoss: reviewed.filter((x) => x.followed === 0 && x.returnPct <= 0).length
		},
		reasons: EXIT_REASONS.map((r) => ({ reason: r, n: reviewed.filter((x) => x.reason === r).length })).filter((x) => x.n)
	};
}

// ── «Мои правила» ────────────────────────────────────────────────────────────────────────────────────────

export function listRules(app: Database.Database) {
	return app.prepare('select id, text, sort_order as sortOrder from rules order by sort_order, id').all() as { id: number; text: string; sortOrder: number }[];
}

export function saveRule(app: Database.Database, input: { id?: unknown; text?: unknown; move?: unknown }) {
	const id = input.id ? Number(input.id) : null;
	if (id && (input.move === 'up' || input.move === 'down')) {
		const list = listRules(app);
		const i = list.findIndex((r) => r.id === id);
		const j = input.move === 'up' ? i - 1 : i + 1;
		if (i < 0 || j < 0 || j >= list.length) return listRules(app);
		[list[i], list[j]] = [list[j], list[i]];
		const set = app.prepare('update rules set sort_order = ? where id = ?');
		app.transaction(() => list.forEach((r, k) => set.run(k + 1, r.id)))();
		return listRules(app);
	}
	const t = text(input.text, 500);
	if (!t) throw new InputError({ text: 'Текст правила' } as Errors);
	if (id) app.prepare('update rules set text = ? where id = ?').run(t, id);
	else app.prepare('insert into rules (text, sort_order) values (?, (select coalesce(max(sort_order), 0) + 1 from rules))').run(t);
	return listRules(app);
}

export function deleteRule(app: Database.Database, id: number) {
	app.prepare('delete from rules where id = ?').run(id);
	return listRules(app);
}
