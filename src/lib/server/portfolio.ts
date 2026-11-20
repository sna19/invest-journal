import { readProfiles, type ProfileView } from './market/profiles.js';
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
	type BasisEv,
	type Book,
	type CashEv,
	type Market,
	type Split,
	type Stage
} from '../portfolio.js';
import { RATED_TYPES } from '../stats.js';
import { InputError, LockedError } from './journal.js';
import type { Errors } from '../hypothesis.js';
import { fxOn } from './market/boi.js';
import { readQuotes } from './market/quotes.js';

/**
 * Spec section 18 — portfolios on the server: events in, positions and returns out. Plain SQL on both files:
 * the journal (app.db) and the market (market.db); the arithmetic is in $lib/portfolio.ts.
 *
 * A portfolio lives in one currency — the one the broker shows the total in (USD or ILS). Its value, return and
 * benchmark are in it; positions in another currency (ETF UCITS in dollars in a shekel portfolio) and money kept
 * in another currency are converted at the Bank of Israel rate of the day.
 */

/** A price that differs from the day's range by more than this needs a confirmation (a typo, agorot for shekels). */
export const PRICE_SLACK = 0.1;
const EPS = 1e-9;
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.').replace(/\s/g, '')));

/** Field errors of the portfolio forms, answered as 400 like the journal's. */
const bad = (errors: Record<string, string>) => new InputError(errors as Errors);

/** A rule asks the person to look again: the answer is 409 with `confirm: true`; sent again with confirm, it goes. */
export class ConfirmError extends Error {}

export const CURRENCIES = ['USD', 'ILS'] as const;
/** The automatic portfolio's sum per hypothesis by currency (section 18). */
export const AUTO_AMOUNT: Record<string, number> = { USD: 3000, ILS: 10000 };

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
	manual: number;
}

export function security(market: Database.Database, id: number) {
	return market
		.prepare(
			`select s.id, s.symbol, s.name_en, s.exchange_code, s.currency, s.price_unit, s.active, s.manual, e.country
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code where s.id = ?`
		)
		.get(id) as SecRow | undefined;
}

/** The money a security's prices are in: dollars for US and LSE dollar lines, shekels for TASE (agorot are shekels). */
export const moneyOf = (priceUnit: string) => (priceUnit === 'USD' ? 'USD' : 'ILS');

/** Prices, rates and splits with small caches: one view of a portfolio asks for the same ones many times. */
export function marketView(market: Database.Database): Market & {
	splits(securityId: number): Split[];
	day(securityId: number, date: string): { date: string; low: number | null; high: number | null; close: number } | null;
	last(securityId: number): { date: string; close: number; providerCode: string } | null;
	dividends(securityId: number, after: string, upTo: string): { date: string; amount: number }[];
	usd(date: string): number;
	/** the live quote of a security when it is newer than its last daily close (owner's request 19.11.2026) */
	live(securityId: number): { date: string; price: number; time: string } | null;
	/** the time of the live dollar rate used for today, if any */
	liveFxTime: string | null;
	/** when the app last fetched quotes (not the exchange's time) */
	fetchedAt: string | null;
	/**
	 * T-019: the day's move of a security — the live quote against the previous close, or, without a live quote
	 * (the exchange has not opened, quotes are off), the last close against the one before, with its date
	 */
	dayMove(securityId: number): { now: number; prev: number; date: string; live: boolean } | null;
	/** the dollar's day move the same way: today's live rate against the previous one, or the bank's last two */
	fxMove(date: string, live: boolean): { now: number; prev: number };
} {
	const quotes = readQuotes(market);
	const today = israelDate();
	const fxLive = quotes.get('fx:USD/ILS');
	const fxLiveToday = fxLive && israelDate(new Date(fxLive.marketTime)) >= israelDate(new Date(Date.now() - 4 * 86400000)) ? fxLive : null;
	const priceQ = market.prepare('select close from market_prices_daily where security_id = ? and date <= ? order by date desc limit 1');
	const dayQ = market.prepare('select date, low, high, close from market_prices_daily where security_id = ? and date <= ? order by date desc limit 1');
	const lastQ = market.prepare('select date, close, provider_code as providerCode from market_prices_daily where security_id = ? order by date desc limit 1');
	const beforeQ = market.prepare('select date, close from market_prices_daily where security_id = ? and date < ? order by date desc limit 1');
	const fxBeforeQ = market.prepare(`select rate from market_fx_daily where pair = 'USD/ILS' and date < ? order by date desc limit 1`);
	const splitQ = market.prepare(`select ex_date as date, ratio from market_corporate_actions where security_id = ? and kind = 'split' and ratio > 0`);
	const divQ = market.prepare(
		`select ex_date as date, amount from market_corporate_actions where security_id = ? and kind = 'dividend' and ex_date > ? and ex_date <= ? order by ex_date`
	);
	const cache = new Map<string, number | null>();
	const splitCache = new Map<number, Split[]>();
	const usd = (date: string) => {
		// today's value: the live rate when there is one (the bank's rate comes once a day)
		if (date >= today && fxLiveToday) return fxLiveToday.price;
		const k = `fx|${date}`;
		if (!cache.has(k)) cache.set(k, fxOn(market, date) ?? fxOn(market, '9999-12-31'));
		return cache.get(k) ?? 1;
	};
	return {
		price(id, date) {
			const k = `${id}|${date}`;
			if (!cache.has(k)) cache.set(k, (priceQ.get(id, date) as { close: number } | undefined)?.close ?? null);
			return cache.get(k)!;
		},
		conv: (from, to, date) => (from === to ? 1 : from === 'USD' && to === 'ILS' ? usd(date) : from === 'ILS' && to === 'USD' ? 1 / usd(date) : 1),
		usd,
		splits(id) {
			if (!splitCache.has(id)) splitCache.set(id, splitQ.all(id) as Split[]);
			return splitCache.get(id)!;
		},
		day: (id, date) => (dayQ.get(id, date) as never) ?? null,
		last: (id) => (lastQ.get(id) as never) ?? null,
		live(id) {
			const q = quotes.get(`sec:${id}`);
			if (!q) return null;
			const date = israelDate(new Date(q.marketTime));
			const close = lastQ.get(id) as { date: string } | undefined;
			return !close || date >= close.date ? { date, price: q.price, time: q.marketTime } : null;
		},
		dayMove(id) {
			const last = lastQ.get(id) as { date: string; close: number } | undefined;
			const q = quotes.get(`sec:${id}`);
			const qDate = q ? israelDate(new Date(q.marketTime)) : null;
			if (q && qDate && (!last || qDate >= last.date)) {
				// the quote's own previous close; else the last daily close before the quote's day
				const prev = q.prevClose ?? (beforeQ.get(id, qDate) as { close: number } | undefined)?.close ?? (last && last.date < qDate ? last.close : null);
				return prev ? { now: q.price, prev, date: qDate, live: true } : null;
			}
			if (!last) return null;
			const before = beforeQ.get(id, last.date) as { close: number } | undefined;
			return before ? { now: last.close, prev: before.close, date: last.date, live: false } : null;
		},
		fxMove(date, live) {
			if (live && fxLiveToday) {
				const prev = fxLiveToday.prevClose ?? (fxBeforeQ.get(today) as { rate: number } | undefined)?.rate ?? fxLiveToday.price;
				return { now: fxLiveToday.price, prev };
			}
			return { now: usd(date), prev: (fxBeforeQ.get(date) as { rate: number } | undefined)?.rate ?? usd(date) };
		},
		liveFxTime: fxLiveToday?.marketTime ?? null,
		fetchedAt: [...quotes.values()].map((q) => q.fetchedAt).sort().at(-1) ?? null,
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

/**
 * T-019: the portfolio's change for the day — the sum of the positions' day money and the rate's move of cash
 * kept in another currency, against the value at the previous close; the date is the newest of the positions'.
 */
function dayOfPortfolio(
	positions: { dayPc: number | null; dayBase: number | null; dayDate: string | null }[],
	balances: { currency: string; amount: number; valuePc: number }[],
	pc: string,
	m: ReturnType<typeof marketView>
) {
	const moved = positions.filter((x) => x.dayPc !== null);
	if (!moved.length) return null;
	const date = moved.map((x) => x.dayDate!).sort().at(-1)!;
	const live = date >= israelDate();
	let money = moved.reduce((n, x) => n + x.dayPc!, 0);
	let base = moved.reduce((n, x) => n + x.dayBase!, 0);
	for (const b of balances) {
		// cash below zero (purchases without the deposits entered) would shrink the base and blow up the %
		if (b.currency === pc) {
			base += Math.max(0, b.amount);
			continue;
		}
		const fx = m.fxMove(date, live);
		const at = (rate: number) => (pc === 'ILS' ? b.amount * rate : b.amount / rate);
		money += at(fx.now) - at(fx.prev);
		base += Math.max(0, at(fx.prev));
	}
	return { money, pct: base > EPS ? (money / base) * 100 : null, date, positions: moved.length };
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

export interface EventRow extends BasisEv {
	positionId: number;
	currency: string;
	amount: number | null;
	note: string | null;
	hypothesisId: number | null;
	auto: number;
	createdAt: string;
}

const EVENT_COLS = `id, position_id as positionId, kind, date, qty, price, currency, fee, fx_rate as fxRate, amount, cost_total as costTotal, note,
	hypothesis_id as hypothesisId, reverses_event_id as reversesEventId, auto, cancelled_at as cancelledAt, created_at as createdAt`;
const CASH_COLS = `id, portfolio_id as portfolioId, kind, date, amount, currency, to_amount as toAmount, to_currency as toCurrency, fx_rate as fxRate,
	note, position_id as positionId, reverses_event_id as reversesEventId, auto, cancelled_at as cancelledAt, created_at as createdAt`;

export interface CashRow extends CashEv {
	portfolioId: number;
	currency: string;
	toAmount: number | null;
	toCurrency: string | null;
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

// ── portfolios ────────────────────────────────────────────────────────────────────────────────────────

export interface PortfolioRow {
	id: number;
	name: string;
	kind: 'real' | 'virtual';
	currency: 'USD' | 'ILS';
	auto_source_id: number | null;
	auto_amount_ils: number;
	tax_accrued: number | null;
	sort_order: number;
	archived_at: string | null;
	sourceName?: string | null;
}

const portfolioRow = (app: Database.Database, id: number) =>
	app.prepare('select p.*, s.name as sourceName from portfolios p left join sources s on s.id = p.auto_source_id where p.id = ?').get(id) as
		| PortfolioRow
		| undefined;

export function listPortfolios(app: Database.Database, all = false): PortfolioRow[] {
	return app
		.prepare(
			`select p.*, s.name as sourceName from portfolios p left join sources s on s.id = p.auto_source_id
			  ${all ? '' : 'where p.archived_at is null'} order by p.kind = 'virtual', p.auto_source_id is not null, p.sort_order, p.id`
		)
		.all() as PortfolioRow[];
}

export function createPortfolio(app: Database.Database, input: { name?: unknown; kind?: unknown; currency?: unknown }) {
	const name = String(input.name ?? '').trim();
	if (!name) throw bad({ name: 'Название портфеля' });
	if (name.length > 60) throw bad({ name: 'До 60 знаков' });
	const kind = input.kind === 'virtual' ? 'virtual' : 'real';
	if (!CURRENCIES.includes(input.currency as never)) throw bad({ currency: 'Валюта портфеля — доллары или шекели' });
	if (app.prepare('select 1 from portfolios where name = ?').get(name)) throw bad({ name: 'Портфель с таким названием уже есть' });
	return app.prepare('insert into portfolios (name, kind, currency) values (?, ?, ?) returning *').get(name, kind, input.currency) as PortfolioRow;
}

export function updatePortfolio(
	app: Database.Database,
	id: number,
	input: { name?: unknown; archived?: unknown; autoAmountIls?: unknown; taxAccrued?: unknown; currency?: unknown },
	market?: Database.Database
) {
	const p = app.prepare('select * from portfolios where id = ?').get(id) as PortfolioRow | undefined;
	if (!p) throw bad({ id: 'Портфеля нет' });
	if (input.name !== undefined) {
		const name = String(input.name).trim();
		if (!name) throw bad({ name: 'Название портфеля' });
		if (app.prepare('select 1 from portfolios where name = ? and id <> ?').get(name, id)) throw bad({ name: 'Такое название уже есть' });
		if (name.length > 60) throw bad({ name: 'До 60 знаков' });
		app.prepare('update portfolios set name = ? where id = ?').run(name, id);
	}
	if (input.currency !== undefined && input.currency !== p.currency) setCurrency(app, market, p, input.currency);
	if (input.archived !== undefined)
		app.prepare('update portfolios set archived_at = ? where id = ?').run(input.archived ? new Date().toISOString() : null, id);
	if (input.autoAmountIls !== undefined) {
		const a = num(input.autoAmountIls);
		if (a === null || !(a > 0)) throw bad({ autoAmountIls: 'Сумма больше нуля' });
		app.prepare('update portfolios set auto_amount_ils = ? where id = ?').run(a, id);
	}
	if (input.taxAccrued !== undefined) {
		const t = num(input.taxAccrued);
		if (t !== null && !(t >= 0)) throw bad({ taxAccrued: 'Налог не меньше нуля или пусто' });
		app.prepare('update portfolios set tax_accrued = ? where id = ?').run(t, id);
	}
	return app.prepare('select * from portfolios where id = ?').get(id) as PortfolioRow;
}

/**
 * The portfolio's currency changed (owner's request, 18.11.2026): a shekel portfolio holds TASE and dollar
 * securities, a dollar one — dollar ones only. Every event keeps its own currency; its rate to the portfolio's
 * currency is taken again for its date, so values and returns are counted in the new currency from the start.
 */
function setCurrency(app: Database.Database, market: Database.Database | undefined, p: PortfolioRow, currency: unknown) {
	if (!CURRENCIES.includes(currency as never)) throw bad({ currency: 'Валюта портфеля — доллары или шекели' });
	if (!market) throw bad({ currency: 'Валюту сейчас не сменить' });
	if (p.auto_source_id) throw bad({ currency: 'У автоматического портфеля валюта задана источником' });
	const pc = currency as string;
	if (pc === 'USD') {
		const ils = app.prepare(`select distinct symbol from positions where portfolio_id = ? and currency <> 'USD'`).all(p.id) as { symbol: string }[];
		if (ils.length) throw bad({ currency: `В долларовом портфеле — только бумаги в долларах; здесь есть шекелевые: ${ils.map((x) => x.symbol).join(', ')}` });
	}
	const m = marketView(market);
	app.transaction(() => {
		app.prepare('update portfolios set currency = ? where id = ?').run(pc, p.id);
		const evs = app
			.prepare(`select e.id, e.date, e.currency from position_events e join positions s on s.id = e.position_id where s.portfolio_id = ?`)
			.all(p.id) as { id: number; date: string; currency: string }[];
		const upE = app.prepare('update position_events set fx_rate = ? where id = ?');
		for (const e of evs) upE.run(m.conv(e.currency, pc, e.date), e.id);
		const cs = app.prepare('select id, date, currency from cash_events where portfolio_id = ?').all(p.id) as { id: number; date: string; currency: string }[];
		const upC = app.prepare('update cash_events set fx_rate = ? where id = ?');
		for (const c of cs) upC.run(m.conv(c.currency, pc, c.date), c.id);
	})();
}

/** The whole history of a portfolio as the arithmetic wants it. */
export function book(app: Database.Database, m: ReturnType<typeof marketView>, portfolioId: number) {
	const p = app.prepare('select currency from portfolios where id = ?').get(portfolioId) as { currency: string };
	const rows = app.prepare('select * from positions where portfolio_id = ? order by id').all(portfolioId) as PositionRow[];
	const evs = new Map(rows.map((r) => [r.id, eventsOf(app, r.id)]));
	const cash = cashOf(app, portfolioId);
	const b: Book = {
		currency: p.currency,
		positions: rows.map((r) => ({
			id: r.id,
			securityId: r.security_id,
			f: unitFactor(r.price_unit),
			currency: r.currency,
			trades: trades(evs.get(r.id)!, m.splits(r.security_id), unitFactor(r.price_unit))
		})),
		cash: effective(cash).map((c) => ({
			id: c.id,
			date: c.date,
			kind: c.kind,
			amount: c.amount,
			currency: c.currency,
			toAmount: c.toAmount,
			toCurrency: c.toCurrency,
			at: c.createdAt
		}))
	};
	return { rows, evs, cash, book: b };
}

/** The portfolio's benchmark by its currency: S&P 500 for dollars, TA-125 for shekels (section 18). */
const BENCH: Record<string, { key: 'benchmark:SPX' | 'benchmark:TA125'; label: string }> = {
	USD: { key: 'benchmark:SPX', label: 'S&P 500' },
	ILS: { key: 'benchmark:TA125', label: 'ТА-125' }
};

function benchReturn(m: ReturnType<typeof marketView>, market: Database.Database, currency: string, from: string | null, to: string) {
	const b = BENCH[currency];
	const id = benchmarkId(market, b.key);
	const x = id && from ? m.price(id, from) : null;
	const y = id ? m.price(id, to) : null;
	return { key: b.key, label: b.label, returnPct: x && y ? (y / x - 1) * 100 : null };
}

/** Spec section 18 — the «Портфель» screen: money, value and return in the portfolio's currency, positions by stage. */
export function portfolioView(app: Database.Database, market: Database.Database, id: number, today = israelDate()) {
	const p = portfolioRow(app, id);
	if (!p) return null;
	const pc = p.currency;
	const m = marketView(market);
	const { rows, evs, book: b } = book(app, m, id);
	const t = twr(b, m, today);
	const flow = cashFlow(b, m);
	// money as the broker shows it, by currency; its worth in the portfolio's currency at today's rate
	const balances = Object.entries(flow.raw)
		.filter(([, x]) => Math.abs(x) > 0.005)
		.map(([currency, amount]) => ({ currency, amount, valuePc: amount * m.conv(currency, pc, today) }));
	const cash = balances.reduce((n, x) => n + x.valuePc, 0);

	const positions = rows.map((r) => {
		const f = unitFactor(r.price_unit);
		const list = evs.get(r.id)!;
		const tr = trades(list, m.splits(r.security_id), f);
		const fi = fifo(tr, f);
		// no price in the base yet (a security added by hand): the price of its last trade or transfer stands in
		const market_ = m.last(r.security_id);
		const lv = m.live(r.security_id);
		const lastTrade = tr.at(-1);
		const last = lv
			? { date: lv.date, close: lv.price, providerCode: 'live' }
			: (market_ ?? (lastTrade ? { date: lastTrade.date, close: lastTrade.price, providerCode: 'event' } : null));
		const h = holding(fi, f, last?.close ?? null, m.conv(r.currency, pc, today));
		const live = effective(list);
		const plan = [...live].reverse().find((e) => e.kind === 'plan_buy' || e.kind === 'plan_sell' || e.kind === 'watch');
		const hyps = [...new Set(list.map((e) => e.hypothesisId).filter((x): x is number => !!x))];
		// T-019: today's move — the price's and, for a security in another currency, the rate's too
		const mv = h.qty > EPS ? m.dayMove(r.security_id) : null;
		const fxm = mv && r.currency !== pc ? m.fxMove(mv.date, mv.live) : null;
		const conv = (x: number, fx: number) => (r.currency === pc ? x : pc === 'ILS' ? x * fx : x / fx);
		const dayPc = mv ? h.qty * f * (conv(mv.now, fxm?.now ?? 1) - conv(mv.prev, fxm?.prev ?? 1)) : null;
		const dayBase = mv ? h.qty * f * conv(mv.prev, fxm?.prev ?? 1) : null;
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
			manualPrice: last?.providerCode === 'manual',
			/** a live quote of today (not a daily close) and its time */
			livePrice: !!lv,
			priceTime: lv?.time ?? null,
			lastClose: market_?.date ?? null,
			/** the price is the last trade's: the base has none for this security yet */
			eventPrice: last?.providerCode === 'event',
			value: h.value,
			valuePc: h.valuePc,
			unrealized: h.unrealized,
			unrealizedPct: fi.cost > EPS ? (h.unrealized / fi.cost) * 100 : null,
			unrealizedPc: h.unrealizedPc,
			/** the profit counts from the transfer day: no purchase price yet */
			fromTransfer: fi.fromTransfer,
			fromPrice: h.fromPrice,
			fromFx: h.fromFx,
			realized: fi.realized,
			realizedPc: fi.realizedPc,
			plan: plan ? { kind: plan.kind, date: plan.date, price: plan.price, amount: plan.amount, note: plan.note } : null,
			hypotheses: hyps,
			lastEventAt: live.at(-1)?.date ?? r.opened_at,
			weight: 0,
			profile: null as ProfileView | null,
			/** T-019: the day's change of the price, %, its money in the portfolio's currency (with the rate), its date */
			dayPct: mv ? (mv.now / mv.prev - 1) * 100 : null,
			dayPc,
			dayBase,
			dayDate: mv?.date ?? null
		};
	});
	const held = positions.reduce((n, x) => n + x.valuePc, 0);
	const value = cash + held;
	for (const x of positions) x.weight = value > EPS ? (x.valuePc / value) * 100 : 0;
	// what each security is — sector, industry, country, size, a fund's sector weights (the allocation block)
	const profiles = readProfiles(market, [...new Set(positions.map((x) => x.securityId))], m.usd(today));
	for (const x of positions) x.profile = profiles.get(x.securityId) ?? null;

	// the last buy or sell fee in this portfolio, per currency — the form starts from it
	const lastFee: Record<string, number> = {};
	for (const r of rows)
		for (const e of effective(evs.get(r.id)!))
			if ((e.kind === 'buy' || e.kind === 'sell') && e.fee !== null) lastFee[r.currency] = e.fee;

	return {
		portfolio: p,
		summary: {
			currency: pc,
			value,
			cash,
			balances,
			held,
			invested: t.invested,
			twrPct: t.twr === null ? null : t.twr * 100,
			from: t.from,
			realizedPc: positions.reduce((n, x) => n + x.realizedPc, 0),
			unrealizedPc: positions.reduce((n, x) => n + x.unrealizedPc, 0),
			fromTransfer: positions.some((x) => x.fromTransfer && x.qty > EPS),
			fxUsd: r4(m.usd(today)),
			day: dayOfPortfolio(positions, balances, pc, m),
			pricesAsOf: positions.map((x) => x.lastClose).filter(Boolean).sort().at(-1) ?? null,
			/** the newest live quote among the positions, and the live dollar's time */
			quotesAt: positions.filter((x) => x.qty > EPS).map((x) => x.priceTime).filter(Boolean).sort().at(-1) ?? null,
			fxAt: m.liveFxTime,
			/** when the app last fetched quotes — the colour of the refresh button */
			fetchedAt: m.fetchedAt,
			taxAccrued: p.tax_accrued,
			benchmark: benchReturn(m, market, pc, t.from, today)
		},
		positions,
		series: t.series,
		lastFee
	};
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/**
 * Section 18 «Всё вместе»: every real portfolio in one currency at today's Bank of Israel rate, and for a dollar
 * portfolio — what its value is in shekels against the rate of its own conversions. Only shows; changes nothing.
 */
export function together(app: Database.Database, market: Database.Database, currency: 'USD' | 'ILS' = 'ILS', today = israelDate()) {
	const m = marketView(market);
	const items = listPortfolios(app)
		.filter((p) => p.kind === 'real')
		.map((p) => {
			const v = portfolioView(app, market, p.id, today)!;
			const rate = m.conv(p.currency, currency, today);
			let conversions: { ils: number; usd: number; rate: number; valueIlsNow: number; changeIls: number } | null = null;
			if (p.currency === 'USD') {
				const conv = effective(cashOf(app, p.id)).filter((c) => c.kind === 'convert' && c.currency === 'ILS' && c.toCurrency === 'USD' && c.toAmount);
				const ils = conv.reduce((n, c) => n + c.amount, 0);
				const usd = conv.reduce((n, c) => n + (c.toAmount ?? 0), 0);
				if (usd > 0) {
					const valueIlsNow = v.summary.value * m.usd(today);
					// at the conversions' own average rate the same dollars would be worth:
					const atOwn = v.summary.value * (ils / usd);
					conversions = { ils, usd, rate: ils / usd, valueIlsNow, changeIls: valueIlsNow - atOwn };
				}
			}
			return { id: p.id, name: p.name, currency: p.currency, value: v.summary.value, inTotal: v.summary.value * rate, conversions };
		});
	return { currency, rate: r4(m.usd(today)), date: today, total: items.reduce((n, x) => n + x.inTotal, 0), items };
}

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
	const hasOpening = effective(list).some((e) => e.kind === 'opening');
	return {
		position: pos,
		portfolio: view.portfolio,
		events,
		cash,
		hypotheses: hyps,
		lastFee: view.lastFee,
		fxUsd: view.summary.fxUsd,
		hasOpening
	};
}

/** Keeps `stage` and `closed_at` of a position in step with its events. */
export function recomputeStage(app: Database.Database, market: Database.Database, positionId: number) {
	const r = positionRow(app, positionId)!;
	const list = eventsOf(app, positionId);
	const m = marketView(market);
	const f = unitFactor(r.price_unit);
	const qty = fifo(trades(list, m.splits(r.security_id), f), f).qty;
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
	/** opening / basis: the whole purchase cost in the portfolio's currency */
	costTotal?: unknown;
	/** opening: the average purchase price, in the price unit */
	basisPrice?: unknown;
	note?: unknown;
	hypothesisId?: unknown;
	/** the person looked again at a price far from the day's range */
	confirm?: unknown;
}

const KINDS = ['watch', 'plan_buy', 'buy', 'plan_sell', 'sell', 'drop', 'note', 'opening', 'basis'];

/** A dollar portfolio holds dollar securities only; a shekel one — TASE and dollar lines its broker shows in shekels. */
function fits(pc: string, s: SecRow) {
	return pc === 'ILS' || moneyOf(s.price_unit) === 'USD';
}

/**
 * A new event of a position (section 18). A first event for a security opens a position in the portfolio (or
 * continues the open one). Rules: the date is not later than today; one cannot sell more than there is; a price
 * further than 10% from the day's range asks for a confirmation. «Перенесено» (opening) brings shares bought before
 * the portfolio was kept, at the transfer day's price; their purchase price can come with it or later («basis»).
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
	const costTotal = num(input.costTotal);
	const basisPrice = num(input.basisPrice);
	const trade = kind === 'buy' || kind === 'sell' || kind === 'opening';
	if (trade) {
		if (qty === null || !(qty > 0)) errors.qty = 'Количество больше нуля';
		if (price === null || !(price > 0)) errors.price = 'Цена больше нуля';
		if (!(fee >= 0)) errors.fee = 'Комиссия не меньше нуля';
	} else if (price !== null && !(price > 0)) errors.price = 'Цена больше нуля или пусто';
	if (amount !== null && !(amount > 0)) errors.amount = 'Сумма больше нуля или пусто';
	if (costTotal !== null && !(costTotal > 0)) errors.costTotal = 'Стоимость покупки больше нуля или пусто';
	if (basisPrice !== null && !(basisPrice > 0)) errors.basisPrice = 'Средняя цена больше нуля или пусто';
	if (kind === 'basis' && price === null && costTotal === null) errors.price = 'Средняя цена покупки или вся стоимость покупки';
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
		const port = app.prepare('select currency from portfolios where id = ?').get(pid) as { currency: string } | undefined;
		if (!port) throw bad({ portfolioId: 'Портфеля нет' });
		const s = security(market, sid);
		if (!s) throw bad({ securityId: 'Такой бумаги нет в базе' });
		if (s.exchange_code === 'INDEX_US') throw bad({ securityId: 'Индекс нельзя купить — выберите акцию или ETF' });
		if (!fits(port.currency, s)) throw bad({ securityId: 'В долларовый портфель — только бумаги в долларах' });
		pos = app.prepare(`select * from positions where portfolio_id = ? and security_id = ? and stage <> 'closed' order by id desc limit 1`).get(pid, sid) as
			| PositionRow
			| undefined;
		if (!pos) {
			if (kind === 'sell' || kind === 'plan_sell' || kind === 'basis') throw bad({ kind: 'Этой бумаги в портфеле нет' });
			pos = app
				.prepare(
					`insert into positions (portfolio_id, security_id, symbol, security_name, exchange_code, currency, price_unit, stage, opened_at)
					 values (?, ?, ?, ?, ?, ?, ?, 'watch', ?) returning *`
				)
				.get(pid, sid, s.symbol, s.name_en, s.exchange_code, moneyOf(s.price_unit), s.price_unit, date) as PositionRow;
		}
	}
	const pc = (app.prepare('select currency from portfolios where id = ?').get(pos.portfolio_id) as { currency: string }).currency;
	const m = marketView(market);
	const f = unitFactor(pos.price_unit);
	const list = eventsOf(app, pos.id);
	const held = fifo(trades(list, m.splits(pos.security_id), f), f).qty;
	if ((kind === 'plan_sell' || kind === 'sell') && held <= EPS) throw bad({ kind: 'Продавать нечего: бумаги в позиции нет' });
	if (kind === 'basis' && !effective(list).some((e) => e.kind === 'opening')) throw bad({ kind: 'Цена покупки задаётся для перенесённой позиции' });

	// a price far from the day's range: a typo or agorot for shekels — ask before saving
	if (trade && !auto && !input.confirm) {
		const far = farPrice(m, pos, price!, date);
		if (far) throw new ConfirmError(far);
	}
	if (pos.currency !== pc && !fxOn(market, date) && !fxOn(market, '9999-12-31')) throw bad({ date: 'Курса доллара ещё нет — он загрузится утром' });
	const fxRate = m.conv(pos.currency, pc, date);

	const hypothesisId = input.hypothesisId ? Number(input.hypothesisId) : null;
	if (hypothesisId && !app.prepare('select 1 from hypotheses where id = ?').get(hypothesisId)) throw bad({ hypothesisId: 'Гипотезы нет' });

	const insert = app.prepare(
		`insert into position_events (position_id, kind, date, qty, price, currency, fee, fx_rate, amount, cost_total, note, hypothesis_id, auto)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`
	);
	return app.transaction(() => {
		const ev = insert.get(
			pos!.id,
			kind,
			date,
			trade ? qty : null,
			price,
			pos!.currency,
			trade ? fee : null,
			fxRate,
			amount,
			kind === 'basis' ? costTotal : null,
			note,
			hypothesisId,
			auto ? 1 : 0
		) as { id: number };
		// an opening with its purchase price: the price goes in as a «basis» event right after it
		if (kind === 'opening' && (costTotal !== null || basisPrice !== null))
			insert.run(pos!.id, 'basis', date, null, basisPrice, pos!.currency, null, fxRate, null, costTotal, null, null, 0);
		// no point in time may hold less than nothing
		try {
			fifo(trades(eventsOf(app, pos!.id), m.splits(pos!.security_id), f), f);
		} catch (e) {
			if (e instanceof OversellError) throw bad({ qty: e.message });
			throw e;
		}
		if (date < pos!.opened_at) app.prepare('update positions set opened_at = ? where id = ?').run(date, pos!.id);
		recomputeStage(app, market, pos!.id);
		// a buy without enough money only warns (section 18)
		let warning: string | null = null;
		if (kind === 'buy') {
			const v = portfolioView(app, market, pos!.portfolio_id, date);
			const bal = v?.summary.balances.find((x) => x.currency === pos!.currency)?.amount ?? 0;
			if (bal < -0.005) warning = `Остаток ${pos!.currency === 'USD' ? 'долларов' : 'шекелей'} ушёл в минус: ${fmt(bal)}. Если были взнос или конвертация — запишите их.`;
		}
		return { positionId: pos!.id, eventId: ev.id, warning };
	})();
}

const fmt = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** A price further than 10% from the day's range: a typo or agorot for shekels — the question to ask, or null. */
function farPrice(m: ReturnType<typeof marketView>, pos: PositionRow, price: number, date: string): string | null {
	const day = m.day(pos.security_id, date);
	if (!day) return null;
	const k = splitFactor(day.date, m.splits(pos.security_id)) / splitFactor(date, m.splits(pos.security_id));
	const lo = (day.low ?? day.close) * k;
	const hi = (day.high ?? day.close) * k;
	if (price >= lo * (1 - PRICE_SLACK) && price <= hi * (1 + PRICE_SLACK)) return null;
	const unit = pos.price_unit === 'ILA' ? 'агорот' : pos.currency === 'USD' ? '$' : '₪';
	const hint = pos.price_unit === 'ILA' && price * 100 >= lo * 0.9 && price * 100 <= hi * 1.1 ? ' Похоже, цена в шекелях — здесь нужны агороты.' : '';
	return `Цена ${price} ${unit} далеко от диапазона дня ${day.date}: ${fmt(lo)}–${fmt(hi)} ${unit}.${hint} Сохранить всё равно?`;
}

/**
 * «Изменить» (owner's request, 18.11.2026): an event's date and numbers are corrected in place — the kind, the
 * position and the currency stay. The database keeps what the event was before in event_edits. The same checks
 * as for a new event: the date is not later than today, no point in time holds less than nothing, a price far
 * from the day's range is asked about.
 */
export function editEvent(app: Database.Database, market: Database.Database, id: number, input: EventInput, now = new Date()) {
	const e = app.prepare(`select ${EVENT_COLS} from position_events where id = ?`).get(id) as EventRow | undefined;
	if (!e) throw bad({ id: 'События нет' });
	if (e.cancelledAt || e.kind === 'reverse') throw new LockedError('Это событие уже не учитывается — его не изменить');
	if (app.prepare(`select 1 from position_events where reverses_event_id = ? and cancelled_at is null`).get(id))
		throw new LockedError('Событие сторнировано — его не изменить');
	const pos = positionRow(app, e.positionId)!;
	const port = app.prepare('select currency, auto_source_id from portfolios where id = ?').get(pos.portfolio_id) as { currency: string; auto_source_id: number | null };
	if (port.auto_source_id) throw new LockedError('События автоматического портфеля записывает приложение');
	const today = israelDate(now);
	const errors: Record<string, string> = {};
	const has = (k: keyof EventInput) => input[k] !== undefined;
	const date = has('date') ? (input.date as string) : e.date;
	if (!isDate(date)) errors.date = 'Дата в виде ГГГГ-ММ-ДД';
	else if (date > today) errors.date = 'Дата не позже сегодняшней';
	const trade = e.kind === 'buy' || e.kind === 'sell' || e.kind === 'opening';
	const qty = has('qty') ? num(input.qty) : e.qty;
	const price = has('price') ? num(input.price) : e.price;
	const fee = has('fee') ? (num(input.fee) ?? 0) : e.fee;
	const amount = has('amount') ? num(input.amount) : e.amount;
	const costTotal = has('costTotal') ? num(input.costTotal) : (e.costTotal ?? null);
	const note = has('note') ? (typeof input.note === 'string' ? input.note.trim().slice(0, 2000) || null : null) : e.note;
	if (trade) {
		if (qty === null || !(qty > 0)) errors.qty = 'Количество больше нуля';
		if (price === null || !(price > 0)) errors.price = 'Цена больше нуля';
		if (!((fee ?? 0) >= 0)) errors.fee = 'Комиссия не меньше нуля';
	} else if (price !== null && !(price > 0)) errors.price = 'Цена больше нуля или пусто';
	if (amount !== null && !(amount > 0)) errors.amount = 'Сумма больше нуля или пусто';
	if (costTotal !== null && !(costTotal > 0)) errors.costTotal = 'Стоимость покупки больше нуля или пусто';
	if (e.kind === 'basis' && price === null && costTotal === null) errors.price = 'Средняя цена покупки или вся стоимость покупки';
	if (e.kind === 'note' && !note) errors.note = 'Текст заметки';
	if (Object.keys(errors).length) throw bad(errors);
	const m = marketView(market);
	if (trade && !input.confirm && (price !== e.price || date !== e.date)) {
		const far = farPrice(m, pos, price!, date);
		if (far) throw new ConfirmError(far);
	}
	if (pos.currency !== port.currency && date !== e.date && !fxOn(market, date) && !fxOn(market, '9999-12-31'))
		throw bad({ date: 'Курса доллара ещё нет — он загрузится утром' });
	const fxRate = date === e.date ? e.fxRate : m.conv(pos.currency, port.currency, date);
	const f = unitFactor(pos.price_unit);
	return app.transaction(() => {
		app.prepare(`update position_events set date = ?, qty = ?, price = ?, fee = ?, fx_rate = ?, amount = ?, cost_total = ?, note = ? where id = ?`).run(
			date,
			trade ? qty : e.qty,
			price,
			trade ? fee : e.fee,
			fxRate,
			amount,
			costTotal,
			note,
			id
		);
		// a «Перенесено» and its purchase price entered with it move together
		if (e.kind === 'opening' && date !== e.date)
			app.prepare(`update position_events set date = ?, fx_rate = ? where position_id = ? and kind = 'basis' and date = ? and cancelled_at is null`).run(
				date,
				fxRate,
				pos.id,
				e.date
			);
		try {
			fifo(trades(eventsOf(app, pos.id), m.splits(pos.security_id), f), f);
		} catch (err) {
			if (err instanceof OversellError) throw bad({ qty: `После изменения продажа больше, чем было: ${err.message}` });
			throw err;
		}
		const first = (app.prepare(`select min(date) as d from position_events where position_id = ? and cancelled_at is null`).get(pos.id) as { d: string | null }).d;
		if (first) app.prepare('update positions set opened_at = ? where id = ?').run(first, pos.id);
		recomputeStage(app, market, pos.id);
		return { positionId: pos.id };
	})();
}

/** «Изменить» a money record: its date and sums; the kind and the currencies stay. */
export function editCash(app: Database.Database, market: Database.Database, id: number, input: { date?: unknown; amount?: unknown; toAmount?: unknown; note?: unknown }, now = new Date()) {
	const c = app.prepare(`select ${CASH_COLS} from cash_events where id = ?`).get(id) as CashRow | undefined;
	if (!c) throw bad({ id: 'Записи нет' });
	if (c.cancelledAt || c.kind === 'reverse') throw new LockedError('Эта запись уже не учитывается — её не изменить');
	if (app.prepare(`select 1 from cash_events where reverses_event_id = ? and cancelled_at is null`).get(id)) throw new LockedError('Запись сторнирована — её не изменить');
	const port = app.prepare('select currency, auto_source_id from portfolios where id = ?').get(c.portfolioId) as { currency: string; auto_source_id: number | null };
	if (port.auto_source_id) throw new LockedError('Деньги автоматического портфеля записывает приложение');
	const errors: Record<string, string> = {};
	const date = input.date !== undefined ? (input.date as string) : c.date;
	if (!isDate(date)) errors.date = 'Дата в виде ГГГГ-ММ-ДД';
	else if (date > israelDate(now)) errors.date = 'Дата не позже сегодняшней';
	const amount = input.amount !== undefined ? num(input.amount) : c.amount;
	if (amount === null || !(amount > 0)) errors.amount = 'Сумма больше нуля';
	const toAmount = c.kind === 'convert' && input.toAmount !== undefined ? num(input.toAmount) : c.toAmount;
	if (c.kind === 'convert' && (toAmount === null || !(toAmount > 0))) errors.toAmount = 'Полученная сумма больше нуля';
	const note = input.note !== undefined ? (typeof input.note === 'string' ? input.note.trim().slice(0, 500) || null : null) : c.note;
	if (Object.keys(errors).length) throw bad(errors);
	const fxRate = date === c.date ? c.fxRate : marketView(market).conv(c.currency, port.currency, date);
	app.prepare('update cash_events set date = ?, amount = ?, to_amount = ?, fx_rate = ?, note = ? where id = ?').run(date, amount, toAmount, fxRate, note, id);
	return c.portfolioId;
}

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
	const f = unitFactor(r.price_unit);
	try {
		fifo(trades(eventsOf(app, positionId), marketView(market).splits(r.security_id), f), f);
	} catch (e) {
		if (e instanceof OversellError) throw bad({ id: `Без этой покупки продажа больше, чем было: ${e.message}. Сначала сторнируйте продажу.` });
		throw e;
	}
}

// ── money ─────────────────────────────────────────────────────────────────────────────────────────────

const CASH_KINDS = ['deposit', 'withdraw', 'convert', 'dividend', 'fee', 'tax'];

/**
 * Money of a portfolio: deposits and withdrawals, a conversion (the sum given and the sum received — the deal's
 * rate comes from the two, bank fee included, and is fixed once), dividends, fees, taxes.
 */
export function addCash(
	app: Database.Database,
	market: Database.Database,
	portfolioId: number,
	input: { kind?: unknown; date?: unknown; amount?: unknown; currency?: unknown; toAmount?: unknown; toCurrency?: unknown; note?: unknown; positionId?: unknown },
	now = new Date(),
	auto = false
) {
	const today = israelDate(now);
	const errors: Record<string, string> = {};
	const kind = String(input.kind ?? '');
	if (!CASH_KINDS.includes(kind)) errors.kind = 'Неизвестный вид';
	const date = (input.date === undefined || input.date === '' ? today : input.date) as string;
	if (!isDate(date)) errors.date = 'Дата в виде ГГГГ-ММ-ДД';
	else if (date > today) errors.date = 'Дата не позже сегодняшней';
	const amount = num(input.amount);
	if (amount === null || !(amount > 0)) errors.amount = 'Сумма больше нуля';
	const currency = input.currency === 'USD' ? 'USD' : 'ILS';
	let toAmount: number | null = null;
	let toCurrency: string | null = null;
	if (kind === 'convert') {
		toAmount = num(input.toAmount);
		toCurrency = input.toCurrency === 'USD' ? 'USD' : input.toCurrency === 'ILS' ? 'ILS' : null;
		if (toAmount === null || !(toAmount > 0)) errors.toAmount = 'Полученная сумма больше нуля';
		if (!toCurrency || toCurrency === currency) errors.toCurrency = 'Конвертация — из одной валюты в другую';
	}
	const port = app.prepare('select currency from portfolios where id = ?').get(portfolioId) as { currency: string } | undefined;
	if (!port) errors.portfolioId = 'Портфеля нет';
	const positionId = input.positionId ? Number(input.positionId) : null;
	if (positionId && positionRow(app, positionId)?.portfolio_id !== portfolioId) errors.positionId = 'Позиция из другого портфеля';
	if (Object.keys(errors).length) throw bad(errors);
	const fxRate = marketView(market).conv(currency, port!.currency, date);
	return app
		.prepare(
			`insert into cash_events (portfolio_id, kind, date, amount, currency, to_amount, to_currency, fx_rate, note, position_id, auto)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`
		)
		.get(
			portfolioId,
			kind,
			date,
			amount,
			currency,
			toAmount,
			toCurrency,
			fxRate,
			typeof input.note === 'string' ? input.note.trim().slice(0, 500) || null : null,
			positionId,
			auto ? 1 : 0
		) as { id: number };
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

// ── automatic portfolios of a source ──────────────────────────────────────────────────────────────────

const autoName = (source: string, currency: string) => `Авто · ${source} ${currency === 'USD' ? '$' : '₪'}`;

/** The source's automatic portfolio in a currency: found, or made when the source's portfolios are switched on. */
function autoPortfolio(app: Database.Database, sourceId: number, currency: string, make: boolean) {
	const p = app.prepare('select * from portfolios where auto_source_id = ? and currency = ?').get(sourceId, currency) as PortfolioRow | undefined;
	if (p || !make) return p;
	const src = app.prepare('select name from sources where id = ?').get(sourceId) as { name: string };
	let name = autoName(src.name, currency);
	if (app.prepare('select 1 from portfolios where name = ?').get(name)) name = `${name} (${sourceId})`;
	return app
		.prepare(`insert into portfolios (name, kind, currency, auto_source_id, auto_amount_ils) values (?, 'virtual', ?, ?, ?) returning *`)
		.get(name, currency, sourceId, AUTO_AMOUNT[currency]) as PortfolioRow;
}

/**
 * Section 18 «Виртуальный портфель источника»: each hypothesis of the source of types recommendation, target or
 * opinion, on the rise, is bought for a fixed sum (3 000 $ or 10 000 ₪ — a source with securities of both markets
 * has two portfolios) at its entry price and sold when it closes, at its exit price; dividends while it is held
 * come as money. A «down» hypothesis does not go in. Idempotent: run as often as wanted.
 */
export function syncAuto(app: Database.Database, market: Database.Database, now = new Date()) {
	const today = israelDate(now);
	// sources switched on: having a portfolio not archived
	const on = (app.prepare(`select distinct auto_source_id as id from portfolios where auto_source_id is not null and archived_at is null`).all() as { id: number }[]).map(
		(r) => r.id
	);
	const m = marketView(market);
	const s = { bought: 0, sold: 0, dividends: 0, reversed: 0 };
	for (const sourceId of on) {
		const hyps = app
			.prepare(
				`select h.* from hypotheses h join articles a on a.id = h.article_id
				  where a.source_id = ? and h.direction = 'long' and h.signal_type in (${RATED_TYPES.map(() => '?').join(',')})
				  order by h.id`
			)
			.all(sourceId, ...RATED_TYPES) as Record<string, unknown>[];
		for (const h of hyps) {
			const hid = h.id as number;
			const cur = moneyOf(h.price_unit as string);
			const existing = autoPortfolio(app, sourceId, cur, false);
			// a portfolio of this currency switched off on purpose stays off
			if (existing?.archived_at) continue;
			const buys = app
				.prepare(
					`select e.id, e.position_id as positionId from position_events e join positions p on p.id = e.position_id
					  join portfolios f on f.id = p.portfolio_id
					  where f.auto_source_id = ? and e.hypothesis_id = ? and e.kind = 'buy' and e.auto = 1 and e.cancelled_at is null`
				)
				.all(sourceId, hid) as { id: number; positionId: number }[];
			const live = buys.filter((b) => !app.prepare(`select 1 from position_events where reverses_event_id = ? and cancelled_at is null`).get(b.id));
			if (h.status === 'cancelled') {
				for (const b of live)
					for (const e of app
						.prepare(`select id from position_events where position_id = ? and kind <> 'reverse' and cancelled_at is null order by date desc, id desc`)
						.all(b.positionId) as { id: number }[])
						if (!app.prepare(`select 1 from position_events where reverses_event_id = ? and cancelled_at is null`).get(e.id)) {
							reverseEvent(app, market, e.id, 'гипотеза отменена', now);
							s.reversed++;
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
				const port = autoPortfolio(app, sourceId, cur, true)!;
				const f = unitFactor(sec.price_unit);
				const qty = port.auto_amount_ils / (entry * f);
				positionId = app
					.prepare(
						`insert into positions (portfolio_id, security_id, symbol, security_name, exchange_code, currency, price_unit, stage, opened_at)
						 values (?, ?, ?, ?, ?, ?, ?, 'watch', ?) returning id`
					)
					.pluck()
					.get(port.id, sec.id, sec.symbol, sec.name_en, sec.exchange_code, cur, sec.price_unit, entryDate) as number;
				app.prepare(
					`insert into position_events (position_id, kind, date, qty, price, currency, fee, fx_rate, note, hypothesis_id, auto)
					 values (?, 'buy', ?, ?, ?, ?, 0, 1, ?, ?, 1)`
				).run(positionId, entryDate, qty, entry, cur, `гипотеза №${hid}`, hid);
				s.bought++;
			}
			const pos = positionRow(app, positionId)!;
			const f = unitFactor(pos.price_unit);
			const list = eventsOf(app, positionId);
			const fi = fifo(trades(list, m.splits(pos.security_id), f), f);
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
				addCash(app, market, pos.portfolio_id, { kind: 'dividend', date: d.date, amount: qtyNow * d.amount * f, currency: pos.currency, note: `${pos.symbol}, авто`, positionId }, now, true);
				s.dividends++;
			}
			if (closed && fi.qty > EPS) {
				const k = splitFactor(exitDate, m.splits(pos.security_id));
				app.prepare(
					`insert into position_events (position_id, kind, date, qty, price, currency, fee, fx_rate, note, hypothesis_id, auto)
					 values (?, 'sell', ?, ?, ?, ?, 0, 1, ?, ?, 1)`
				).run(positionId, exitDate, fi.qty / k, h.exit_price, pos.currency, `гипотеза №${hid} закрыта`, hid);
				s.sold++;
			}
			recomputeStage(app, market, positionId);
		}
	}
	return s;
}

/**
 * Switches the automatic portfolios of a source on (made for the currencies its hypotheses need — or its market's —
 * brought back if archived, filled at once) or off (archived, history kept).
 */
export function setAuto(app: Database.Database, market: Database.Database, sourceId: number, on: boolean, now = new Date()) {
	const src = app.prepare('select id, name, market from sources where id = ?').get(sourceId) as { id: number; name: string; market: string } | undefined;
	if (!src) throw bad({ sourceId: 'Источника нет' });
	if (!on) {
		app.prepare('update portfolios set archived_at = ? where auto_source_id = ? and archived_at is null').run(new Date().toISOString(), sourceId);
		return [];
	}
	app.prepare('update portfolios set archived_at = null where auto_source_id = ?').run(sourceId);
	const used = (
		app
			.prepare(
				`select distinct h.price_unit as u from hypotheses h join articles a on a.id = h.article_id
				  where a.source_id = ? and h.direction = 'long' and h.status <> 'cancelled'`
			)
			.all(sourceId) as { u: string }[]
	).map((r) => moneyOf(r.u));
	const want = new Set(used.length ? used : src.market === 'US' ? ['USD'] : src.market === 'IL' ? ['ILS'] : ['USD', 'ILS']);
	app.transaction(() => {
		for (const c of want) autoPortfolio(app, sourceId, c, true);
		syncAuto(app, market, now);
	})();
	return app.prepare('select * from portfolios where auto_source_id = ? order by currency desc').all(sourceId) as PortfolioRow[];
}

// ── deleting a portfolio whole ────────────────────────────────────────────────────────────────────────

/**
 * Deletes a portfolio with all its positions, events and money — at the owner's request, for portfolios made by
 * mistake. The name must be typed back; a copy of the journal is made first (`backup` — VACUUM INTO). Events
 * still cannot be deleted one by one: the database lets them go only together with their portfolio.
 */
/**
 * A position deleted whole (owner's request, 18.11.2026: a share entered by mistake): its events, its money
 * records (dividends of this share) and its corrections — after a copy of the journal. The guard of single
 * deletes is passed the same way as for a whole portfolio: its id sits in portfolio_purge for the transaction.
 */
export function deletePosition(app: Database.Database, market: Database.Database, id: number, backup?: (tag: string) => string) {
	const pos = positionRow(app, id);
	if (!pos) throw bad({ id: 'Позиции нет' });
	const port = app.prepare('select auto_source_id from portfolios where id = ?').get(pos.portfolio_id) as { auto_source_id: number | null };
	if (port.auto_source_id) throw new LockedError('Позиции автоматического портфеля ведёт приложение');
	const file = backup?.(`before-delete-position-${id}`) ?? null;
	const counts = app.transaction(() => {
		app.prepare('insert or replace into portfolio_purge (portfolio_id) values (?)').run(pos.portfolio_id);
		app.prepare(
			`delete from event_edits where (event_table = 'position_events' and event_id in (select id from position_events where position_id = ?))
			   or (event_table = 'cash_events' and event_id in (select id from cash_events where position_id = ?))`
		).run(id, id);
		const events = app.prepare('delete from position_events where position_id = ?').run(id).changes;
		const cash = app.prepare('delete from cash_events where position_id = ?').run(id).changes;
		app.prepare('delete from positions where id = ?').run(id);
		app.prepare('delete from portfolio_purge where portfolio_id = ?').run(pos.portfolio_id);
		return { events, cash };
	})();
	return { symbol: pos.symbol, portfolioId: pos.portfolio_id, ...counts, backup: file };
}

export function deletePortfolio(app: Database.Database, id: number, confirmName: unknown, backup?: (tag: string) => string) {
	const p = app.prepare('select id, name from portfolios where id = ?').get(id) as { id: number; name: string } | undefined;
	if (!p) throw bad({ id: 'Портфеля нет' });
	if (String(confirmName ?? '').trim() !== p.name) throw bad({ confirmName: `Наберите название портфеля «${p.name}»` });
	const file = backup?.(`before-delete-portfolio-${id}`) ?? null;
	const counts = app.transaction(() => {
		app.prepare('insert or replace into portfolio_purge (portfolio_id) values (?)').run(id);
		app.prepare(
			`delete from event_edits where (event_table = 'cash_events' and event_id in (select id from cash_events where portfolio_id = ?))
			   or (event_table = 'position_events' and event_id in (select e.id from position_events e join positions s on s.id = e.position_id where s.portfolio_id = ?))`
		).run(id, id);
		const ev = app.prepare('delete from position_events where position_id in (select id from positions where portfolio_id = ?)').run(id).changes;
		const cash = app.prepare('delete from cash_events where portfolio_id = ?').run(id).changes;
		const pos = app.prepare('delete from positions where portfolio_id = ?').run(id).changes;
		app.prepare('delete from portfolios where id = ?').run(id);
		app.prepare('delete from portfolio_purge where portfolio_id = ?').run(id);
		return { positions: pos, events: ev, cash };
	})();
	return { name: p.name, ...counts, backup: file };
}

// ── export ────────────────────────────────────────────────────────────────────────────────────────────

const r2 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

/**
 * Export of a portfolio as JSON (owner's request, 18.11.2026): everything an AI adviser needs, to be copied and
 * pasted — the totals, every position with its numbers and its history, the money, the linked hypotheses.
 * Cancelled and reversed records are left out: only what counts. Built on request, never stored.
 */
export function exportPortfolio(app: Database.Database, market: Database.Database, id: number, today = israelDate()) {
	const v = portfolioView(app, market, id, today);
	if (!v) return null;
	const pc = v.summary.currency;
	const counted = <T extends { id: number; kind: string; cancelledAt: string | null }>(list: T[], reversed: Set<number>) =>
		list.filter((e) => !e.cancelledAt && e.kind !== 'reverse' && !reversed.has(e.id));
	const hyp = app.prepare(
		`select id, symbol, direction, signal_type as signalType, thesis, invalidation, entry_date as entryDate, entry_price as entryPrice,
		        horizon_date as horizonDate, status, return_pct as returnPct from hypotheses where id = ?`
	);
	const positions = v.positions.map((p) => {
		const list = eventsOf(app, p.id);
		const reversed = new Set(list.filter((e) => e.kind === 'reverse' && !e.cancelledAt).map((e) => e.reversesEventId!));
		const unit = p.priceUnit === 'ILA' ? 'ILA (agorot, 1/100 ILS)' : p.currency;
		return {
			symbol: p.symbol,
			name: p.name,
			exchange: p.exchange,
			currency: p.currency,
			priceUnit: unit,
			stage: p.stage,
			openedAt: p.openedAt,
			closedAt: p.closedAt,
			quantity: p.qty,
			avgBuyPrice: r2(p.avgPrice),
			lastPrice: p.lastPrice,
			lastPriceDate: p.lastDate,
			[`value_${pc}`]: r2(p.valuePc),
			[`invested_${pc}`]: r2(p.valuePc - p.unrealizedPc),
			unrealizedPct: r2(p.unrealizedPct),
			[`unrealized_${pc}`]: r2(p.unrealizedPc),
			[`realized_${pc}`]: r2(p.realizedPc),
			weightPct: r2(p.weight),
			profitCountsFromTransferDate: p.fromTransfer || undefined,
			plan: p.plan ?? undefined,
			events: counted(list, reversed).map((e) => ({
				date: e.date,
				kind: e.kind,
				quantity: e.qty ?? undefined,
				price: e.price ?? undefined,
				fee: e.fee || undefined,
				amount: e.amount ?? undefined,
				[`purchaseCost_${pc}`]: e.costTotal ?? undefined,
				note: e.note ?? undefined
			})),
			hypotheses: p.hypotheses.length ? p.hypotheses.map((h) => hyp.get(h)) : undefined
		};
	});
	const cashList = cashOf(app, id);
	const cashReversed = new Set(cashList.filter((c) => c.kind === 'reverse' && !c.cancelledAt).map((c) => c.reversesEventId!));
	return {
		exportedAt: new Date().toISOString(),
		asOf: today,
		about:
			'Investment portfolio exported from the owner\'s journal app. Amounts with a currency suffix (_USD/_ILS) are in that currency; ' +
			'prices are in the security\'s price unit (TASE shares in agorot). timeWeightedReturnPct is the time-weighted return since returnSince; ' +
			'events are the position history (watch, plan_buy, buy, plan_sell, sell, drop, note, opening = shares transferred in, basis = purchase price of transferred shares).',
		portfolio: { name: v.portfolio.name, kind: v.portfolio.kind, currency: pc, automaticFromSource: v.portfolio.sourceName ?? undefined },
		summary: {
			[`value_${pc}`]: r2(v.summary.value),
			[`inSecurities_${pc}`]: r2(v.summary.held),
			[`cash_${pc}`]: r2(v.summary.cash),
			cashByCurrency: v.summary.balances.map((b) => ({ currency: b.currency, amount: r2(b.amount) })),
			timeWeightedReturnPct: r2(v.summary.twrPct),
			returnSince: v.summary.from,
			benchmark: { name: v.summary.benchmark.label, returnPctSamePeriod: r2(v.summary.benchmark.returnPct) },
			[`realized_${pc}`]: r2(v.summary.realizedPc),
			[`unrealized_${pc}`]: r2(v.summary.unrealizedPc),
			usdIls: v.summary.fxUsd,
			pricesAsOf: v.summary.pricesAsOf,
			[`taxAccrued_${pc}`]: v.summary.taxAccrued ?? undefined
		},
		positions,
		cash: counted(cashList, cashReversed).map((c) => ({
			date: c.date,
			kind: c.kind,
			amount: c.amount,
			currency: c.currency,
			toAmount: c.toAmount ?? undefined,
			toCurrency: c.toCurrency ?? undefined,
			security: c.positionId ? v.positions.find((p) => p.id === c.positionId)?.symbol : undefined,
			note: c.note ?? undefined
		}))
	};
}
