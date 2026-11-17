import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import {
	cashFlow,
	effective,
	fifo,
	holding,
	OversellError,
	splitFactor,
	stageOf,
	trades,
	twr,
	unitFactor,
	type Book,
	type CashEv,
	type Ev,
	type Market,
	type Split,
	type Stage
} from '../portfolio.js';
import { RATED_TYPES } from '../stats.js';
import { InputError, LockedError } from './journal.js';
import type { Errors } from '../hypothesis.js';
import { fxOn } from './market/boi.js';

/**
 * Spec section 18 — portfolios on the server: events in, positions and returns out. Plain SQL on both files:
 * the journal (app.db) and the market (market.db); the arithmetic is in $lib/portfolio.ts.
 */

/** A price that differs from the day's range by more than this needs a confirmation (a typo, agorot for shekels). */
export const PRICE_SLACK = 0.1;
const EPS = 1e-9;
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.')));

/** Field errors of the portfolio forms, answered as 400 like the journal's. */
const bad = (errors: Record<string, string>) => new InputError(errors as Errors);

/** A rule asks the person to look again: the answer is 409 with `confirm: true`; sent again with confirm, it goes. */
export class ConfirmError extends Error {}

// ── market access ─────────────────────────────────────────────────────────────────────────────────────

interface SecRow {
	id: number;
	symbol: string;
	name_en: string;
	exchange_code: string;
	currency: string;
	price_unit: string;
	active: number;
	country: string;
}

export function security(market: Database.Database, id: number) {
	return market
		.prepare(
			`select s.id, s.symbol, s.name_en, s.exchange_code, s.currency, s.price_unit, s.active, e.country
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code where s.id = ?`
		)
		.get(id) as SecRow | undefined;
}

/** Prices, rates and splits with small caches: one view of a portfolio asks for the same ones many times. */
export function marketView(market: Database.Database): Market & {
	splits(securityId: number): Split[];
	day(securityId: number, date: string): { date: string; low: number | null; high: number | null; close: number } | null;
	last(securityId: number): { date: string; close: number } | null;
	dividends(securityId: number, after: string, upTo: string): { date: string; amount: number }[];
} {
	const priceQ = market.prepare('select close from market_prices_daily where security_id = ? and date <= ? order by date desc limit 1');
	const dayQ = market.prepare('select date, low, high, close from market_prices_daily where security_id = ? and date <= ? order by date desc limit 1');
	const lastQ = market.prepare('select date, close from market_prices_daily where security_id = ? order by date desc limit 1');
	const splitQ = market.prepare(`select ex_date as date, ratio from market_corporate_actions where security_id = ? and kind = 'split' and ratio > 0`);
	const divQ = market.prepare(
		`select ex_date as date, amount from market_corporate_actions where security_id = ? and kind = 'dividend' and ex_date > ? and ex_date <= ? order by ex_date`
	);
	const cache = new Map<string, number | null>();
	const splitCache = new Map<number, Split[]>();
	return {
		price(id, date) {
			const k = `${id}|${date}`;
			if (!cache.has(k)) cache.set(k, (priceQ.get(id, date) as { close: number } | undefined)?.close ?? null);
			return cache.get(k)!;
		},
		fx(currency, date) {
			if (currency !== 'USD') return 1;
			const k = `fx|${date}`;
			if (!cache.has(k)) cache.set(k, fxOn(market, date));
			return cache.get(k) ?? fxOn(market, '9999-12-31') ?? 1;
		},
		splits(id) {
			if (!splitCache.has(id)) splitCache.set(id, splitQ.all(id) as Split[]);
			return splitCache.get(id)!;
		},
		day: (id, date) => (dayQ.get(id, date) as never) ?? null,
		last: (id) => (lastQ.get(id) as never) ?? null,
		dividends: (id, after, upTo) => divQ.all(id, after, upTo) as never
	};
}

export function benchmarkId(market: Database.Database, key: 'benchmark:SPX' | 'benchmark:TA125') {
	return (
		market.prepare(`select security_id as id from ref_provider_symbols where provider_code = 'seed' and provider_symbol = ?`).get(key) as
			| { id: number }
			| undefined
	)?.id;
}

// ── rows ──────────────────────────────────────────────────────────────────────────────────────────────

export interface PositionRow {
	id: number;
	portfolio_id: number;
	security_id: number;
	symbol: string;
	security_name: string;
	exchange_code: string;
	currency: string;
	price_unit: string;
	stage: Stage;
	opened_at: string;
	closed_at: string | null;
}

export interface EventRow extends Ev {
	positionId: number;
	currency: string;
	amount: number | null;
	note: string | null;
	hypothesisId: number | null;
	auto: number;
	createdAt: string;
}

const EVENT_COLS = `id, position_id as positionId, kind, date, qty, price, currency, fee, fx_rate as fxRate, amount, note,
	hypothesis_id as hypothesisId, reverses_event_id as reversesEventId, auto, cancelled_at as cancelledAt, created_at as createdAt`;
const CASH_COLS = `id, portfolio_id as portfolioId, kind, date, amount, currency, fx_rate as fxRate, note, position_id as positionId,
	reverses_event_id as reversesEventId, auto, cancelled_at as cancelledAt, created_at as createdAt`;

export interface CashRow extends CashEv {
	portfolioId: number;
	currency: string;
	note: string | null;
	positionId: number | null;
	auto: number;
	createdAt: string;
}

const eventsOf = (app: Database.Database, positionId: number) =>
	app.prepare(`select ${EVENT_COLS} from position_events where position_id = ? order by date, id`).all(positionId) as EventRow[];

const cashOf = (app: Database.Database, portfolioId: number) =>
	(app.prepare(`select ${CASH_COLS} from cash_events where portfolio_id = ? order by date, id`).all(portfolioId) as CashRow[]).map((c) => ({
		...c,
		qty: null,
		price: null,
		fee: null
	}));

const positionRow = (app: Database.Database, id: number) => app.prepare('select * from positions where id = ?').get(id) as PositionRow | undefined;

/** The live cash events of a portfolio, with storno taken into account. */
function liveCash(rows: CashRow[]) {
	return effective(rows);
}

// ── portfolios ────────────────────────────────────────────────────────────────────────────────────────

export interface PortfolioRow {
	id: number;
	name: string;
	kind: 'real' | 'virtual';
	auto_source_id: number | null;
	auto_amount_ils: number;
	sort_order: number;
	archived_at: string | null;
	sourceName?: string | null;
}

export function listPortfolios(app: Database.Database, all = false): PortfolioRow[] {
	return app
		.prepare(
			`select p.*, s.name as sourceName from portfolios p left join sources s on s.id = p.auto_source_id
			  ${all ? '' : 'where p.archived_at is null'} order by p.kind = 'virtual', p.auto_source_id is not null, p.sort_order, p.id`
		)
		.all() as PortfolioRow[];
}

export function createPortfolio(app: Database.Database, input: { name?: unknown; kind?: unknown }) {
	const name = String(input.name ?? '').trim();
	if (!name) throw bad({ name: 'Название портфеля' });
	if (name.length > 60) throw bad({ name: 'До 60 знаков' });
	const kind = input.kind === 'virtual' ? 'virtual' : 'real';
	if (app.prepare('select 1 from portfolios where name = ?').get(name)) throw bad({ name: 'Портфель с таким названием уже есть' });
	return app.prepare('insert into portfolios (name, kind) values (?, ?) returning *').get(name, kind) as PortfolioRow;
}

export function updatePortfolio(app: Database.Database, id: number, input: { name?: unknown; archived?: unknown; autoAmountIls?: unknown }) {
	const p = app.prepare('select * from portfolios where id = ?').get(id) as PortfolioRow | undefined;
	if (!p) throw bad({ id: 'Портфеля нет' });
	if (input.name !== undefined) {
		const name = String(input.name).trim();
		if (!name) throw bad({ name: 'Название портфеля' });
		if (app.prepare('select 1 from portfolios where name = ? and id <> ?').get(name, id)) throw bad({ name: 'Такое название уже есть' });
		app.prepare('update portfolios set name = ? where id = ?').run(name, id);
	}
	if (input.archived !== undefined)
		app.prepare('update portfolios set archived_at = ? where id = ?').run(input.archived ? new Date().toISOString() : null, id);
	if (input.autoAmountIls !== undefined) {
		const a = num(input.autoAmountIls);
		if (a === null || !(a > 0)) throw bad({ autoAmountIls: 'Сумма больше нуля' });
		app.prepare('update portfolios set auto_amount_ils = ? where id = ?').run(a, id);
	}
	return app.prepare('select * from portfolios where id = ?').get(id) as PortfolioRow;
}

/** The whole history of a portfolio as the arithmetic wants it. */
export function book(app: Database.Database, m: ReturnType<typeof marketView>, portfolioId: number) {
	const rows = app.prepare('select * from positions where portfolio_id = ? order by id').all(portfolioId) as PositionRow[];
	const evs = new Map(rows.map((p) => [p.id, eventsOf(app, p.id)]));
	const cash = cashOf(app, portfolioId);
	const b: Book = {
		positions: rows.map((p) => ({
			id: p.id,
			securityId: p.security_id,
			f: unitFactor(p.price_unit),
			currency: p.currency,
			trades: trades(evs.get(p.id)!, m.splits(p.security_id))
		})),
		cash: liveCash(cash).map((c) => ({ id: c.id, date: c.date, kind: c.kind, amount: c.amount, fx: c.fxRate ?? 1, at: c.createdAt }))
	};
	return { rows, evs, cash, book: b };
}

function bench(m: ReturnType<typeof marketView>, market: Database.Database, from: string | null, to: string) {
	const out: { key: string; label: string; returnPct: number | null; returnIlsPct?: number | null }[] = [];
	for (const [key, label] of [
		['benchmark:SPX', 'S&P 500'],
		['benchmark:TA125', 'ТА-125']
	] as const) {
		const id = benchmarkId(market, key);
		const a = id && from ? m.price(id, from) : null;
		const b = id ? m.price(id, to) : null;
		const r = a && b ? (b / a - 1) * 100 : null;
		const row: (typeof out)[number] = { key, label, returnPct: r };
		// the S&P 500 in shekels too: the portfolio's return is in shekels
		if (key === 'benchmark:SPX' && a && b && from) row.returnIlsPct = ((b * m.fx('USD', to)) / (a * m.fx('USD', from)) - 1) * 100;
		out.push(row);
	}
	return out;
}

/** Spec section 18 — the «Портфель» screen: value in shekels, return against the benchmarks, positions by stage. */
export function portfolioView(app: Database.Database, market: Database.Database, id: number, today = israelDate()) {
	const p = app.prepare('select p.*, s.name as sourceName from portfolios p left join sources s on s.id = p.auto_source_id where p.id = ?').get(id) as
		| PortfolioRow
		| undefined;
	if (!p) return null;
	const m = marketView(market);
	const { rows, evs, book: b } = book(app, m, id);
	const t = twr(b, m, today);
	// cash in shekels after every event (implied deposits included)
	const cash = cashFlow(b).cash;

	const fxNow = m.fx('USD', today);
	const positions = rows.map((r) => {
		const f = unitFactor(r.price_unit);
		const list = evs.get(r.id)!;
		const fi = fifo(trades(list, m.splits(r.security_id)), f);
		const last = m.last(r.security_id);
		const fx = r.currency === 'USD' ? fxNow : 1;
		const h = holding(fi, f, last?.close ?? null, fx);
		const live = effective(list);
		const plan = [...live].reverse().find((e) => e.kind === 'plan_buy' || e.kind === 'plan_sell' || e.kind === 'watch');
		const hyps = [...new Set(list.map((e) => e.hypothesisId).filter((x): x is number => !!x))];
		return {
			id: r.id,
			securityId: r.security_id,
			symbol: r.symbol,
			name: r.security_name,
			exchange: r.exchange_code,
			currency: r.currency,
			priceUnit: r.price_unit,
			stage: r.stage,
			openedAt: r.opened_at,
			closedAt: r.closed_at,
			qty: h.qty,
			avgPrice: h.avgPrice,
			lastPrice: last?.close ?? null,
			lastDate: last?.date ?? null,
			value: h.value,
			valueIls: h.valueIls,
			unrealized: h.unrealized,
			unrealizedPct: fi.cost > EPS ? (h.unrealized / fi.cost) * 100 : null,
			unrealizedIls: h.unrealizedIls,
			fromPrice: h.fromPrice,
			fromFx: h.fromFx,
			realized: fi.realized,
			realizedIls: fi.realizedIls,
			plan: plan ? { kind: plan.kind, date: plan.date, price: plan.price, amount: plan.amount, note: plan.note } : null,
			hypotheses: hyps,
			lastEventAt: live.at(-1)?.date ?? r.opened_at
		};
	});
	const held = positions.reduce((n, x) => n + x.valueIls, 0);
	const value = cash + held;
	for (const x of positions) Object.assign(x, { weight: value > EPS ? (x.valueIls / value) * 100 : 0 });

	// the last buy or sell fee in this portfolio, per currency — the form starts from it
	const lastFee: Record<string, number> = {};
	for (const r of rows)
		for (const e of effective(evs.get(r.id)!))
			if ((e.kind === 'buy' || e.kind === 'sell') && e.fee !== null) lastFee[r.currency] = e.fee;

	return {
		portfolio: p,
		summary: {
			value,
			cash,
			held,
			invested: t.invested,
			twrPct: t.twr === null ? null : t.twr * 100,
			from: t.from,
			realizedIls: positions.reduce((n, x) => n + x.realizedIls, 0),
			unrealizedIls: positions.reduce((n, x) => n + x.unrealizedIls, 0),
			fxUsd: r2(fxNow),
			pricesAsOf: positions.map((x) => x.lastDate).filter(Boolean).sort().at(-1) ?? null,
			benchmarks: bench(m, market, t.from, today)
		},
		positions,
		series: t.series,
		lastFee
	};
}

const r2 = (x: number) => Math.round(x * 10000) / 10000;

// ── a position ────────────────────────────────────────────────────────────────────────────────────────

export function positionView(app: Database.Database, market: Database.Database, id: number, today = israelDate()) {
	const r = positionRow(app, id);
	if (!r) return null;
	const view = portfolioView(app, market, r.portfolio_id, today)!;
	const pos = view.positions.find((x) => x.id === id)!;
	const m = marketView(market);
	const list = eventsOf(app, id);
	const reversedBy = new Map(list.filter((e) => e.kind === 'reverse' && !e.cancelledAt).map((e) => [e.reversesEventId!, e.id]));
	const now = Date.now();
	const events = list.map((e) => ({
		...e,
		auto: !!e.auto,
		reversedBy: reversedBy.get(e.id) ?? null,
		canCancel: !e.cancelledAt && !reversedBy.has(e.id) && now - Date.parse(e.createdAt) < 24 * 3600 * 1000,
		canReverse: !e.cancelledAt && e.kind !== 'reverse' && !reversedBy.has(e.id)
	}));
	const cash = cashOf(app, r.portfolio_id)
		.filter((c) => c.positionId === id)
		.map((c) => ({ ...c, auto: !!c.auto }));

	// «гипотеза → хочу купить → купил»: the result from the hypothesis's date against the result from the purchase
	const last = m.last(r.security_id);
	const firstBuy = effective(list).find((e) => e.kind === 'buy');
	const hyps = pos.hypotheses.map((hid) => {
		const h = app
			.prepare(
				`select id, symbol, direction, entry_date as entryDate, entry_price as entryPrice, entry_price_date as entryPriceDate, status from hypotheses where id = ?`
			)
			.get(hid) as { id: number; symbol: string; direction: string; entryDate: string; entryPrice: number | null; entryPriceDate: string | null; status: string };
		const k = (d: string) => splitFactor(d, m.splits(r.security_id));
		const fromIdea = h.entryPrice && last ? (last.close / (h.entryPrice / k(h.entryPriceDate ?? h.entryDate)) - 1) * 100 : null;
		const fromBuy = firstBuy?.price && last ? (last.close / (firstBuy.price / k(firstBuy.date)) - 1) * 100 : null;
		const pauseDays = firstBuy ? Math.round((Date.parse(firstBuy.date) - Date.parse(h.entryDate)) / 86400000) : null;
		return { ...h, fromIdea, fromBuy, pauseDays, buyDate: firstBuy?.date ?? null };
	});
	return { position: pos, portfolio: view.portfolio, events, cash, hypotheses: hyps, lastFee: view.lastFee, fxUsd: view.summary.fxUsd };
}

/** Keeps `stage` and `closed_at` of a position in step with its events. */
export function recomputeStage(app: Database.Database, market: Database.Database, positionId: number) {
	const r = positionRow(app, positionId)!;
	const list = eventsOf(app, positionId);
	const m = marketView(market);
	const qty = fifo(trades(list, m.splits(r.security_id)), unitFactor(r.price_unit)).qty;
	const stage = stageOf(list, qty);
	const live = effective(list);
	const closedAt = stage === 'closed' ? (live.at(-1)?.date ?? r.opened_at) : null;
	app.prepare('update positions set stage = ?, closed_at = ? where id = ?').run(stage, closedAt, positionId);
	return stage;
}

export interface EventInput {
	portfolioId?: unknown;
	securityId?: unknown;
	positionId?: unknown;
	kind?: unknown;
	date?: unknown;
	qty?: unknown;
	price?: unknown;
	fee?: unknown;
	amount?: unknown;
	note?: unknown;
	hypothesisId?: unknown;
	/** the person looked again at a price far from the day's range */
	confirm?: unknown;
}

const KINDS = ['watch', 'plan_buy', 'buy', 'plan_sell', 'sell', 'drop', 'note'];

/**
 * A new event of a position (section 18). A first event for a security opens a position in the portfolio (or
 * continues the open one). Rules: the date is not later than today; one cannot sell more than there is; a price
 * further than 10% from the day's range asks for a confirmation.
 */
export function addEvent(app: Database.Database, market: Database.Database, input: EventInput, now = new Date(), auto = false) {
	const today = israelDate(now);
	const kind = String(input.kind ?? '');
	const errors: Record<string, string> = {};
	if (!KINDS.includes(kind)) errors.kind = 'Неизвестное событие';
	const date = (input.date === undefined || input.date === '' ? today : input.date) as string;
	if (!isDate(date)) errors.date = 'Дата в виде ГГГГ-ММ-ДД';
	else if (date > today) errors.date = 'Дата не позже сегодняшней';
	const qty = num(input.qty);
	const price = num(input.price);
	const fee = num(input.fee) ?? 0;
	const amount = num(input.amount);
	const trade = kind === 'buy' || kind === 'sell';
	if (trade) {
		if (qty === null || !(qty > 0)) errors.qty = 'Количество больше нуля';
		if (price === null || !(price > 0)) errors.price = 'Цена больше нуля';
		if (!(fee >= 0)) errors.fee = 'Комиссия не меньше нуля';
	} else if (price !== null && !(price > 0)) errors.price = 'Цена больше нуля или пусто';
	if (amount !== null && !(amount > 0)) errors.amount = 'Сумма больше нуля или пусто';
	const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2000) || null : null;
	if (kind === 'note' && !note) errors.note = 'Текст заметки';
	if (Object.keys(errors).length) throw bad(errors);

	// the position: given, or the open one of this security in the portfolio, or a new one
	let pos: PositionRow | undefined;
	if (input.positionId) {
		pos = positionRow(app, Number(input.positionId));
		if (!pos) throw bad({ positionId: 'Позиции нет' });
	} else {
		const pid = Number(input.portfolioId);
		const sid = Number(input.securityId);
		if (!app.prepare('select 1 from portfolios where id = ?').get(pid)) throw bad({ portfolioId: 'Портфеля нет' });
		const s = security(market, sid);
		if (!s) throw bad({ securityId: 'Такой бумаги нет в базе' });
		if (s.exchange_code === 'INDEX_US') throw bad({ securityId: 'Индекс нельзя купить — выберите акцию или ETF' });
		pos = app.prepare(`select * from positions where portfolio_id = ? and security_id = ? and stage <> 'closed' order by id desc limit 1`).get(pid, sid) as
			| PositionRow
			| undefined;
		if (!pos) {
			if (kind === 'sell' || kind === 'plan_sell') throw bad({ kind: 'Этой бумаги в портфеле нет' });
			pos = app
				.prepare(
					`insert into positions (portfolio_id, security_id, symbol, security_name, exchange_code, currency, price_unit, stage, opened_at)
					 values (?, ?, ?, ?, ?, ?, ?, 'watch', ?) returning *`
				)
				.get(pid, sid, s.symbol, s.name_en, s.exchange_code, s.price_unit === 'USD' ? 'USD' : 'ILS', s.price_unit, date) as PositionRow;
		}
	}
	const m = marketView(market);
	const f = unitFactor(pos.price_unit);
	const list = eventsOf(app, pos.id);
	const held = fifo(trades(list, m.splits(pos.security_id)), f).qty;
	if ((kind === 'plan_sell' || kind === 'sell') && held <= EPS) throw bad({ kind: 'Продавать нечего: бумаги в позиции нет' });

	// a price far from the day's range: a typo or agorot for shekels — ask before saving
	if (trade && !auto && !input.confirm) {
		const day = m.day(pos.security_id, date as string);
		if (day) {
			const k = splitFactor(day.date, m.splits(pos.security_id)) / splitFactor(date as string, m.splits(pos.security_id));
			const lo = (day.low ?? day.close) * k;
			const hi = (day.high ?? day.close) * k;
			if (price! < lo * (1 - PRICE_SLACK) || price! > hi * (1 + PRICE_SLACK)) {
				const unit = pos.price_unit === 'ILA' ? 'агорот' : pos.currency === 'USD' ? '$' : '₪';
				const hint = pos.price_unit === 'ILA' && price! * 100 >= lo * 0.9 && price! * 100 <= hi * 1.1 ? ' Похоже, цена в шекелях — здесь нужны агороты.' : '';
				throw new ConfirmError(
					`Цена ${price} ${unit} далеко от диапазона дня ${day.date}: ${fmt(lo)}–${fmt(hi)} ${unit}.${hint} Сохранить всё равно?`
				);
			}
		}
	}

	const fxRate = pos.currency === 'USD' ? m.fx('USD', date as string) : 1;
	if (pos.currency === 'USD' && !fxOn(market, date as string) && !fxOn(market, '9999-12-31'))
		throw bad({ date: 'Курса доллара ещё нет — он загрузится утром' });

	const hypothesisId = input.hypothesisId ? Number(input.hypothesisId) : null;
	if (hypothesisId && !app.prepare('select 1 from hypotheses where id = ?').get(hypothesisId)) throw bad({ hypothesisId: 'Гипотезы нет' });

	return app.transaction(() => {
		const ev = app
			.prepare(
				`insert into position_events (position_id, kind, date, qty, price, currency, fee, fx_rate, amount, note, hypothesis_id, auto)
				 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`
			)
			.get(pos!.id, kind, date, trade ? qty : null, price, pos!.currency, trade ? fee : null, fxRate, amount, note, hypothesisId, auto ? 1 : 0) as {
			id: number;
		};
		// no point in time may hold less than nothing
		try {
			fifo(trades(eventsOf(app, pos!.id), m.splits(pos!.security_id)), f);
		} catch (e) {
			if (e instanceof OversellError) throw bad({ qty: e.message });
			throw e;
		}
		if (date < pos!.opened_at) app.prepare('update positions set opened_at = ? where id = ?').run(date, pos!.id);
		recomputeStage(app, market, pos!.id);
		return { positionId: pos!.id, eventId: ev.id };
	})();
}

const fmt = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** «Отменить» within 24 hours: an input error — the event leaves the account, the row stays. */
export function cancelEvent(app: Database.Database, market: Database.Database, id: number) {
	const e = app.prepare(`select ${EVENT_COLS} from position_events where id = ?`).get(id) as EventRow | undefined;
	if (!e) throw bad({ id: 'События нет' });
	if (e.cancelledAt) return e.positionId;
	if (Date.now() - Date.parse(e.createdAt) > 24 * 3600 * 1000) throw new LockedError('Отменить можно в первые 24 часа — дальше только сторно');
	return app.transaction(() => {
		app.prepare(`update position_events set cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ?`).run(id);
		checkPosition(app, market, e.positionId);
		recomputeStage(app, market, e.positionId);
		return e.positionId;
	})();
}

/** Storno: a «reverse» event takes the wrong one out of the account; both stay in the history. */
export function reverseEvent(app: Database.Database, market: Database.Database, id: number, note?: unknown, now = new Date()) {
	const e = app.prepare(`select ${EVENT_COLS} from position_events where id = ?`).get(id) as EventRow | undefined;
	if (!e) throw bad({ id: 'События нет' });
	if (e.cancelledAt || e.kind === 'reverse') throw new LockedError('Это событие уже не учитывается');
	if (app.prepare(`select 1 from position_events where reverses_event_id = ? and cancelled_at is null`).get(id))
		throw new LockedError('Событие уже сторнировано');
	return app.transaction(() => {
		app.prepare(
			`insert into position_events (position_id, kind, date, currency, note, reverses_event_id) values (?, 'reverse', ?, ?, ?, ?)`
		).run(e.positionId, israelDate(now), e.currency, typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null, id);
		checkPosition(app, market, e.positionId);
		recomputeStage(app, market, e.positionId);
		return e.positionId;
	})();
}

/** After a cancel or a storno no point in time may hold less than nothing (a buy taken out under a sell). */
function checkPosition(app: Database.Database, market: Database.Database, positionId: number) {
	const r = positionRow(app, positionId)!;
	try {
		fifo(trades(eventsOf(app, positionId), marketView(market).splits(r.security_id)), unitFactor(r.price_unit));
	} catch (e) {
		if (e instanceof OversellError) throw bad({ id: `Без этой покупки продажа больше, чем было: ${e.message}. Сначала сторнируйте продажу.` });
		throw e;
	}
}

// ── money ─────────────────────────────────────────────────────────────────────────────────────────────

const CASH_KINDS = ['deposit', 'withdraw', 'dividend', 'fee', 'tax'];

export function addCash(
	app: Database.Database,
	market: Database.Database,
	portfolioId: number,
	input: { kind?: unknown; date?: unknown; amount?: unknown; currency?: unknown; note?: unknown; positionId?: unknown },
	now = new Date(),
	auto = false
) {
	const today = israelDate(now);
	const errors: Record<string, string> = {};
	const kind = String(input.kind ?? '');
	if (!CASH_KINDS.includes(kind)) errors.kind = 'Неизвестный вид';
	const date = input.date === undefined || input.date === '' ? today : input.date;
	if (!isDate(date)) errors.date = 'Дата в виде ГГГГ-ММ-ДД';
	else if (date > today) errors.date = 'Дата не позже сегодняшней';
	const amount = num(input.amount);
	if (amount === null || !(amount > 0)) errors.amount = 'Сумма больше нуля';
	const currency = input.currency === 'USD' ? 'USD' : 'ILS';
	if (!app.prepare('select 1 from portfolios where id = ?').get(portfolioId)) errors.portfolioId = 'Портфеля нет';
	const positionId = input.positionId ? Number(input.positionId) : null;
	if (positionId && positionRow(app, positionId)?.portfolio_id !== portfolioId) errors.positionId = 'Позиция из другого портфеля';
	if (Object.keys(errors).length) throw bad(errors);
	const fxRate = currency === 'USD' ? marketView(market).fx('USD', date as string) : 1;
	return app
		.prepare(
			`insert into cash_events (portfolio_id, kind, date, amount, currency, fx_rate, note, position_id, auto) values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`
		)
		.get(portfolioId, kind, date, amount, currency, fxRate, typeof input.note === 'string' ? input.note.trim().slice(0, 500) || null : null, positionId, auto ? 1 : 0) as {
		id: number;
	};
}

export function cancelCash(app: Database.Database, id: number) {
	const c = app.prepare(`select ${CASH_COLS} from cash_events where id = ?`).get(id) as CashRow | undefined;
	if (!c) throw bad({ id: 'Записи нет' });
	if (Date.now() - Date.parse(c.createdAt) > 24 * 3600 * 1000) throw new LockedError('Отменить можно в первые 24 часа — дальше только сторно');
	app.prepare(`update cash_events set cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ? and cancelled_at is null`).run(id);
	return c.portfolioId;
}

export function reverseCash(app: Database.Database, id: number, now = new Date()) {
	const c = app.prepare(`select ${CASH_COLS} from cash_events where id = ?`).get(id) as CashRow | undefined;
	if (!c) throw bad({ id: 'Записи нет' });
	if (c.cancelledAt || c.kind === 'reverse') throw new LockedError('Эта запись уже не учитывается');
	if (app.prepare(`select 1 from cash_events where reverses_event_id = ? and cancelled_at is null`).get(id)) throw new LockedError('Запись уже сторнирована');
	app.prepare(`insert into cash_events (portfolio_id, kind, date, amount, currency, reverses_event_id) values (?, 'reverse', ?, ?, ?, ?)`).run(
		c.portfolioId,
		israelDate(now),
		c.amount,
		c.currency,
		id
	);
	return c.portfolioId;
}

export function portfolioCash(app: Database.Database, id: number) {
	const rows = cashOf(app, id);
	const reversedBy = new Map(rows.filter((c) => c.kind === 'reverse' && !c.cancelledAt).map((c) => [c.reversesEventId!, c.id]));
	const now = Date.now();
	return rows.map((c) => ({
		...c,
		auto: !!c.auto,
		reversedBy: reversedBy.get(c.id) ?? null,
		canCancel: !c.cancelledAt && !reversedBy.has(c.id) && now - Date.parse(c.createdAt) < 24 * 3600 * 1000,
		canReverse: !c.cancelledAt && c.kind !== 'reverse' && !reversedBy.has(c.id)
	}));
}

// ── automatic portfolio of a source ───────────────────────────────────────────────────────────────────

/**
 * Section 18 «Виртуальный портфель источника»: each hypothesis of the source of types recommendation, target or
 * opinion, on the rise, is bought for a fixed sum at its entry price and sold when it closes, at its exit price;
 * dividends while it is held come as money. A «down» hypothesis does not go in. Idempotent: run as often as
 * wanted (after the daily job, when it is switched on).
 */
export function syncAuto(app: Database.Database, market: Database.Database, now = new Date()) {
	const today = israelDate(now);
	const ports = app.prepare(`select * from portfolios where auto_source_id is not null and archived_at is null`).all() as PortfolioRow[];
	const m = marketView(market);
	const s = { bought: 0, sold: 0, dividends: 0, reversed: 0 };
	for (const p of ports) {
		const hyps = app
			.prepare(
				`select h.* from hypotheses h join articles a on a.id = h.article_id
				  where a.source_id = ? and h.direction = 'long' and h.signal_type in (${RATED_TYPES.map(() => '?').join(',')})
				  order by h.id`
			)
			.all(p.auto_source_id, ...RATED_TYPES) as Record<string, unknown>[];
		for (const h of hyps) {
			const hid = h.id as number;
			const buys = app
				.prepare(
					`select e.id, e.position_id as positionId from position_events e join positions p on p.id = e.position_id
					  where p.portfolio_id = ? and e.hypothesis_id = ? and e.kind = 'buy' and e.auto = 1 and e.cancelled_at is null`
				)
				.all(p.id, hid) as { id: number; positionId: number }[];
			const live = buys.filter((b) => !app.prepare(`select 1 from position_events where reverses_event_id = ? and cancelled_at is null`).get(b.id));
			if (h.status === 'cancelled') {
				for (const b of live) {
					for (const e of app
						.prepare(`select id from position_events where position_id = ? and kind <> 'reverse' and cancelled_at is null order by date desc, id desc`)
						.all(b.positionId) as { id: number }[])
						if (!app.prepare(`select 1 from position_events where reverses_event_id = ? and cancelled_at is null`).get(e.id)) {
							reverseEvent(app, market, e.id, 'гипотеза отменена', now);
							s.reversed++;
						}
				}
				continue;
			}
			const entry = h.entry_price as number | null;
			const entryDate = h.entry_price_date as string | null;
			if (!entry || !entryDate) continue;
			let positionId = live[0]?.positionId;
			if (!positionId) {
				const sec = security(market, h.security_id as number);
				if (!sec) continue;
				const f = unitFactor(sec.price_unit);
				const fx = sec.price_unit === 'USD' ? m.fx('USD', entryDate) : 1;
				const qty = p.auto_amount_ils / (entry * f * fx);
				positionId = app
					.prepare(
						`insert into positions (portfolio_id, security_id, symbol, security_name, exchange_code, currency, price_unit, stage, opened_at)
						 values (?, ?, ?, ?, ?, ?, ?, 'watch', ?) returning id`
					)
					.pluck()
					.get(p.id, sec.id, sec.symbol, sec.name_en, sec.exchange_code, sec.price_unit === 'USD' ? 'USD' : 'ILS', sec.price_unit, entryDate) as number;
				app.prepare(
					`insert into position_events (position_id, kind, date, qty, price, currency, fee, fx_rate, note, hypothesis_id, auto)
					 values (?, 'buy', ?, ?, ?, ?, 0, ?, ?, ?, 1)`
				).run(positionId, entryDate, qty, entry, sec.price_unit === 'USD' ? 'USD' : 'ILS', fx, `гипотеза №${hid}`, hid);
				s.bought++;
			}
			const pos = positionRow(app, positionId)!;
			const f = unitFactor(pos.price_unit);
			const list = eventsOf(app, positionId);
			const fi = fifo(trades(list, m.splits(pos.security_id)), f);
			const closed = (h.status === 'closed' || h.status === 'closed_early') && h.exit_price && h.exit_date;
			const exitDate = closed ? (h.exit_date as string) : today;
			// dividends while held: ex-date after the buy, not after the sale
			const buy = effective(list).find((e) => e.kind === 'buy')!;
			const qtyNow = (buy.qty ?? 0) * splitFactor(buy.date, m.splits(pos.security_id));
			for (const d of m.dividends(pos.security_id, buy.date, exitDate)) {
				const exists = app
					.prepare(`select 1 from cash_events where position_id = ? and kind = 'dividend' and date = ? and auto = 1 and cancelled_at is null`)
					.get(positionId, d.date);
				if (exists) continue;
				addCash(app, market, p.id, { kind: 'dividend', date: d.date, amount: qtyNow * d.amount * f, currency: pos.currency, note: `${pos.symbol}, авто`, positionId }, now, true);
				s.dividends++;
			}
			if (closed && fi.qty > EPS) {
				const fx = pos.currency === 'USD' ? m.fx('USD', exitDate) : 1;
				const k = splitFactor(exitDate, m.splits(pos.security_id));
				app.prepare(
					`insert into position_events (position_id, kind, date, qty, price, currency, fee, fx_rate, note, hypothesis_id, auto)
					 values (?, 'sell', ?, ?, ?, ?, 0, ?, ?, ?, 1)`
				).run(positionId, exitDate, fi.qty / k, h.exit_price, pos.currency, fx, `гипотеза №${hid} закрыта`, hid);
				s.sold++;
			}
			recomputeStage(app, market, positionId);
		}
	}
	return s;
}

/** Switches the automatic portfolio of a source on (made or brought back, filled at once) or off (archived). */
export function setAuto(app: Database.Database, market: Database.Database, sourceId: number, on: boolean, now = new Date()) {
	const src = app.prepare('select id, name, kind from sources where id = ?').get(sourceId) as { id: number; name: string; kind: string } | undefined;
	if (!src) throw bad({ sourceId: 'Источника нет' });
	const p = app.prepare('select * from portfolios where auto_source_id = ?').get(sourceId) as PortfolioRow | undefined;
	if (!on) {
		if (p) app.prepare('update portfolios set archived_at = ? where id = ?').run(new Date().toISOString(), p.id);
		return null;
	}
	if (p) app.prepare('update portfolios set archived_at = null where id = ?').run(p.id);
	else {
		let name = `Авто · ${src.name}`;
		if (app.prepare('select 1 from portfolios where name = ?').get(name)) name = `${name} (${sourceId})`;
		app.prepare(`insert into portfolios (name, kind, auto_source_id) values (?, 'virtual', ?)`).run(name, sourceId);
	}
	app.transaction(() => syncAuto(app, market, now))();
	return app.prepare('select * from portfolios where auto_source_id = ?').get(sourceId) as PortfolioRow;
}
