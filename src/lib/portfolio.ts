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
	reverse: 'Сторно'
};
export const CASH_LABEL: Record<string, string> = {
	deposit: 'Взнос',
	withdraw: 'Вывод',
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
	kind: 'buy' | 'sell';
	qty: number;
	/** in the price unit, in the current split scale */
	price: number;
	/** in the currency */
	fee: number;
	/** shekels per one unit of the currency on the date */
	fx: number;
}

export function trades(events: Ev[], splits: Split[] = []): Trade[] {
	return effective(events)
		.filter((e) => e.kind === 'buy' || e.kind === 'sell')
		.map((e) => {
			const k = splitFactor(e.date, splits);
			return { id: e.id, date: e.date, kind: e.kind as 'buy' | 'sell', qty: (e.qty ?? 0) * k, price: (e.price ?? 0) / k, fee: e.fee ?? 0, fx: e.fxRate ?? 1 };
		});
}

export interface Lot {
	date: string;
	qty: number;
	price: number;
	/** the buy's fee per share, in the currency */
	feeEach: number;
	fx: number;
}

export interface Fifo {
	lots: Lot[];
	qty: number;
	/** realized profit in the currency and in shekels (each side at its own date's rate) */
	realized: number;
	realizedIls: number;
	/** what was put in, in the currency, for the shares still held (with buy fees) */
	cost: number;
	costIls: number;
	bought: number;
	sold: number;
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

/** FIFO over the trades, up to `until` (inclusive) when given. Selling more than is held throws. */
export function fifo(list: Trade[], f: number, until?: string): Fifo {
	const lots: Lot[] = [];
	let realized = 0;
	let realizedIls = 0;
	let bought = 0;
	let sold = 0;
	for (const t of [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.id - b.id : a.kind === 'buy' ? -1 : 1))) {
		if (until && t.date > until) break;
		if (t.kind === 'buy') {
			lots.push({ date: t.date, qty: t.qty, price: t.price, feeEach: t.qty ? t.fee / t.qty : 0, fx: t.fx });
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
			realizedIls += proceeds * t.fx - cost * lot.fx;
			lot.qty -= q;
			left -= q;
			if (lot.qty <= EPS) lots.shift();
		}
		sold += t.qty;
	}
	const cost = lots.reduce((n, l) => n + l.qty * (l.price * f + l.feeEach), 0);
	const costIls = lots.reduce((n, l) => n + l.qty * (l.price * f + l.feeEach) * l.fx, 0);
	return { lots, qty: lots.reduce((n, l) => n + l.qty, 0), realized, realizedIls, cost, costIls, bought, sold };
}

export interface Holding {
	qty: number;
	/** average price of what is held, in the price unit (fees not included) */
	avgPrice: number | null;
	value: number;
	valueIls: number;
	unrealized: number;
	unrealizedIls: number;
	/** for a foreign-currency position: the shekel profit from the price and from the rate */
	fromPrice: number;
	fromFx: number;
}

/** What is held now, valued at `price` (price unit) and `fx` (shekels per unit of the currency). */
export function holding(fi: Fifo, f: number, price: number | null, fx: number): Holding {
	const qty = fi.qty;
	const avgPrice = qty > EPS ? fi.lots.reduce((n, l) => n + l.qty * l.price, 0) / qty : null;
	if (price === null || qty <= EPS) return { qty, avgPrice, value: 0, valueIls: 0, unrealized: 0, unrealizedIls: 0, fromPrice: 0, fromFx: 0 };
	const value = qty * price * f;
	const valueIls = value * fx;
	// shekel profit = Σ q·(P·f·fx − (p·f + fee)·fx₀) = price part Σ q·(P·f − p·f − fee)·fx₀ + rate part Σ q·P·f·(fx − fx₀)
	let fromPrice = 0;
	let fromFx = 0;
	for (const l of fi.lots) {
		fromPrice += l.qty * (price * f - l.price * f - l.feeEach) * l.fx;
		fromFx += l.qty * price * f * (fx - l.fx);
	}
	return { qty, avgPrice, value, valueIls, unrealized: value - fi.cost, unrealizedIls: valueIls - fi.costIls, fromPrice, fromFx };
}

/** Stage of a position from its events (the last planning step and whether anything is held). */
export function stageOf(events: (Ev & { kind: string })[], qty: number): Stage {
	const list = effective(events);
	if (qty > EPS) {
		// after the last trade: «хочу продать» stays until a sell or «передумал»
		let s: Stage = 'holding';
		for (const e of list) {
			if (e.kind === 'plan_sell') s = 'plan_sell';
			else if (e.kind === 'buy' || e.kind === 'sell' || e.kind === 'drop') s = 'holding';
		}
		return s;
	}
	let s: Stage = 'watch';
	for (const e of list) {
		if (e.kind === 'watch') s = 'watch';
		else if (e.kind === 'plan_buy') s = 'plan_buy';
		else if (e.kind === 'sell' || e.kind === 'drop') s = 'closed';
		else if (e.kind === 'buy') s = 'holding';
	}
	return s === 'holding' || s === 'plan_sell' ? 'closed' : s;
}

// ── the whole portfolio: cash, value, time-weighted return ───────────────────────────────────────────────

export interface CashEv extends Ev {
	/** deposit | withdraw | dividend | fee | tax */
	amount: number;
}

export interface Book {
	positions: { id: number; securityId: number; f: number; currency: string; trades: Trade[] }[];
	cash: { date: string; kind: string; amount: number; fx: number; id: number }[];
}

export interface Market {
	/** the last close on or before the date, in the price unit (current split scale); null — no price */
	price(securityId: number, date: string): number | null;
	/** shekels per one unit of the currency on the date (1 for ILS) */
	fx(currency: string, date: string): number;
}

interface Flow {
	date: string;
	/** shekels into the portfolio from outside (+) or out of it (−) */
	ils: number;
}

/**
 * The cash of the portfolio in shekels, day by day, and the money that came from outside. Deposits and
 * withdrawals are the outside money. A buy the cash cannot cover is paid with an implied deposit of the
 * missing sum — so a portfolio kept without recording deposits still has a correct return.
 * Within a day: money in (deposits, sells, dividends) before money out (buys, fees, taxes, withdrawals).
 */
export function cashFlow(book: Book) {
	type Item = { date: string; order: number; ils: number; outside: boolean };
	const items: Item[] = [];
	for (const c of book.cash) {
		const ils = c.amount * c.fx;
		if (c.kind === 'deposit') items.push({ date: c.date, order: 0, ils, outside: true });
		else if (c.kind === 'dividend') items.push({ date: c.date, order: 1, ils, outside: false });
		else if (c.kind === 'withdraw') items.push({ date: c.date, order: 4, ils: -ils, outside: true });
		else items.push({ date: c.date, order: 3, ils: -ils, outside: false });
	}
	for (const p of book.positions)
		for (const t of p.trades) {
			const money = t.qty * t.price * p.f;
			if (t.kind === 'sell') items.push({ date: t.date, order: 1, ils: (money - t.fee) * t.fx, outside: false });
			else items.push({ date: t.date, order: 2, ils: -(money + t.fee) * t.fx, outside: false });
		}
	items.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
	let cash = 0;
	const flows: Flow[] = [];
	const balance: { date: string; cash: number }[] = [];
	const addFlow = (date: string, ils: number) => {
		const last = flows.at(-1);
		if (last?.date === date) last.ils += ils;
		else flows.push({ date, ils });
	};
	for (const it of items) {
		cash += it.ils;
		if (it.outside) addFlow(it.date, it.ils);
		else if (cash < -EPS) {
			// the implied deposit
			addFlow(it.date, -cash);
			cash = 0;
		}
		const last = balance.at(-1);
		if (last?.date === it.date) last.cash = cash;
		else balance.push({ date: it.date, cash });
	}
	return { flows, balance, cash };
}

const cashOn = (balance: { date: string; cash: number }[], date: string) => {
	let c = 0;
	for (const b of balance) {
		if (b.date > date) break;
		c = b.cash;
	}
	return c;
};

/** The portfolio's value in shekels at the close of `date`: cash + every holding at its last price. */
export function valueOn(book: Book, m: Market, date: string, balance = cashFlow(book).balance) {
	let v = cashOn(balance, date);
	for (const p of book.positions) {
		const fi = fifo(p.trades, p.f, date);
		if (fi.qty <= EPS) continue;
		const price = m.price(p.securityId, date) ?? p.trades.filter((t) => t.date <= date).at(-1)?.price ?? 0;
		v += fi.qty * price * p.f * m.fx(p.currency, date);
	}
	return v;
}

export interface Twr {
	/** fraction: 0.05 = +5% */
	twr: number | null;
	from: string | null;
	/** value at each checkpoint (a day with outside money, and the end) and the growth of 1 ₪ up to it */
	series: { date: string; value: number; growth: number }[];
	invested: number;
}

/**
 * Time-weighted return: the period is cut at each day outside money came or left; each piece's return is
 * value at its end / (value at the start of it + the money that came on its first day); the pieces multiply.
 * Money is taken to come at the start of its day, so the first day's move counts.
 */
export function twr(book: Book, m: Market, end: string): Twr {
	const { flows, balance } = cashFlow(book);
	const points = [...new Set([...flows.map((f) => f.date), end])].filter((d) => d <= end).sort();
	if (!flows.length) return { twr: null, from: null, series: [], invested: 0 };
	let growth = 1;
	let prev = 0;
	const series: Twr['series'] = [];
	for (const d of points) {
		const inflow = flows.filter((f) => f.date === d).reduce((n, f) => n + f.ils, 0);
		const v = valueOn(book, m, d, balance);
		const base = prev + inflow;
		if (base > EPS) growth *= v / base;
		series.push({ date: d, value: v, growth });
		prev = v;
	}
	return { twr: growth - 1, from: flows[0].date, series, invested: flows.reduce((n, f) => n + f.ils, 0) };
}
