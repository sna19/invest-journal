import type Database from 'better-sqlite3';
import type { Fetcher } from './types.js';
import { getSetting, setSetting } from './rings.js';
import { securitiesForPrices, type Sec } from './prices.js';

/**
 * Live quotes (owner's request, 19.11.2026): the last price of each security held in a portfolio, and the dollar
 * rate, during the trading day — so the portfolio screen is current between the morning loads of daily closes.
 * Yahoo's chart endpoint (range=1d) gives the last price and its time in `meta`; quotes of Israeli shares are in
 * agorot like the closes, and a quote ×100 / ÷100 off the last close is brought to the close's unit. A quote more
 * than 50% off the last close is not taken (a bad print). Quotes never enter statistics.
 */

export interface Quote {
	price: number;
	prevClose: number | null;
	currency: string | null;
	marketTime: string;
}

export function quoteUrl(symbol: string) {
	return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
}

export function parseQuote(body: string): Quote | null {
	const meta = JSON.parse(body)?.chart?.result?.[0]?.meta;
	const price = meta?.regularMarketPrice;
	const t = meta?.regularMarketTime;
	if (typeof price !== 'number' || !(price > 0) || typeof t !== 'number') return null;
	const prev = meta.chartPreviousClose ?? meta.previousClose;
	return { price, prevClose: typeof prev === 'number' ? prev : null, currency: meta.currency ?? null, marketTime: new Date(t * 1000).toISOString() };
}

/** the quote in the unit of the last close: agorot and shekels mixed up are brought back; a bad print is null */
export function fitToClose(price: number, close: number | null): number | null {
	if (!close) return price;
	const q = price / close;
	if (q > 50 && q < 200) return price / 100;
	if (q > 0.005 && q < 0.02) return price * 100;
	return Math.abs(q - 1) > 0.5 ? null : price;
}

// ── settings ─────────────────────────────────────────────────────────────────

export interface Schedule {
	/** minutes between live quotes; 0 — off */
	quotesEvery: number;
	/** only while TASE or the US market is open */
	quotesMarketHours: boolean;
	/** the morning load of daily closes, HH:MM Israel time */
	pricesAt: string;
}

export const QUOTE_STEPS = [0, 5, 10, 15, 30, 60];

export function readSchedule(market: Database.Database): Schedule {
	const every = Number(getSetting(market, 'quotes.every', '15'));
	const at = getSetting(market, 'prices.at', '07:15');
	return {
		quotesEvery: QUOTE_STEPS.includes(every) ? every : 15,
		quotesMarketHours: getSetting(market, 'quotes.marketHours', '1') === '1',
		pricesAt: /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? at : '07:15'
	};
}

export class ScheduleError extends Error {}

export function writeSchedule(market: Database.Database, s: Partial<Record<keyof Schedule, unknown>>): Schedule {
	if (s.quotesEvery !== undefined) {
		const n = Number(s.quotesEvery);
		if (!QUOTE_STEPS.includes(n)) throw new ScheduleError(`Частота котировок: ${QUOTE_STEPS.join(', ')} минут (0 — выкл)`);
		setSetting(market, 'quotes.every', String(n));
	}
	if (s.quotesMarketHours !== undefined) setSetting(market, 'quotes.marketHours', s.quotesMarketHours ? '1' : '0');
	if (s.pricesAt !== undefined) {
		const at = String(s.pricesAt);
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new ScheduleError('Время в виде ЧЧ:ММ');
		setSetting(market, 'prices.at', at);
	}
	return readSchedule(market);
}

// ── market hours ─────────────────────────────────────────────────────────────

function local(now: Date, tz: string) {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
			.formatToParts(now)
			.map((x) => [x.type, x.value])
	);
	return { day: p.weekday as string, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** TASE trades Mon–Fri (since January 2026) 09:59–17:25 Israel time; NYSE/Nasdaq Mon–Fri 09:30–16:00 New York */
export function marketsOpen(now = new Date()): { tase: boolean; us: boolean } {
	const il = local(now, 'Asia/Jerusalem');
	const ny = local(now, 'America/New_York');
	const weekday = (d: string) => !['Sat', 'Sun'].includes(d);
	return {
		tase: weekday(il.day) && il.minutes >= 9 * 60 + 45 && il.minutes <= 17 * 60 + 40,
		us: weekday(ny.day) && ny.minutes >= 9 * 60 + 30 && ny.minutes <= 16 * 60 + 5
	};
}

// ── loading ──────────────────────────────────────────────────────────────────

/** securities of open positions in all portfolios (the ones the portfolio screens show) */
export function heldSecurities(app: Database.Database): number[] {
	return (app.prepare(`select distinct security_id as id from positions where stage <> 'closed'`).all() as { id: number }[]).map((r) => r.id);
}

export interface QuotesSummary {
	securities: number;
	updated: number;
	skipped: number;
	errors: string[];
	fx: boolean;
}

export async function loadQuotes(market: Database.Database, app: Database.Database, get: Fetcher, now = new Date()): Promise<QuotesSummary> {
	const ids = heldSecurities(app);
	const secs: Sec[] = securitiesForPrices(market, ids);
	const lastClose = market.prepare('select close from market_prices_daily where security_id = ? order by date desc limit 1');
	const put = market.prepare(
		`insert into market_quotes (key, security_id, price, prev_close, currency, market_time, fetched_at, provider_code) values (?, ?, ?, ?, ?, ?, ?, 'yahoo')
		 on conflict (key) do update set price = excluded.price, prev_close = excluded.prev_close, currency = excluded.currency,
		   market_time = excluded.market_time, fetched_at = excluded.fetched_at`
	);
	const s: QuotesSummary = { securities: secs.length, updated: 0, skipped: 0, errors: [], fx: false };
	const fetched = now.toISOString();
	for (const sec of secs) {
		try {
			const r = await get(quoteUrl(sec.yahoo));
			const q = parseQuote(r.toString("utf8"));
			if (!q) {
				s.skipped++;
				continue;
			}
			const close = (lastClose.get(sec.id) as { close: number } | undefined)?.close ?? null;
			const price = fitToClose(q.price, close);
			const prev = q.prevClose === null ? null : fitToClose(q.prevClose, close);
			if (price === null) {
				s.skipped++;
				continue;
			}
			put.run(`sec:${sec.id}`, sec.id, price, prev, q.currency, q.marketTime, fetched);
			s.updated++;
		} catch (e) {
			s.errors.push(`${sec.symbol}: ${e instanceof Error ? e.message : e}`);
		}
	}
	try {
		const r = await get(quoteUrl('ILS=X'));
		const q = parseQuote(r.toString("utf8"));
		// a sane dollar: 2.5–6 shekels
		if (q && q.price > 2.5 && q.price < 6) {
			put.run('fx:USD/ILS', null, q.price, q.prevClose, 'ILS', q.marketTime, fetched);
			s.fx = true;
		}
	} catch (e) {
		s.errors.push(`USD/ILS: ${e instanceof Error ? e.message : e}`);
	}
	return s;
}

export interface LiveQuote {
	price: number;
	prevClose: number | null;
	marketTime: string;
	fetchedAt: string;
}

export function readQuotes(market: Database.Database): Map<string, LiveQuote> {
	const rows = market.prepare('select key, price, prev_close as prevClose, market_time as marketTime, fetched_at as fetchedAt from market_quotes').all() as (LiveQuote & { key: string })[];
	return new Map(rows.map((r) => [r.key, r]));
}
