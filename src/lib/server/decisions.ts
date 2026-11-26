import type Database from 'better-sqlite3';
import type { Errors } from '../hypothesis.js';
import { InputError } from './journal.js';
import { addEntry, syncJournal, type Link } from './diary.js';
import { signals } from './discipline.js';
import { sanitize, plainText } from './richtext.js';
import { addReminder } from './reminders.js';

/**
 * T-032 11б «Решения» (spec 23, Д-14 — Д-20). A decision is a thing of its own with its thesis entry in the diary. It is
 * built over the trade conditions of T-015, not beside them: a purchase's thesis and kind become the decision's thesis
 * entry and basis; «Пересмотрел» at a signal is a decision «держать» with its observation in the chain; the review at a
 * sale is the conclusion entry, with «Сбылось?» added to the purchase's decision.
 */

export const TYPES = ['buy', 'add', 'sell', 'trim', 'hold', 'skip', 'defer'] as const;
export type DecisionType = (typeof TYPES)[number];
export const BASES = ['intuition', 'hypothesis', 'model', 'consensus', 'mixed'] as const;
export type Basis = (typeof BASES)[number];
export const OUTCOMES = ['yes', 'partly', 'no', 'early'] as const;

export const TYPE_RU: Record<DecisionType, string> = { buy: 'купить', add: 'докупить', sell: 'продать', trim: 'сократить', hold: 'держать', skip: 'не покупать', defer: 'отложить' };
const BASIS_RU: Record<Basis, string> = { intuition: 'интуиция', hypothesis: 'гипотеза', model: 'модель', consensus: 'консенсус', mixed: 'смешанное' };
const OUTCOME_RU: Record<string, string> = { yes: 'да', partly: 'частично', no: 'нет', early: 'рано судить' };
const EXIT_RU: Record<string, string> = { stop: 'стоп', target: 'цель', model: 'по модели', thesis_broken: 'тезис сломан', changed_mind: 'передумал' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** the basis a trade's kind gives: a model's trade — «модель», a hypothesis's — «гипотеза», an own idea or speculation — «интуиция» */
export const basisOfKind = (kind: string | null | undefined): Basis => (kind === 'model' ? 'model' : kind === 'hypothesis' ? 'hypothesis' : 'intuition');

const isBasis = (v: unknown): v is Basis => (BASES as readonly string[]).includes(String(v));

interface DecisionRow {
	id: number;
	createdAt: string;
	type: DecisionType;
	securityId: number;
	portfolioId: number | null;
	positionId: number | null;
	eventId: number | null;
	basis: Basis;
	basisRef: string | null;
	thesisEntryId: number;
	expectation: string | null;
	reviewDate: string | null;
	outcome: string | null;
	outcomeAt: string | null;
	conclusionEntryId: number | null;
	noReason: number;
	planId: number | null;
	cancelledAt: string | null;
}
const SELECT = `select id, created_at as createdAt, type, security_id as securityId, portfolio_id as portfolioId, position_id as positionId,
	event_id as eventId, basis, basis_ref as basisRef, thesis_entry_id as thesisEntryId, expectation, review_date as reviewDate, outcome,
	outcome_at as outcomeAt, conclusion_entry_id as conclusionEntryId, no_reason as noReason, plan_id as planId, cancelled_at as cancelledAt from decisions`;

function insert(app: Database.Database, d: Omit<DecisionRow, 'id' | 'createdAt' | 'outcome' | 'outcomeAt' | 'conclusionEntryId' | 'cancelledAt'> & { at?: string; origin?: string | null }) {
	return (
		app
			.prepare(
				`insert into decisions (created_at, type, security_id, portfolio_id, position_id, event_id, basis, basis_ref, thesis_entry_id, expectation, review_date, no_reason, plan_id, origin)
				 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`
			)
			.get(d.at ?? new Date().toISOString(), d.type, d.securityId, d.portfolioId, d.positionId, d.eventId, d.basis, d.basisRef, d.thesisEntryId, d.expectation, d.reviewDate, d.noReason, d.planId, d.origin ?? null) as { id: number }
	).id;
}

/** a decision's entry gets the kind «решение» and the system tag of its type */
function markEntry(app: Database.Database, entryId: number, type: DecisionType) {
	app.prepare(`update journal_entries set kind = 'decision' where id = ?`).run(entryId);
	const name = TYPE_RU[type];
	let t = app.prepare(`select id from tags where name = ? and grp = 'decisions'`).get(name) as { id: number } | undefined;
	t ??= app.prepare(`insert into tags (name, grp, system, color) values (?, 'decisions', 1, '#1d4ed8') returning id`).get(name) as { id: number };
	app.prepare('insert or ignore into entry_tags (entry_id, tag_id) values (?, ?)').run(entryId, t.id);
}

const posRow = (app: Database.Database, positionId: number) =>
	app.prepare('select id, portfolio_id as portfolioId, security_id as securityId, price_unit as unit from positions where id = ?').get(positionId) as
		| { id: number; portfolioId: number; securityId: number; unit: string }
		| undefined;

/** a model's run of a trade: its variant and the quarter of the date — «A|2027-Q1» */
function modelRun(app: Database.Database, modelVersionId: number | null, date: string) {
	if (!modelVersionId) return null;
	const v = app.prepare('select variant from model_versions where id = ?').get(modelVersionId) as { variant: string } | undefined;
	const [y, m] = date.split('-').map(Number);
	return v ? `${v.variant}|${y}-Q${Math.ceil(m / 3)}` : null;
}

function eventRow(app: Database.Database, id: number) {
	return app
		.prepare(`select id, position_id as positionId, kind, date, qty, price, hypothesis_id as hypothesisId, model_version_id as modelVersionId, created_at as createdAt from position_events where id = ?`)
		.get(id) as { id: number; positionId: number; kind: string; date: string; qty: number | null; price: number | null; hypothesisId: number | null; modelVersionId: number | null; createdAt: string } | undefined;
}

/** what was held before an event — a purchase on top of a holding is «докупить», a sale of a part is «сократить» */
function heldBefore(app: Database.Database, positionId: number, eventId: number) {
	const r = app
		.prepare(
			`select coalesce(sum(case when kind in ('buy', 'opening') then qty when kind = 'sell' then -qty else 0 end), 0) as q from position_events e
			  where position_id = ? and id < ? and cancelled_at is null and not exists (select 1 from position_events r where r.reverses_event_id = e.id and r.cancelled_at is null)`
		)
		.get(positionId, eventId) as { q: number };
	return r.q;
}

export interface DecisionInput {
	basis?: unknown;
	/** the sale's «Почему» (rich text) */
	why?: unknown;
	/** «Сбылось?» */
	outcome?: unknown;
	/** the conclusion's words (rich text) */
	conclusion?: unknown;
}

/**
 * A purchase from the form (Д-17): its decision «купить» or «докупить». The thesis and «что докажет, что я неправ» of
 * the trade conditions are the thesis entry; the basis is chosen in the form, by default from the trade's kind.
 */
export function decideBuy(app: Database.Database, market: Database.Database, eventId: number, input: DecisionInput = {}) {
	const e = eventRow(app, eventId);
	if (!e || e.kind !== 'buy') return null;
	const pos = posRow(app, e.positionId)!;
	const plan = app.prepare('select id, kind, thesis, wrong_if as wrongIf, stop, target, review_date as reviewDate from trade_plans where event_id = ? order by id desc limit 1').get(eventId) as
		| { id: number; kind: string; thesis: string | null; wrongIf: string | null; stop: number | null; target: number | null; reviewDate: string | null }
		| undefined;
	const type: DecisionType = heldBefore(app, e.positionId, eventId) > 1e-9 ? 'add' : 'buy';
	const basis = isBasis(input.basis) ? input.basis : basisOfKind(plan?.kind);
	const basisRef = basis === 'hypothesis' && e.hypothesisId ? String(e.hypothesisId) : basis === 'model' ? modelRun(app, e.modelVersionId, e.date) : null;
	const thesis = plan?.thesis?.trim() ?? '';
	const body = thesis
		? `<p>${esc(thesis)}</p>${plan?.wrongIf ? `<p><i>Неправ, если:</i> ${esc(plan.wrongIf)}</p>` : ''}`
		: `<p>${TYPE_RU[type][0].toUpperCase() + TYPE_RU[type].slice(1)} ${fmt(e.qty ?? 0)} шт. по ${fmt(e.price ?? 0)} — без обоснования</p>`;
	const links: Link[] = [
		{ type: 'position', id: String(pos.id), primary: true },
		{ type: 'event', id: String(eventId) },
		...(e.hypothesisId ? [{ type: 'hypothesis' as const, id: String(e.hypothesisId) }] : []),
		...(basis === 'model' && basisRef ? [{ type: 'model_run' as const, id: basisRef }] : [])
	];
	return app.transaction(() => {
		const entryId = addEntry(app, market, { kind: 'decision', body, format: 'html', links }, { origin: plan ? `plan:${plan.id}` : `buy:${eventId}` });
		if (!entryId) return null;
		markEntry(app, entryId, type);
		const exp = [plan?.target ? `цель ${fmt(plan.target)}` : '', plan?.stop ? `стоп ${fmt(plan.stop)}` : ''].filter(Boolean).join(' · ') || null;
		return insert(app, { type, securityId: pos.securityId, portfolioId: pos.portfolioId, positionId: pos.id, eventId, basis, basisRef, thesisEntryId: entryId, expectation: exp, reviewDate: plan?.reviewDate ?? null, noReason: thesis ? 0 : 1, planId: plan?.id ?? null, origin: `event:${eventId}` });
	})();
}

/** the purchase a sale answers: the newest «купить» / «докупить» of the position without «Сбылось?» */
export function openBuy(app: Database.Database, positionId: number) {
	return (app.prepare(`${SELECT} where position_id = ? and type in ('buy', 'add') and outcome is null and cancelled_at is null order by id desc limit 1`).get(positionId) as DecisionRow | undefined) ?? null;
}

/**
 * A sale from the form: its decision «продать» (all) or «сократить» (a part) with «Почему» (empty is allowed — then
 * «без обоснования»); and Д-18: «Сбылось?» and the conclusion — an entry of the kind «вывод» in the chain of the purchase's
 * thesis, with the exit's reason and the rule from the review of T-015.
 */
export function decideSell(app: Database.Database, market: Database.Database, eventId: number, input: DecisionInput = {}) {
	const e = eventRow(app, eventId);
	if (!e || e.kind !== 'sell') return null;
	const pos = posRow(app, e.positionId)!;
	const left = heldBefore(app, e.positionId, eventId) - (e.qty ?? 0);
	const type: DecisionType = left > 1e-9 ? 'trim' : 'sell';
	const buy = openBuy(app, pos.id);
	const basis = isBasis(input.basis) ? input.basis : (buy?.basis ?? 'intuition');
	const whyHtml = typeof input.why === 'string' ? sanitize(input.why) : '';
	const why = plainText(whyHtml) ? whyHtml : '';
	const review = app.prepare('select reason, followed from trade_reviews where event_id = ?').get(eventId) as { reason: string; followed: number } | undefined;
	const outcome = (OUTCOMES as readonly string[]).includes(String(input.outcome)) ? String(input.outcome) : null;
	const links: Link[] = [{ type: 'position', id: String(pos.id), primary: true }, { type: 'event', id: String(eventId) }];
	return app.transaction(() => {
		const body = why || `<p>${type === 'sell' ? 'Продал' : 'Сократил'} ${fmt(e.qty ?? 0)} шт. по ${fmt(e.price ?? 0)} — без обоснования</p>`;
		const entryId = addEntry(app, market, { kind: 'decision', body, format: 'html', links, parentId: buy?.thesisEntryId ?? null }, { origin: `sell:${eventId}` })!;
		markEntry(app, entryId, type);
		const id = insert(app, { type, securityId: pos.securityId, portfolioId: pos.portfolioId, positionId: pos.id, eventId, basis, basisRef: buy?.basisRef ?? null, thesisEntryId: entryId, expectation: null, reviewDate: null, noReason: why ? 0 : 1, planId: null, origin: `event:${eventId}` });
		if (buy && (outcome || review)) {
			const words = typeof input.conclusion === 'string' ? sanitize(input.conclusion) : '';
			const facts = [outcome ? `Сбылось: <b>${OUTCOME_RU[outcome]}</b>` : '', review ? `выход: ${EXIT_RU[review.reason] ?? review.reason}` : '', review ? (review.followed ? 'правило соблюдено' : 'правило нарушено') : ''].filter(Boolean).join(' · ');
			const cBody = `<p>${facts}</p>${plainText(words) ? words : ''}`;
			const cId = addEntry(app, market, { kind: 'conclusion', body: cBody, format: 'html', links, parentId: buy.thesisEntryId }, { origin: `conclusion:${eventId}` })!;
			if (outcome || type === 'sell') app.prepare('update decisions set outcome = ?, outcome_at = ?, conclusion_entry_id = ? where id = ?').run(outcome, new Date().toISOString(), cId, buy.id);
		}
		return id;
	})();
}

/**
 * «Пересмотрел» while a signal stood (the stop, the target, the review date, the model's quarter): a decision «держать»
 * — the observation entry «Пересмотрел: …» becomes its thesis; it stays in the chain of the purchase's thesis.
 */
export function decideHold(app: Database.Database, market: Database.Database, positionId: number, noteEventId: number) {
	syncJournal(app, market);
	const entry = app.prepare('select id from journal_entries where origin = ?').get(`event:${noteEventId}`) as { id: number } | undefined;
	const pos = posRow(app, positionId);
	if (!entry || !pos) return null;
	const buy = openBuy(app, positionId);
	return app.transaction(() => {
		markEntry(app, entry.id, 'hold');
		if (buy) app.prepare('update journal_entries set parent_entry_id = ? where id = ? and parent_entry_id is null').run(buy.thesisEntryId, entry.id);
		const plan = app.prepare('select id, review_date as reviewDate from trade_plans where position_id = ? order by id desc limit 1').get(positionId) as { id: number; reviewDate: string | null } | undefined;
		return insert(app, { type: 'hold', securityId: pos.securityId, portfolioId: pos.portfolioId, positionId, eventId: noteEventId, basis: buy?.basis ?? 'intuition', basisRef: buy?.basisRef ?? null, thesisEntryId: entry.id, expectation: null, reviewDate: plan?.reviewDate ?? null, noReason: 0, planId: plan?.id ?? null, origin: `hold:${noteEventId}` });
	})();
}

/** whether a position stands under a signal now — then «Пересмотрел» is a «держать» */
export const underSignal = (app: Database.Database, market: Database.Database, positionId: number) => signals(app, market).some((s) => s.positionId === positionId);

/**
 * «Не покупаю» and «Отложить» from a security's card (Д-15): the reason is required, the basis too; «отложить» has the
 * date to come back (the reminder itself comes with 11г), «не покупать» — the horizon to judge the refusal by (Д-42).
 */
export function decideOther(app: Database.Database, market: Database.Database, input: { type?: unknown; securityId?: unknown; portfolioId?: unknown; basis?: unknown; basisRef?: unknown; why?: unknown; reviewDate?: unknown }) {
	const errors: Record<string, string> = {};
	const type = input.type === 'skip' || input.type === 'defer' ? (input.type as DecisionType) : null;
	if (!type) errors.type = 'Не покупать или отложить';
	const securityId = Number(input.securityId);
	if (!market.prepare('select 1 from ref_securities where id = ?').get(securityId)) errors.securityId = 'Нет такой бумаги';
	if (!isBasis(input.basis)) errors.basis = 'Основание — одно обязательно';
	const why = typeof input.why === 'string' ? sanitize(input.why) : '';
	if (!plainText(why)) errors.why = 'Почему — одной фразой';
	const reviewDate = typeof input.reviewDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.reviewDate) ? input.reviewDate : null;
	if (type === 'defer' && !reviewDate) errors.reviewDate = 'Когда вернуться';
	if (Object.keys(errors).length) throw new InputError(errors as Errors);
	const portfolioId = input.portfolioId ? Number(input.portfolioId) : null;
	const basisRef = input.basisRef ? String(input.basisRef).slice(0, 60) : null;
	const links: Link[] = [{ type: 'security', id: String(securityId), primary: true }, ...(portfolioId ? [{ type: 'portfolio' as const, id: String(portfolioId) }] : []), ...(input.basis === 'hypothesis' && basisRef ? [{ type: 'hypothesis' as const, id: basisRef }] : [])];
	return app.transaction(() => {
		const entryId = addEntry(app, market, { kind: 'decision', body: why, format: 'html', links })!;
		markEntry(app, entryId, type!);
		// «отложить» creates its reminder (Д-15, 11г); «не покупать» — one to check the refusal on its date
		if (reviewDate) addReminder(app, { entryId, condition: 'date', date: reviewDate, title: `${type === 'defer' ? 'Вернуться к' : 'Проверить отказ от'} ${(market.prepare('select symbol from ref_securities where id = ?').get(securityId) as { symbol: string }).symbol}` });
		return insert(app, { type: type!, securityId, portfolioId, positionId: null, eventId: null, basis: input.basis as Basis, basisRef, thesisEntryId: entryId, expectation: null, reviewDate, noReason: 0, planId: null });
	})();
}

/** Д-19: within 24 hours a decision can be cancelled (an input mistake); later it stays — the history is kept */
export function cancelDecision(app: Database.Database, id: number, now = new Date()) {
	const d = app.prepare(`${SELECT} where id = ?`).get(id) as DecisionRow | undefined;
	if (!d) throw new InputError({ id: 'Нет такого решения' } as Errors);
	if (d.cancelledAt) return d;
	if (now.getTime() - Date.parse(d.createdAt) > 24 * 3600_000) throw new InputError({ id: 'Отменить можно в первые 24 часа; потом решение остаётся в истории' } as Errors);
	app.prepare('update decisions set cancelled_at = ? where id = ?').run(now.toISOString(), id);
	return { ...d, cancelledAt: now.toISOString() };
}

/** the decision behind each thesis entry — for the feeds */
export function decisionsByEntry(app: Database.Database, entryIds: number[]) {
	if (!entryIds.length) return new Map<number, DecisionRow & { canCancel: boolean }>();
	const rows = app.prepare(`${SELECT} where thesis_entry_id in (${entryIds.map(() => '?').join(',')})`).all(...entryIds) as DecisionRow[];
	return new Map(rows.map((d) => [d.thesisEntryId, { ...d, canCancel: !d.cancelledAt && Date.now() - Date.parse(d.createdAt) < 24 * 3600_000 }]));
}

export function positionDecisions(app: Database.Database, positionId: number) {
	return app.prepare(`${SELECT} where position_id = ? order by id`).all(positionId) as DecisionRow[];
}

/** the purchase's thesis for the sale form (Д-18) */
export function buyForSale(app: Database.Database, positionId: number) {
	const b = openBuy(app, positionId);
	if (!b) return null;
	const e = app.prepare('select body, format, created_at as createdAt from journal_entries where id = ?').get(b.thesisEntryId) as { body: string; format: string; createdAt: string };
	return { id: b.id, type: b.type, basis: b.basis, expectation: b.expectation, createdAt: b.createdAt, html: e.format === 'html' ? sanitize(e.body) : esc(e.body).replace(/\n/g, '<br>') };
}

/**
 * The move-in for what was there before 11б: every thesis of a purchase's conditions (already an entry «plan:N») gets
 * its decision «купить» / «докупить»; a «Пересмотрел» note goes into the chain of the purchase's thesis.
 */
export function syncDecisions(app: Database.Database, market: Database.Database) {
	syncJournal(app, market);
	let n = 0;
	const plans = app
		.prepare(
			`select t.id, t.event_id as eventId, t.kind, e.id as entryId from trade_plans t join position_events ev on ev.id = t.event_id and ev.kind = 'buy' and ev.cancelled_at is null
			   join journal_entries e on e.origin = 'plan:' || t.id
			  where not exists (select 1 from decisions d where d.plan_id = t.id or d.event_id = t.event_id)`
		)
		.all() as { id: number; eventId: number; kind: string; entryId: number }[];
	for (const p of plans) {
		const e = eventRow(app, p.eventId)!;
		const pos = posRow(app, e.positionId)!;
		const type: DecisionType = heldBefore(app, e.positionId, e.id) > 1e-9 ? 'add' : 'buy';
		const basis = basisOfKind(p.kind);
		const plan = app.prepare('select stop, target, review_date as reviewDate, created_at as createdAt from trade_plans where id = ?').get(p.id) as { stop: number | null; target: number | null; reviewDate: string | null; createdAt: string };
		app.transaction(() => {
			markEntry(app, p.entryId, type);
			const exp = [plan.target ? `цель ${fmt(plan.target)}` : '', plan.stop ? `стоп ${fmt(plan.stop)}` : ''].filter(Boolean).join(' · ') || null;
			insert(app, { type, securityId: pos.securityId, portfolioId: pos.portfolioId, positionId: pos.id, eventId: e.id, basis, basisRef: basis === 'hypothesis' && e.hypothesisId ? String(e.hypothesisId) : basis === 'model' ? modelRun(app, e.modelVersionId, e.date) : null, thesisEntryId: p.entryId, expectation: exp, reviewDate: plan.reviewDate, noReason: 0, planId: p.id, at: plan.createdAt, origin: `event:${e.id}` });
		})();
		n++;
	}
	// «Пересмотрел» notes into the chain of the position's purchase thesis
	const reviews = app
		.prepare(
			`select j.id, ev.position_id as positionId from journal_entries j join position_events ev on j.origin = 'event:' || ev.id
			  where ev.kind = 'note' and j.kind in ('observation', 'decision') and j.parent_entry_id is null`
		)
		.all() as { id: number; positionId: number }[];
	for (const r of reviews) {
		const b = app.prepare(`select thesis_entry_id as t from decisions where position_id = ? and type in ('buy', 'add') and cancelled_at is null and thesis_entry_id <> ? order by id desc limit 1`).get(r.positionId, r.id) as { t: number } | undefined;
		if (b) app.prepare('update journal_entries set parent_entry_id = ? where id = ?').run(b.t, r.id);
	}
	return n;
}

// ── Д-20 «История» ───────────────────────────────────────────────────────────────────────────────────────

export interface HistoryItem {
	date: string;
	at: string;
	kind: 'hypothesis' | 'hypothesis_closed' | 'entry' | 'decision';
	label: string;
	text: string | null;
	entryId: number | null;
	hypothesisId: number | null;
	decisionType: DecisionType | null;
	outcome: string | null;
	basis?: Basis | null;
	entryKind?: string | null;
}

/**
 * One timeline (Д-20) for a security or a hypothesis: the hypothesis → observations → the decision to buy → observations →
 * the decision to sell → the conclusion; decisions cancelled are left out. For a hypothesis — its own entries and the
 * decisions on its security from its date on.
 */
export function historyOf(app: Database.Database, q: { securityId?: number; hypothesisId?: number }) {
	const items: HistoryItem[] = [];
	let securityId = q.securityId ?? null;
	let from = '0000';
	const hyps = q.hypothesisId
		? (app.prepare('select id, security_id as s, entry_date as d, created_at as at, thesis, status, exit_date as x, outcome from hypotheses where id = ?').all(q.hypothesisId) as H[])
		: (app.prepare(`select id, security_id as s, entry_date as d, created_at as at, thesis, status, exit_date as x, outcome from hypotheses where security_id = ? and status <> 'cancelled'`).all(securityId) as H[]);
	type H = { id: number; s: number; d: string; at: string; thesis: string; status: string; x: string | null; outcome: string | null };
	if (q.hypothesisId) {
		if (!hyps.length) return { securityId: null, items };
		securityId = hyps[0].s;
		from = hyps[0].d;
	}
	for (const h of hyps) {
		items.push({ date: h.d, at: h.at, kind: 'hypothesis', label: `Гипотеза №${h.id}`, text: h.thesis, entryId: null, hypothesisId: h.id, decisionType: null, outcome: null });
		if (h.x && h.status !== 'open') items.push({ date: h.x, at: h.x + 'T23:59', kind: 'hypothesis_closed', label: `Гипотеза №${h.id} закрыта${h.outcome ? ` — ${h.outcome === 'hit' ? 'сбылась' : 'не сбылась'}` : ''}`, text: null, entryId: null, hypothesisId: h.id, decisionType: null, outcome: h.outcome });
	}
	const entries = (
		q.hypothesisId
			? app.prepare(
					`select distinct e.id, e.created_at as at, e.kind, e.body_text as t from journal_entries e join entry_links l on l.entry_id = e.id
					  where e.status = 'active' and ((l.object_type = 'hypothesis' and l.object_id = ?) or (l.object_type = 'security' and l.object_id = ? and e.created_at >= ?))`
				).all(String(q.hypothesisId), String(securityId), from)
			: app.prepare(
					`select distinct e.id, e.created_at as at, e.kind, e.body_text as t from journal_entries e join entry_links l on l.entry_id = e.id
					  where e.status = 'active' and l.object_type = 'security' and l.object_id = ?`
				).all(String(securityId))
	) as { id: number; at: string; kind: string; t: string }[];
	const decs = decisionsByEntry(app, entries.map((e) => e.id));
	const KIND_RU: Record<string, string> = { note: 'Заметка', observation: 'Наблюдение', decision: 'Решение', conclusion: 'Вывод' };
	for (const e of entries) {
		const d = decs.get(e.id);
		if (d?.cancelledAt) continue;
		items.push({
			date: e.at.slice(0, 10),
			at: e.at,
			kind: d ? 'decision' : 'entry',
			label: d ? `Решение: ${TYPE_RU[d.type]} · ${BASIS_RU[d.basis]}${d.outcome ? ` · сбылось: ${OUTCOME_RU[d.outcome]}` : ''}` : (KIND_RU[e.kind] ?? e.kind),
			text: e.t.length > 280 ? e.t.slice(0, 277) + '…' : e.t,
			entryId: e.id,
			hypothesisId: null,
			decisionType: d?.type ?? null,
			outcome: d?.outcome ?? null,
			basis: d?.basis ?? null,
			entryKind: e.kind
		});
	}
	items.sort((a, b) => a.at.localeCompare(b.at));
	return { securityId, items };
}

