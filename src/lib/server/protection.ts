import type Database from 'better-sqlite3';
import { israelDate, type Errors } from '../hypothesis.js';
import { unitFactor } from '../portfolio.js';
import { InputError } from './journal.js';
import { getSetting, realPortfolios, setSetting } from './risk.js';
import { marketView, portfolioView } from './portfolio.js';
import { planOf } from './discipline.js';
import { splitScale } from './market/splits.js';
import { enqueueMissingHistory } from './market/history.js';

/**
 * T-021 «Защитный план» (owner, 20.11.2026: «я не выставляю стоп-лосс или трейлинг, и это должно быть базовым шагом»).
 * A deterministic formula over the app's daily prices — not AI: the stop below the nearest support level with a margin
 * of half an ATR, a limit under it, a trailing % from the ATR, the size of a new position from the risk budget. The app
 * is not connected to the broker: it gives the values to type in, records «я выставил» and keeps after the positions
 * until each one is protected; a trailing stop's level is followed here by the closes.
 */

export interface PParams {
	atrDays: number;
	/** the support levels: the lowest low of N and M days, the SMA of K days */
	lowShort: number;
	lowLong: number;
	sma: number;
	/** the stop sits this many ATR under the level */
	bufferAtr: number;
	/** a level counts if it is further than this many ATR under the price… */
	minAtr: number;
	/** …and nearer than this % */
	maxPct: number;
	/** no level: the price minus this many ATR */
	fallbackAtr: number;
	/** the limit: the stop minus max(limitPct %, limitAtr ATR) */
	limitPct: number;
	limitAtr: number;
	/** the trailing %: trailMult × ATR%, within trailMin…trailMax */
	trailMult: number;
	trailMin: number;
	trailMax: number;
	/** the risk budget of a new position, % of the portfolio's value */
	riskPct: number;
	/** the broker takes fractions of a share (to 0.01) */
	fractional: boolean;
}

export const PDEFAULTS: PParams = {
	atrDays: 14,
	lowShort: 20,
	lowLong: 60,
	sma: 200,
	bufferAtr: 0.5,
	minAtr: 1,
	maxPct: 15,
	fallbackAtr: 3,
	limitPct: 2,
	limitAtr: 1,
	trailMult: 3,
	trailMin: 8,
	trailMax: 20,
	riskPct: 1,
	fractional: false
};
const LIMITS: Record<Exclude<keyof PParams, 'fractional'>, [number, number]> = {
	atrDays: [5, 50],
	lowShort: [5, 120],
	lowLong: [10, 250],
	sma: [20, 300],
	bufferAtr: [0, 3],
	minAtr: [0, 5],
	maxPct: [3, 50],
	fallbackAtr: [1, 10],
	limitPct: [0, 20],
	limitAtr: [0, 5],
	trailMult: [1, 10],
	trailMin: [1, 50],
	trailMax: [2, 60],
	riskPct: [0.1, 10]
};

export function readPParams(app: Database.Database): PParams {
	const raw = getSetting(app, 'protection');
	return raw ? cleanPParams(JSON.parse(raw)) : { ...PDEFAULTS };
}
export function cleanPParams(input: Record<string, unknown>, base: PParams = PDEFAULTS): PParams {
	const out = { ...base };
	for (const [k, [lo, hi]] of Object.entries(LIMITS) as [keyof typeof LIMITS, [number, number]][]) {
		if (input[k] === undefined) continue;
		const x = Number(String(input[k]).replace(',', '.'));
		if (Number.isFinite(x) && x >= lo && x <= hi) out[k] = x;
	}
	if (typeof input.fractional === 'boolean') out.fractional = input.fractional;
	if (out.trailMax < out.trailMin) out.trailMax = out.trailMin;
	return out;
}
export function writePParams(app: Database.Database, input: Record<string, unknown>) {
	const p = cleanPParams(input, readPParams(app));
	setSetting(app, 'protection', JSON.stringify(p));
	if (input.broker !== undefined) setSetting(app, 'broker_name', String(input.broker ?? '').trim().slice(0, 40) || null);
	return { params: p, broker: brokerOf(app) };
}
/** the broker's name the owner typed (kept in the database, never in the code): «у брокера» without it */
export const brokerOf = (app: Database.Database) => getSetting(app, 'broker_name');

// ── the formula (pure) ───────────────────────────────────────────────────────────────────────────────────

export interface Bar {
	date: string;
	low: number | null;
	high: number | null;
	close: number;
}

/** the average true range of the last `days` days, in price units */
export function atrOf(bars: Bar[], days: number): number | null {
	if (bars.length < Math.min(days, 6) + 1) return null;
	const tr: number[] = [];
	for (let i = Math.max(1, bars.length - days); i < bars.length; i++) {
		const p = bars[i - 1].close;
		const x = bars[i];
		tr.push(x.high !== null && x.low !== null ? Math.max(x.high - x.low, Math.abs(x.high - p), Math.abs(x.low - p)) : Math.abs(x.close - p));
	}
	return tr.reduce((a, b) => a + b, 0) / tr.length;
}

/** not on a round number: down to the nearest price ending in 7 (75.20 → 75.17; agorot 4 520 → 4 517) */
export function roundStop(x: number, agorot: boolean) {
	const c = agorot ? Math.floor(x) : Math.floor(x * 100 + 1e-6);
	const r = Math.floor((c - 7) / 10) * 10 + 7;
	return agorot ? r : r / 100;
}
const floorTick = (x: number, agorot: boolean) => (agorot ? Math.floor(x) : Math.floor(x * 100 + 1e-6) / 100);

export type LevelKind = 'low_short' | 'low_long' | 'sma';
export interface Formula {
	atr: number;
	atrPct: number;
	level: { kind: LevelKind; days: number; value: number } | null;
	stop: number;
	limit: number;
	trailPct: number;
	/** the stop of a trailing order placed now */
	trailStop: number;
}

/** the fixed stop, its limit and the trailing % for a price from the daily bars (or from an ATR given) */
export function formula(bars: Bar[], price: number, p: PParams, agorot: boolean, atrGiven?: number): Formula | null {
	const atr = atrGiven ?? atrOf(bars, p.atrDays);
	if (!atr || !(price > 0)) return null;
	const lowOf = (n: number) => (bars.length >= Math.min(n, 5) ? Math.min(...bars.slice(-n).map((b) => b.low ?? b.close)) : null);
	const levels: { kind: LevelKind; days: number; value: number | null }[] = [
		{ kind: 'low_short', days: p.lowShort, value: atrGiven ? null : lowOf(p.lowShort) },
		{ kind: 'low_long', days: p.lowLong, value: atrGiven ? null : lowOf(p.lowLong) },
		{ kind: 'sma', days: p.sma, value: !atrGiven && bars.length >= p.sma ? bars.slice(-p.sma).reduce((a, b) => a + b.close, 0) / p.sma : null }
	];
	const ok = levels.filter((l): l is { kind: LevelKind; days: number; value: number } => l.value !== null && price - l.value >= p.minAtr * atr && ((price - l.value) / price) * 100 <= p.maxPct);
	const level = ok.sort((a, b) => b.value - a.value)[0] ?? null;
	const raw = level ? level.value - p.bufferAtr * atr : price - p.fallbackAtr * atr;
	const stop = roundStop(raw, agorot);
	const limit = floorTick(stop - Math.max((stop * p.limitPct) / 100, p.limitAtr * atr), agorot);
	const atrPct = (atr / price) * 100;
	const trailPct = Math.round(Math.min(p.trailMax, Math.max(p.trailMin, p.trailMult * atrPct)) * 2) / 2;
	return { atr, atrPct, level, stop, limit, trailPct, trailStop: floorTick(price * (1 - trailPct / 100), agorot) };
}

/** the size of a new position: the risk budget over the loss per share at the stop, down to whole shares (or 0.01) */
export function sizeOf(budget: number, price: number, stop: number, f: number, fractional: boolean) {
	const per = (price - stop) * f;
	if (!(per > 0) || !(budget > 0)) return { qty: 0, amount: 0 };
	const qty = fractional ? Math.floor((budget / per) * 100) / 100 : Math.floor(budget / per);
	return { qty, amount: qty * price * f };
}

/** a trailing order's level now: the highest of its start price and the closes since, minus its % — never down */
export function trailLevel(base: number, closes: number[], pct: number) {
	return Math.max(base, ...closes) * (1 - pct / 100);
}

// ── the data ─────────────────────────────────────────────────────────────────────────────────────────────

/** the daily bars of a security in its current split scale, oldest first */
export function barsOf(market: Database.Database, id: number, n = 260): Bar[] {
	const scale = splitScale(market, id);
	return (market.prepare('select date, low, high, close from market_prices_daily where security_id = ? order by date desc limit ?').all(id, n) as Bar[])
		.reverse()
		.map((r) => {
			const k = scale(r.date);
			return k === 1 ? r : { date: r.date, low: r.low === null ? null : r.low / k, high: r.high === null ? null : r.high / k, close: r.close / k };
		});
}

/** without the daily history: the ATR guessed from the monthly swings (a day's range ≈ 1.3 × its standard deviation) */
function monthlyAtrPct(market: Database.Database, id: number) {
	const rows = market.prepare('select adj_close as a from market_prices_monthly where security_id = ? order by month desc limit 37').all(id) as { a: number }[];
	if (rows.length < 7) return null;
	const r = rows
		.reverse()
		.slice(1)
		.map((x, i) => Math.log(x.a / rows[i].a));
	const m = r.reduce((a, b) => a + b, 0) / r.length;
	const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, r.length - 1));
	return (sd / Math.sqrt(21)) * 1.3 * 100;
}

export interface Order {
	id: number;
	positionId: number;
	type: 'fixed' | 'trail';
	stop: number | null;
	limitPrice: number | null;
	trailPct: number | null;
	basePrice: number | null;
	qty: number | null;
	setDate: string;
	createdAt: string;
}
const ORDER = `select id, position_id as positionId, type, stop, limit_price as limitPrice, trail_pct as trailPct, base_price as basePrice, qty, set_date as setDate, created_at as createdAt from protection_orders`;
export const activeOrder = (app: Database.Database, positionId: number) =>
	(app.prepare(`${ORDER} where position_id = ? and cancelled_at is null order by id desc limit 1`).get(positionId) as Order | undefined) ?? null;

/** the level an order stands at now (the trailing one followed by the closes since it was placed, and today's quote) */
export function orderLevel(market: Database.Database, o: Order, securityId: number, live: number | null = null) {
	if (o.type === 'fixed') return o.stop;
	if (!o.trailPct) return null;
	const scale = splitScale(market, securityId);
	const closes = (market.prepare('select date, close from market_prices_daily where security_id = ? and date >= ?').all(securityId, o.setDate) as { date: string; close: number }[]).map((r) => r.close / scale(r.date));
	return trailLevel(o.basePrice ?? 0, live !== null ? [...closes, live] : closes, o.trailPct);
}

/** «Я выставил у брокера»: the order replaces the one before; a fixed stop also becomes the trade's stop (T-015) */
export function placeOrder(app: Database.Database, input: { positionId?: unknown; type?: unknown; stop?: unknown; limit?: unknown; trailPct?: unknown; price?: unknown; qty?: unknown }, today = israelDate()) {
	const positionId = Number(input.positionId);
	const pos = app.prepare('select id, stage from positions where id = ?').get(positionId) as { id: number; stage: string } | undefined;
	if (!pos) throw new InputError({ position: 'Нет такой позиции' } as Errors);
	const type = input.type === 'trail' ? 'trail' : input.type === 'fixed' ? 'fixed' : null;
	if (!type) throw new InputError({ type: 'Стоп-лимит или трейлинг' } as Errors);
	const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.')));
	const stop = num(input.stop);
	const limit = num(input.limit);
	const trail = num(input.trailPct);
	const price = num(input.price);
	const qty = num(input.qty);
	if (type === 'fixed' && !(stop !== null && stop > 0)) throw new InputError({ stop: 'Уровень стопа' } as Errors);
	if (type === 'fixed' && limit !== null && !(limit > 0 && limit <= stop!)) throw new InputError({ limit: 'Лимит не выше стопа' } as Errors);
	if (type === 'trail' && !(trail !== null && trail > 0 && trail < 60)) throw new InputError({ trailPct: 'Трейлинг, % от 0 до 60' } as Errors);
	if (type === 'trail' && !(price !== null && price > 0)) throw new InputError({ price: 'Цена' } as Errors);
	const before = activeOrder(app, positionId);
	return app.transaction(() => {
		if (before) app.prepare('update protection_orders set cancelled_at = ? where id = ?').run(new Date().toISOString(), before.id);
		const id = Number(
			app
				.prepare('insert into protection_orders (position_id, type, stop, limit_price, trail_pct, base_price, qty, set_date) values (?, ?, ?, ?, ?, ?, ?, ?)')
				.run(positionId, type, type === 'fixed' ? stop : null, type === 'fixed' ? limit : null, type === 'trail' ? trail : null, price, qty, today).lastInsertRowid
		);
		// the trade's conditions (T-015) take a fixed stop: its signal, the «Дисциплина» numbers and the diary see it
		const plan = planOf(app, positionId);
		if (type === 'fixed' && plan && plan.stop !== stop)
			app.prepare('insert into trade_plans (position_id, event_id, kind, thesis, wrong_if, stop, target, review_date, no_stop_reason, reason) values (?, null, ?, ?, ?, ?, ?, ?, null, ?)').run(
				positionId,
				plan.kind,
				plan.thesis,
				plan.wrongIf,
				stop,
				plan.target,
				plan.reviewDate,
				'Защитный план: стоп выставлен у брокера'
			);
		return id;
	})();
}

/** the order is gone at the broker (cancelled, or the position sold) */
export function cancelOrder(app: Database.Database, positionId: number) {
	return app.prepare('update protection_orders set cancelled_at = ? where position_id = ? and cancelled_at is null').run(new Date().toISOString(), positionId).changes;
}

// ── the views ────────────────────────────────────────────────────────────────────────────────────────────

export type Status = 'protected' | 'near' | 'unprotected' | 'declined';
type TypeReason = 'model_term' | 'spec' | 'no_thesis' | 'profit' | 'no_term' | 'term' | 'new';

export interface Protection {
	securityId: number;
	symbol: string;
	priceUnit: string;
	currency: string;
	price: number;
	approx: boolean;
	/** the daily history is queued: the plan is from the monthly swings for now */
	historyQueued: boolean;
	f: Formula;
	recommended: 'fixed' | 'trail';
	why: TypeReason;
	/** a security without a position: the size by the risk budget */
	size: { qty: number; amount: number; budget: number; portfolio: string; portfolioCurrency: string } | null;
	/** a position: its quantity and what the recommended stop would lose from today's price */
	position: { id: number; qty: number; portfolioId: number; portfolio: string; portfolioCurrency: string } | null;
	maxLoss: { fixed: number; trail: number; pctFixed: number | null; pctTrail: number | null; currency: string } | null;
	order: (Order & { level: number | null }) | null;
	status: Status | null;
	noStopReason: string | null;
	broker: string | null;
}

type PV = NonNullable<ReturnType<typeof portfolioView>> & { id: number; name: string };
type PPos = PV['positions'][number];

function chooseType(app: Database.Database, pos: PPos | null): { type: 'fixed' | 'trail'; why: TypeReason } {
	if (!pos) return { type: 'fixed', why: 'new' };
	const plan = planOf(app, pos.id);
	if (plan?.kind === 'model' && plan.reviewDate) return { type: 'fixed', why: 'model_term' };
	if (plan?.kind === 'spec') return { type: 'fixed', why: 'spec' };
	const review = app.prepare('select would_buy as w from position_reviews where position_id = ? order by id desc limit 1').get(pos.id) as { w: number | null } | undefined;
	if (review?.w === 0) return { type: 'fixed', why: 'no_thesis' };
	if ((pos.unrealized ?? 0) > 0) return { type: 'trail', why: 'profit' };
	if (!plan?.reviewDate) return { type: 'trail', why: 'no_term' };
	return { type: 'fixed', why: 'term' };
}

function build(app: Database.Database, market: Database.Database, securityId: number, pv: PV | null, pos: PPos | null, p: PParams, broker: string | null, today: string): Protection | null {
	const sec = market.prepare('select id, symbol, price_unit as priceUnit, currency from ref_securities where id = ?').get(securityId) as { id: number; symbol: string; priceUnit: string; currency: string } | undefined;
	if (!sec) return null;
	const m = marketView(market);
	const bars = barsOf(market, securityId, Math.max(p.sma, p.lowLong) + 5);
	const live = m.live(securityId)?.price ?? null;
	const price = pos?.lastPrice ?? live ?? bars.at(-1)?.close ?? null;
	if (!price) return null;
	const agorot = sec.priceUnit === 'ILA';
	let approx = false;
	let historyQueued = false;
	let f = bars.length >= 15 ? formula(bars, price, p, agorot) : null;
	if (!f) {
		historyQueued = enqueueMissingHistory(market, [securityId], today) > 0 || !bars.length;
		const a = monthlyAtrPct(market, securityId);
		if (a) {
			f = formula([], price, p, agorot, (a / 100) * price);
			approx = true;
		}
	}
	if (!f) return null;
	const k = unitFactor(sec.priceUnit);
	const { type, why } = chooseType(app, pos);
	const pcur = pv?.summary.currency ?? 'ILS';
	const conv = pv ? m.conv(sec.currency, pcur, today) : 1;
	const value = pv ? pv.summary.held + Math.max(0, pv.summary.cash) : 0;
	let size: Protection['size'] = null;
	let maxLoss: Protection['maxLoss'] = null;
	if (pos && pos.qty > 0) {
		const lf = (pos.lastPrice! - f.stop) * pos.qty * k * conv;
		const lt = (pos.lastPrice! - f.trailStop) * pos.qty * k * conv;
		maxLoss = { fixed: lf, trail: lt, pctFixed: value > 0 ? (lf / value) * 100 : null, pctTrail: value > 0 ? (lt / value) * 100 : null, currency: pcur };
	} else if (pv) {
		const budget = ((value * p.riskPct) / 100) / conv;
		const s = sizeOf(budget, price, f.stop, k, p.fractional);
		size = { ...s, budget, portfolio: pv.name, portfolioCurrency: pcur };
		const l = (price - f.stop) * s.qty * k * conv;
		maxLoss = { fixed: l, trail: (price - f.trailStop) * s.qty * k * conv, pctFixed: value > 0 ? (l / value) * 100 : null, pctTrail: value > 0 ? (((price - f.trailStop) * s.qty * k * conv) / value) * 100 : null, currency: pcur };
	}
	const o = pos ? activeOrder(app, pos.id) : null;
	const order = o ? { ...o, level: orderLevel(market, o, securityId, live) } : null;
	const plan = pos ? planOf(app, pos.id) : null;
	let status: Status | null = null;
	if (pos && pos.qty > 0) {
		if (order && order.level !== null) status = price - order.level < f.atr ? 'near' : 'protected';
		else status = plan?.noStopReason ? 'declined' : 'unprotected';
	}
	return {
		securityId,
		symbol: sec.symbol,
		priceUnit: sec.priceUnit,
		currency: sec.currency,
		price,
		approx,
		historyQueued,
		f,
		recommended: type,
		why,
		size,
		position: pos && pv ? { id: pos.id, qty: pos.qty, portfolioId: pv.id, portfolio: pv.name, portfolioCurrency: pcur } : null,
		maxLoss,
		order,
		status,
		noStopReason: plan?.noStopReason ?? null,
		broker
	};
}

/** the block «Защита» of a security: for each open position in the real portfolios — or, with none, for a new purchase */
export function protectionOf(app: Database.Database, market: Database.Database, securityId: number, opts: { portfolioId?: number } = {}, today = israelDate()) {
	const p = readPParams(app);
	const broker = brokerOf(app);
	const out: Protection[] = [];
	const ports = realPortfolios(app);
	let first: PV | null = null;
	for (const port of ports) {
		const v = portfolioView(app, market, port.id, today);
		if (!v) continue;
		const pv: PV = { ...v, id: port.id, name: port.name };
		if (!first || port.id === opts.portfolioId) first = pv;
		for (const pos of pv.positions) if (pos.securityId === securityId && pos.qty > 0 && pos.stage === 'holding') {
			const x = build(app, market, securityId, pv, pos, p, broker, today);
			if (x) out.push(x);
		}
	}
	if (!out.length) {
		const x = build(app, market, securityId, first, null, p, broker, today);
		if (x) out.push(x);
	}
	return { params: p, broker, items: out };
}

/** the line on top of a portfolio: the protected share, the loss if every stop is hit, the positions without one */
export function portfolioProtection(app: Database.Database, market: Database.Database, portfolioId: number, today = israelDate()) {
	const v = portfolioView(app, market, portfolioId, today);
	const name = (app.prepare('select name from portfolios where id = ?').get(portfolioId) as { name: string } | undefined)?.name ?? '';
	if (!v) return null;
	const pv: PV = { ...v, id: portfolioId, name };
	const p = readPParams(app);
	const broker = brokerOf(app);
	const m = marketView(market);
	let total = 0;
	let covered = 0;
	let loss = 0;
	const items: Protection[] = [];
	for (const pos of pv.positions) {
		if (!(pos.qty > 0) || pos.stage !== 'holding') continue;
		const x = build(app, market, pos.securityId, pv, pos, p, broker, today);
		total += pos.valuePc;
		if (!x) continue;
		items.push(x);
		if (x.order && x.order.level !== null) {
			covered += pos.valuePc;
			loss += Math.max(0, (pos.lastPrice! - x.order.level) * pos.qty * unitFactor(pos.priceUnit) * m.conv(pos.currency, pv.summary.currency, today));
		}
	}
	const value = pv.summary.held + Math.max(0, pv.summary.cash);
	const unprotected = items.filter((x) => x.status === 'unprotected' || x.status === 'declined');
	return {
		portfolioId,
		currency: pv.summary.currency,
		protectedPct: total > 0 ? (covered / total) * 100 : 100,
		maxLoss: loss,
		maxLossPct: value > 0 ? (loss / value) * 100 : null,
		unprotected: unprotected.length,
		near: items.filter((x) => x.status === 'near').length,
		items,
		broker
	};
}

/** the daily row of each real portfolio (the «Статистика» share of fully protected days) */
export function recordProtectionDay(app: Database.Database, market: Database.Database, today = israelDate()) {
	const put = app.prepare('insert into protection_days (date, portfolio_id, protected_pct, unprotected) values (?, ?, ?, ?) on conflict (date, portfolio_id) do update set protected_pct = excluded.protected_pct, unprotected = excluded.unprotected');
	let n = 0;
	for (const port of realPortfolios(app)) {
		const s = portfolioProtection(app, market, port.id, today);
		if (!s || !s.items.length) continue;
		put.run(today, port.id, Math.round(s.protectedPct * 10) / 10, s.unprotected);
		n++;
	}
	return n;
}

/**
 * «Статистика»: the result of the sales of positions that had a stop at the broker against those without, and the
 * share of days every position was protected.
 */
export function protectionStats(app: Database.Database) {
	const sales = app
		.prepare(
			`select e.position_id as positionId, e.date, e.price, s.price_unit as unit,
			        (select count(*) from protection_orders o where o.position_id = e.position_id and o.set_date <= e.date) as hadStop,
			        (select sum(b.qty * b.price) / sum(b.qty) from position_events b where b.position_id = e.position_id and b.kind = 'buy' and b.date <= e.date) as cost
			   from position_events e join positions s on s.id = e.position_id join portfolios p on p.id = s.portfolio_id
			  where e.kind = 'sell' and p.kind = 'real' and p.auto_source_id is null and not exists (select 1 from position_events r where r.reverses_event_id = e.id)`
		)
		.all() as { positionId: number; date: string; price: number; hadStop: number; cost: number | null }[];
	const group = (xs: typeof sales) => {
		const r = xs.filter((x) => x.cost).map((x) => (x.price / x.cost! - 1) * 100);
		return { n: r.length, avg: r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null, worst: r.length ? Math.round(Math.min(...r) * 10) / 10 : null };
	};
	const days = app.prepare('select date, min(protected_pct) as pct from protection_days group by date').all() as { date: string; pct: number }[];
	return {
		withStop: group(sales.filter((s) => s.hadStop > 0)),
		withoutStop: group(sales.filter((s) => !s.hadStop)),
		days: days.length,
		fullDaysPct: days.length ? Math.round((days.filter((d) => d.pct >= 99.5).length / days.length) * 1000) / 10 : null
	};
}
