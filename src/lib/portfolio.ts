/**
 * Spec section 18 — portfolio arithmetic, pure: the screens, the server and the tests use the same code.
 *
 * A portfolio is a history of events. Positions, the average price and the return are computed from it:
 * - realized profit by FIFO (fees: a buy's fee goes into the lot's cost, a sell's fee comes off the proceeds);
 * - unrealized — by the last price;
 * - the portfolio's return is time-weighted (TWR), so that deposits and withdrawals do not distort it;
 * - positions are in the security's currency, totals in shekels at the rate of the date; for a US security the
 *   shekel profit splits into what the security's price gave and what the dollar rate gave.
 * Prices are in the position's price unit (agorot for TASE — `unitFactor` 0.01 turns them into shekels).
 */

export type Stage = 'watch' | 'plan_buy' | 'holding' | 'plan_sell' | 'closed';
export const STAGES: Stage[] = ['holding', 'plan_sell', 'plan_buy', 'watch', 'closed'];
export const STAGE_LABEL: Record<Stage, string> = {
	holding: 'В портфеле',
	plan_sell: 'Хочу продать',
	plan_buy: 'Хочу купить',
	watch: 'Наблюдаю',
	closed: 'Закрытые'
};
export const EVENT_LABEL: Record<string, string> = {
	watch: 'Наблюдаю',
	plan_buy: 'Хочу купить',
	buy: 'Купил',
	plan_sell: 'Хочу продать',
	sell: 'Продал',
	drop: 'Передумал',
	note: 'Заметка',
	opening: 'Перенесено',
	basis: 'Цена покупки',
	reverse: 'Сторно'
};
export const CASH_LABEL: Record<string, string> = {
	deposit: 'Взнос',
	withdraw: 'Вывод',
	convert: 'Конвертация',
	dividend: 'Дивиденд',
	fee: 'Комиссия',
	tax: 'Налог',
	reverse: 'Сторно'
};

export const unitFactor = (priceUnit: string) => (priceUnit === 'ILA' ? 0.01 : 1);
const EPS = 1e-9;

export interface Ev {
	id: number;
	kind: string;
	date: string;
	qty: number | null;
	price: number | null;
	fee: number | null;
	fxRate: number | null;
	reversesEventId: number | null;
	cancelledAt: string | null;
	createdAt?: string;
}

/** The events that count: not cancelled, not a storno, not reversed by a storno. Ordered by date, then entry. */
export function effective<T extends Ev>(events: T[]): T[] {
	const live = events.filter((e) => !e.cancelledAt);
	const reversed = new Set(live.filter((e) => e.kind === 'reverse' && e.reversesEventId).map((e) => e.reversesEventId!));
	return live.filter((e) => e.kind !== 'reverse' && !reversed.has(e.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

export interface Split {
	date: string;
	/** new shares per old one */
	ratio: number;
}

/**
 * The provider's prices are already in the scale of the latest split; a trade before a split is brought to the
 * same scale: more shares at a lower price, the same money.
 */
export function splitFactor(date: string, splits: Split[]) {
	return splits.filter((s) => s.date > date).reduce((f, s) => f * s.ratio, 1);
}

export interface Trade {
	id: number;
	date: string;
	/** opening — «Перенесено»: shares that came into the portfolio from outside at the day's price */
	kind: 'buy' | 'sell' | 'opening';
	qty: number;
	/** in the price unit, in the current split scale */
	price: number;
	/** what the shares cost when bought (opening with a known purchase price), price unit, current scale */
	basis?: number;
	/** in the position's currency */
	fee: number;
	/** the portfolio's currency per one unit of the position's currency on the date (1 when they are the same) */
	fx: number;
	/** when it was entered: orders events of the same day */
	at?: string;
}

export interface BasisEv extends Ev {
	/** the whole purchase cost in the portfolio's currency (as the broker shows it) */
	costTotal?: number | null;
}

/**
 * The trades of a position in today's split scale. An opening takes its purchase price from the latest «basis»
 * event (an average price, or the whole cost in the portfolio's currency); without one its cost is the day's
 * price — the profit then counts «с даты переноса».
 */
export function trades(events: BasisEv[], splits: Split[] = [], f = 1): Trade[] {
	const live = effective(events);
	const basis = [...live].reverse().find((e) => e.kind === 'basis');
	return live
		.filter((e) => e.kind === 'buy' || e.kind === 'sell' || e.kind === 'opening')
		.map((e) => {
			const k = splitFactor(e.date, splits);
			const t: Trade = {
				id: e.id,
				date: e.date,
				kind: e.kind as Trade['kind'],
				qty: (e.qty ?? 0) * k,
				price: (e.price ?? 0) / k,
				fee: e.fee ?? 0,
				fx: e.fxRate ?? 1,
				at: e.createdAt
			};
			if (e.kind === 'opening' && basis) {
				if (basis.costTotal) t.basis = basis.costTotal / (t.qty * f * t.fx);
				else if (basis.price) t.basis = basis.price / k;
			}
			return t;
		});
}

export interface Lot {
	date: string;
	qty: number;
	/** what one share cost, price unit */
	price: number;
	/** the buy's fee per share, in the position's currency */
	feeEach: number;
	fx: number;
	/** an opening without a purchase price: its cost is the transfer day's price */
	fromTransfer?: boolean;
}

export interface Fifo {
	lots: Lot[];
	qty: number;
	/** realized profit in the position's currency and in the portfolio's (each side at its own date's rate) */
	realized: number;
	realizedPc: number;
	/** what was put in, in the position's currency, for the shares still held (with buy fees) */
	cost: number;
	costPc: number;
	bought: number;
	sold: number;
	/** some of what is held counts from the transfer day */
	fromTransfer: boolean;
}

export class OversellError extends Error {
	constructor(
		public date: string,
		public held: number,
		public wanted: number
	) {
		super(`На ${date} в позиции ${round(held, 6)}, а продаётся ${round(wanted, 6)}`);
	}
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const IN = (k: Trade['kind']) => k === 'buy' || k === 'opening';

/** FIFO over the trades, up to `until` (inclusive) when given. Selling more than is held throws. */
export function fifo(list: Trade[], f: number, until?: string): Fifo {
	const lots: Lot[] = [];
	let realized = 0;
	let realizedPc = 0;
	let bought = 0;
	let sold = 0;
	for (const t of [...list].sort((a, b) => a.date.localeCompare(b.date) || (IN(a.kind) === IN(b.kind) ? a.id - b.id : IN(a.kind) ? -1 : 1))) {
		if (until && t.date > until) break;
		if (IN(t.kind)) {
			lots.push({
				date: t.date,
				qty: t.qty,
				price: t.basis ?? t.price,
				feeEach: t.qty ? t.fee / t.qty : 0,
				fx: t.fx,
				fromTransfer: t.kind === 'opening' && t.basis === undefined
			});
			bought += t.qty;
			continue;
		}
		const held = lots.reduce((n, l) => n + l.qty, 0);
		if (t.qty > held + EPS) throw new OversellError(t.date, held, t.qty);
		let left = t.qty;
		const feeEach = t.qty ? t.fee / t.qty : 0;
		while (left > EPS) {
			const lot = lots[0];
			const q = Math.min(lot.qty, left);
			const proceeds = q * (t.price * f - feeEach);
			const cost = q * (lot.price * f + lot.feeEach);
			realized += proceeds - cost;
			realizedPc += proceeds * t.fx - cost * lot.fx;
			lot.qty -= q;
			left -= q;
			if (lot.qty <= EPS) lots.shift();
		}
		sold += t.qty;
	}
	const cost = lots.reduce((n, l) => n + l.qty * (l.price * f + l.feeEach), 0);
	const costPc = lots.reduce((n, l) => n + l.qty * (l.price * f + l.feeEach) * l.fx, 0);
	return { lots, qty: lots.reduce((n, l) => n + l.qty, 0), realized, realizedPc, cost, costPc, bought, sold, fromTransfer: lots.some((l) => l.fromTransfer) };
}

export interface Holding {
	qty: number;
	/** average price of what is held, in the price unit (fees not included) */
	avgPrice: number | null;
	value: number;
	valuePc: number;
	unrealized: number;
	unrealizedPc: number;
	/** a position in another currency than the portfolio's: the profit from the price and from the rate */
	fromPrice: number;
	fromFx: number;
}

/** What is held now, valued at `price` (price unit) and `fx` (portfolio currency per unit of the position's). */
export function holding(fi: Fifo, f: number, price: number | null, fx: number): Holding {
	const qty = fi.qty;
	const avgPrice = qty > EPS ? fi.lots.reduce((n, l) => n + l.qty * l.price, 0) / qty : null;
	if (price === null || qty <= EPS) return { qty, avgPrice, value: 0, valuePc: 0, unrealized: 0, unrealizedPc: 0, fromPrice: 0, fromFx: 0 };
	const value = qty * price * f;
	const valuePc = value * fx;
	// profit = Σ q·(P·f·fx − (p·f + fee)·fx₀) = price part Σ q·(P·f − p·f − fee)·fx₀ + rate part Σ q·P·f·(fx − fx₀)
	let fromPrice = 0;
	let fromFx = 0;
	for (const l of fi.lots) {
		fromPrice += l.qty * (price * f - l.price * f - l.feeEach) * l.fx;
		fromFx += l.qty * price * f * (fx - l.fx);
	}
	return { qty, avgPrice, value, valuePc, unrealized: value - fi.cost, unrealizedPc: valuePc - fi.costPc, fromPrice, fromFx };
}

/** Stage of a position from its events (the last planning step and whether anything is held). */
export function stageOf(events: (Ev & { kind: string })[], qty: number): Stage {
	const list = effective(events);
	if (qty > EPS) {
		// after the last trade: «хочу продать» stays until a sell or «передумал»
		let s: Stage = 'holding';
		for (const e of list) {
			if (e.kind === 'plan_sell') s = 'plan_sell';
			else if (e.kind === 'buy' || e.kind === 'opening' || e.kind === 'sell' || e.kind === 'drop') s = 'holding';
		}
		return s;
	}
	let s: Stage = 'watch';
	for (const e of list) {
		if (e.kind === 'watch') s = 'watch';
		else if (e.kind === 'plan_buy') s = 'plan_buy';
		else if (e.kind === 'sell' || e.kind === 'drop') s = 'closed';
		else if (e.kind === 'buy' || e.kind === 'opening') s = 'holding';
	}
	// bought and sold out, nothing planned after: closed
	return s === 'holding' ? 'closed' : s;
}

// ── the whole portfolio: cash, value, time-weighted return ───────────────────────────────────────────────

export interface CashEv extends Ev {
	/** deposit | withdraw | convert | dividend | fee | tax */
	amount: number;
}

export interface Book {
	/** the portfolio's currency: totals, flows and the return are in it */
	currency: string;
	positions: { id: number; securityId: number; f: number; currency: string; trades: Trade[] }[];
	cash: {
		id: number;
		date: string;
		kind: string;
		amount: number;
		currency: string;
		/** convert: what was received */
		toAmount?: number | null;
		toCurrency?: string | null;
		at?: string;
	}[];
}

export interface Market {
	/** the last close on or before the date, in the price unit (current split scale); null — no price */
	price(securityId: number, date: string): number | null;
	/** units of `to` per one unit of `from` on the date (USD/ILS by the Bank of Israel; 1 for the same currency) */
	conv(from: string, to: string, date: string): number;
}

interface Flow {
	date: string;
	/** the portfolio's currency into it from outside (+) or out of it (−) */
	value: number;
}

export type Balances = Record<string, number>;

/**
 * The money of the portfolio by currency, day by day, and what came from outside. Outside money: deposits,
 * withdrawals, openings (shares brought in at the day's value) and a conversion whose given side is not the
 * portfolio's currency (a dollar portfolio gets its dollars that way). A conversion inside the portfolio
 * (shekels to dollars in a shekel portfolio) only moves money between currencies.
 *
 * Two balances: `raw` — as the broker shows (may go below zero: a buy without enough money is only warned
 * about); `twr` — for the return: a buy the money cannot cover is paid with an implied deposit of the missing
 * sum, so a portfolio kept without recording deposits still has a correct return.
 * Within a day: deposits first, then the events in the order they were entered.
 */
export function cashFlow(book: Book, m?: Market) {
	const pc = book.currency;
	const rate = (c: string, d: string) => (c === pc ? 1 : m ? m.conv(c, pc, d) : 1);
	type Item = { date: string; order: number; moves: [string, number][]; outside: number | null; at?: string };
	const items: Item[] = [];
	for (const c of book.cash) {
		const a = c.amount;
		if (c.kind === 'deposit') items.push({ date: c.date, order: 0, moves: [[c.currency, a]], outside: a * rate(c.currency, c.date) });
		else if (c.kind === 'withdraw') items.push({ date: c.date, order: 4, moves: [[c.currency, -a]], outside: -a * rate(c.currency, c.date), at: c.at });
		else if (c.kind === 'dividend') items.push({ date: c.date, order: 1, moves: [[c.currency, a]], outside: null, at: c.at });
		else if (c.kind === 'convert' && c.toAmount && c.toCurrency) {
			// money given in a currency the portfolio does not keep comes from outside
			if (c.currency !== pc) items.push({ date: c.date, order: 0, moves: [[c.toCurrency, c.toAmount]], outside: c.toAmount * rate(c.toCurrency, c.date) });
			else items.push({ date: c.date, order: 1, moves: [[c.currency, -a], [c.toCurrency, c.toAmount]], outside: null, at: c.at });
		} else items.push({ date: c.date, order: 3, moves: [[c.currency, -a]], outside: null, at: c.at });
	}
	for (const p of book.positions)
		for (const t of p.trades) {
			const money = t.qty * t.price * p.f;
			if (t.kind === 'opening') items.push({ date: t.date, order: 0, moves: [], outside: money * t.fx, at: t.at });
			else if (t.kind === 'sell') items.push({ date: t.date, order: 1, moves: [[p.currency, money - t.fee]], outside: null, at: t.at });
			else items.push({ date: t.date, order: 2, moves: [[p.currency, -(money + t.fee)]], outside: null, at: t.at });
		}
	items.sort(
		(a, b) =>
			a.date.localeCompare(b.date) ||
			Number(b.order === 0) - Number(a.order === 0) ||
			(a.at && b.at ? a.at.localeCompare(b.at) : 0) ||
			a.order - b.order
	);
	const raw: Balances = {};
	const tw: Balances = {};
	const flows: Flow[] = [];
	const history: { date: string; twr: Balances; raw: Balances }[] = [];
	const addFlow = (date: string, value: number) => {
		const last = flows.at(-1);
		if (last?.date === date) last.value += value;
		else flows.push({ date, value });
	};
	for (const it of items) {
		for (const [c, x] of it.moves) {
			raw[c] = (raw[c] ?? 0) + x;
			tw[c] = (tw[c] ?? 0) + x;
		}
		if (it.outside !== null) addFlow(it.date, it.outside);
		else
			for (const [c] of it.moves)
				if (tw[c] < -EPS) {
					// the implied deposit, in the portfolio's currency at the day's rate
					addFlow(it.date, -tw[c] * rate(c, it.date));
					tw[c] = 0;
				}
		const last = history.at(-1);
		if (last?.date === it.date) Object.assign(last, { twr: { ...tw }, raw: { ...raw } });
		else history.push({ date: it.date, twr: { ...tw }, raw: { ...raw } });
	}
	return { flows, history, raw, twr: tw };
}

const balancesOn = (history: { date: string; twr: Balances }[], date: string) => {
	let b: Balances = {};
	for (const h of history) {
		if (h.date > date) break;
		b = h.twr;
	}
	return b;
};

/** The portfolio's value in its currency at the close of `date` (money by the implied-deposit rule). */
export function valueOn(book: Book, m: Market, date: string, history = cashFlow(book, m).history) {
	let v = 0;
	for (const [c, x] of Object.entries(balancesOn(history, date))) v += x * (c === book.currency ? 1 : m.conv(c, book.currency, date));
	for (const p of book.positions) {
		const fi = fifo(p.trades, p.f, date);
		if (fi.qty <= EPS) continue;
		const price = m.price(p.securityId, date) ?? p.trades.filter((t) => t.date <= date).at(-1)?.price ?? 0;
		v += fi.qty * price * p.f * (p.currency === book.currency ? 1 : m.conv(p.currency, book.currency, date));
	}
	return v;
}

export interface Twr {
	/** fraction: 0.05 = +5% */
	twr: number | null;
	from: string | null;
	/** value at each checkpoint (a day with outside money, and the end) and the growth of 1 up to it */
	series: { date: string; value: number; growth: number }[];
	invested: number;
}

/**
 * Time-weighted return. The period is cut on each day outside money came or left; the money is taken to come at
 * the day's close, so a piece's return is (value at its end − that day's money) / value at its start. The very
 * first day starts from the money itself (its first buy at its price, valued at the close). The pieces multiply;
 * the result does not depend on when or how much money came.
 */
export function twr(book: Book, m: Market, end: string): Twr {
	const { flows, history } = cashFlow(book, m);
	if (!flows.length) return { twr: null, from: null, series: [], invested: 0 };
	const days = [...new Set([...flows.map((f) => f.date), end])].filter((d) => d <= end).sort();
	let growth = 1;
	let last = 0;
	const series: Twr['series'] = [];
	for (const d of days) {
		const inflow = flows.filter((f) => f.date === d).reduce((n, f) => n + f.value, 0);
		const v = valueOn(book, m, d, history);
		if (last > EPS) growth *= (v - inflow) / last;
		else if (inflow > EPS) growth *= v / inflow;
		series.push({ date: d, value: v, growth });
		last = v;
	}
	return { twr: growth - 1, from: flows[0].date, series, invested: flows.reduce((n, f) => n + f.value, 0) };
}

// ── how money and prices read on the screen ─────────────────────────────────────────────────────────────

export const curSign = (c: string) => (c === 'USD' ? '$' : '₪');

/** 12 201 ₪, 4 180,5 $ — whole units from a thousand up. */
export function money(x: number | null | undefined, currency = 'ILS', signed = false) {
	if (x === null || x === undefined || !Number.isFinite(x)) return '—';
	const s = Math.abs(x).toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(x) >= 1000 ? 0 : 2 });
	return `${signed ? (x > 0 ? '+' : x < 0 ? '−' : '') : x < 0 ? '−' : ''}${s} ${curSign(currency)}`;
}

/** A price in the position's unit: 6 500 аг., 110,25 $. */
export function priceText(p: number | null | undefined, priceUnit: string) {
	if (p === null || p === undefined) return '—';
	const s = p.toLocaleString('ru-RU', { maximumFractionDigits: priceUnit === 'ILA' ? 1 : 2 });
	return `${s} ${priceUnit === 'ILA' ? 'аг.' : curSign(priceUnit)}`;
}

/** Quantities keep six decimals: Blink holds fractional shares (section 18). */
export const qtyText = (q: number) => q.toLocaleString('ru-RU', { maximumFractionDigits: 6 });
