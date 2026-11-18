import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { unitFactor } from '../portfolio.js';
import { searchText } from './market/pipeline.js';
import { chartUrl } from './market/yahoo.js';
import type { Fetcher } from './market/types.js';
import { addCash, addEvent, marketView, moneyOf, security, updatePortfolio } from './portfolio.js';

/**
 * Spec section 18 «Перенос существующих позиций» — positions bought before the portfolio was kept, entered as a list
 * pasted into the app (the portfolio's data never goes into the repository). One line per position:
 *
 *   SCHD 103.205 35.45                 symbol, quantity, the transfer day's price (Blink: fractional shares)
 *   ESLT value=4770 cost=3032          symbol, the position's value and its purchase cost in the portfolio's currency
 *                                      (Excellence): quantity = value / the day's close, rounded to whole shares
 *   yahoo:CSPX.L value=15564 cost=13690.10   an ETF UCITS on the LSE, added to the reference by hand
 *   cash ILS 5290.91 · cash USD 663.15 · tax 2881.45 · date 2026-11-17
 *
 * Optional on a position line: avg=<average price> or cost=<whole purchase cost>, price=<price>. First a preview
 * (matches, quantities, roundings over 1%, prices off the base by more than 5%), then «Перенести» writes it all.
 */

export interface Line {
	n: number;
	text: string;
	kind: 'position' | 'cash' | 'tax' | 'date' | 'skip' | 'error';
	symbol?: string;
	yahoo?: string;
	qty?: number;
	price?: number;
	value?: number;
	cost?: number;
	avg?: number;
	currency?: string;
	amount?: number;
	date?: string;
	error?: string;
}

const NUM = /^-?\d[\d\s]*([.,]\d+)?$/;
const toNum = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

export function parseTransfer(text: string): Line[] {
	return text
		.replace(/\r/g, '')
		.split('\n')
		.map((raw, i) => {
			// «value=12 050» — thousands spaces are allowed inside a key=value field, not in bare numbers
			const t = raw.trim().replace(/(\w+=)(\d[\d .,]*\d)/g, (_, k: string, v: string) => k + v.replace(/\s/g, ''));
			const n = i + 1;
			if (!t || t.startsWith('#')) return { n, text: raw, kind: 'skip' as const };
			const parts = t.split(/[;\t]|\s+/).map((x) => x.trim()).filter(Boolean);
			const head = parts[0].toLowerCase();
			if (head === 'date') {
				const d = parts[1];
				return /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') ? { n, text: raw, kind: 'date' as const, date: d } : { n, text: raw, kind: 'error' as const, error: 'Дата в виде ГГГГ-ММ-ДД' };
			}
			if (head === 'cash') {
				const cur = (parts[1] ?? '').toUpperCase();
				if ((cur !== 'USD' && cur !== 'ILS') || !NUM.test(parts[2] ?? '')) return { n, text: raw, kind: 'error' as const, error: 'cash USD|ILS сумма' };
				return { n, text: raw, kind: 'cash' as const, currency: cur, amount: toNum(parts[2]) };
			}
			if (head === 'tax') {
				if (!NUM.test(parts[1] ?? '')) return { n, text: raw, kind: 'error' as const, error: 'tax сумма' };
				return { n, text: raw, kind: 'tax' as const, amount: toNum(parts[1]) };
			}
			const l: Line = { n, text: raw, kind: 'position' };
			if (parts[0].toLowerCase().startsWith('yahoo:')) l.yahoo = parts[0].slice(6).toUpperCase();
			else l.symbol = parts[0].toUpperCase();
			const bare: number[] = [];
			for (const p of parts.slice(1)) {
				const kv = /^(\w+)=(.+)$/.exec(p);
				if (kv) {
					const v = kv[2].replace(/^@/, '');
					if (!NUM.test(v)) return { ...l, kind: 'error' as const, error: `«${p}» — не число` };
					const x = toNum(v);
					const k = kv[1].toLowerCase();
					if (k === 'value') l.value = x;
					else if (k === 'cost') l.cost = x;
					else if (k === 'avg') l.avg = x;
					else if (k === 'price') l.price = x;
					else if (k === 'qty') l.qty = x;
					else return { ...l, kind: 'error' as const, error: `неизвестное поле «${k}»` };
				} else if (p === '@') continue;
				else if (NUM.test(p.replace(/^@/, ''))) bare.push(toNum(p.replace(/^@/, '')));
				else return { ...l, kind: 'error' as const, error: `«${p}» — не число` };
			}
			if (bare.length) l.qty ??= bare[0];
			if (bare.length > 1) l.price ??= bare[1];
			if (l.qty === undefined && l.value === undefined) return { ...l, kind: 'error' as const, error: 'нужны количество или value=стоимость' };
			if (l.avg !== undefined && l.cost !== undefined) return { ...l, kind: 'error' as const, error: 'avg= или cost=, не оба' };
			return l;
		});
}

export interface Row extends Line {
	securityId?: number;
	found?: { symbol: string; name: string; exchange: string; priceUnit: string; manual: boolean; isNew?: boolean };
	/** the base's close on (or before) the transfer day */
	close?: { date: string; price: number } | null;
	/** quantity computed from value / close, before rounding, and how much the rounding moved it */
	rawQty?: number;
	roundingPct?: number;
	/** the given price against the base's close, % */
	priceDiffPct?: number;
	/** the position's value in the portfolio's currency on the day */
	valuePc?: number;
	warnings: string[];
	ok: boolean;
}

/**
 * Yahoo's own description of a symbol — to add an ETF UCITS by hand: the currency, the exchange, the name and the
 * close on (or before) the day.
 */
export async function yahooMeta(get: Fetcher, symbol: string, day: string) {
	try {
		const from = new Date(Date.parse(day) - 10 * 86400000).toISOString().slice(0, 10);
		const to = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
		const j = JSON.parse((await get(chartUrl(symbol, from, to))).toString());
		const res = j.chart?.result?.[0];
		const m = res?.meta;
		if (!m) return null;
		const ts: number[] = res.timestamp ?? [];
		const cl: (number | null)[] = res.indicators?.quote?.[0]?.close ?? [];
		let close: { date: string; price: number } | null = null;
		ts.forEach((t, i) => {
			const d = new Date((t + (m.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10);
			if (d <= day && cl[i] !== null && cl[i] !== undefined) close = { date: d, price: cl[i] as number };
		});
		return { currency: String(m.currency), exchange: String(m.exchangeName ?? ''), name: String(m.longName ?? m.shortName ?? symbol), close };
	} catch {
		return null;
	}
}

/**
 * The preview: every line matched with the reference and checked. Nothing is written. A security added by hand
 * (yahoo:) is only described here; «Перенести» adds it.
 */
export async function previewTransfer(
	app: Database.Database,
	market: Database.Database,
	portfolioId: number,
	text: string,
	opts: { get?: Fetcher; today?: string } = {}
) {
	const today = opts.today ?? israelDate();
	const port = app.prepare('select id, currency from portfolios where id = ?').get(portfolioId) as { id: number; currency: string } | undefined;
	if (!port) throw new Error('Портфеля нет');
	const pc = port.currency;
	const lines = parseTransfer(text);
	const date = lines.find((l) => l.kind === 'date')?.date ?? today;
	const m = marketView(market);
	const rows: Row[] = [];
	for (const l of lines) {
		if (l.kind === 'skip' || l.kind === 'date') continue;
		const r: Row = { ...l, warnings: [], ok: l.kind !== 'error' };
		rows.push(r);
		if (l.kind !== 'position') continue;
		// the security: by symbol on the portfolio's market first; or a provider symbol added by hand
		if (l.yahoo) {
			const known = market
				.prepare(
					`select s.id from ref_provider_symbols p join ref_securities s on s.id = p.security_id where p.provider_code = 'yahoo' and p.provider_symbol = ?`
				)
				.get(l.yahoo) as { id: number } | undefined;
			if (known) r.securityId = known.id;
			else {
				const meta = opts.get ? await yahooMeta(opts.get, l.yahoo, date) : null;
				if (!meta) {
					r.ok = false;
					r.warnings.push(`У Yahoo нет ${l.yahoo}`);
					continue;
				}
				if (meta.currency !== 'USD') {
					r.ok = false;
					r.warnings.push(`${l.yahoo} у Yahoo в ${meta.currency}, нужна долларовая линия`);
					continue;
				}
				r.found = { symbol: l.yahoo.replace(/\.\w+$/, ''), name: meta.name, exchange: 'LSE', priceUnit: 'USD', manual: true, isNew: true };
				r.close = meta.close;
				r.warnings.push(`Новая бумага: ${meta.name}, ${meta.exchange}; добавится в справочник вручную, история цен загрузится после переноса`);
			}
		} else {
			const order = pc === 'ILS' ? `e.country = 'IL' desc,` : `e.country = 'US' desc,`;
			const hit = market
				.prepare(
					`select s.id from ref_securities s join ref_exchanges e on e.code = s.exchange_code
					  where upper(s.symbol) = ? and s.type <> 'index' order by s.active desc, ${order} s.id limit 2`
				)
				.all(l.symbol) as { id: number }[];
			if (!hit.length) {
				r.ok = false;
				r.warnings.push(`Тикера ${l.symbol} нет в справочнике`);
				continue;
			}
			r.securityId = hit[0].id;
		}
		if (r.securityId) {
			const s = security(market, r.securityId)!;
			r.found = { symbol: s.symbol, name: s.name_en, exchange: s.exchange_code, priceUnit: s.price_unit, manual: !!s.manual };
			if (pc === 'USD' && moneyOf(s.price_unit) !== 'USD') {
				r.ok = false;
				r.warnings.push('В долларовый портфель — только бумаги в долларах');
				continue;
			}
			const day = m.day(r.securityId, date);
			r.close = day ? { date: day.date, price: day.close } : null;
			if (day && day.date !== date) r.warnings.push(`Цена закрытия на ${date} ещё нет — взята за ${day.date}`);
		}
		const unit = r.found!.priceUnit;
		const f = unitFactor(unit);
		const rate = m.conv(moneyOf(unit), pc, date);
		const price = l.price ?? r.close?.price;
		if (l.value !== undefined && l.qty === undefined) {
			if (!r.close) {
				r.ok = false;
				r.warnings.push('Нет цены закрытия — количество не посчитать; повторите, когда цены загрузятся');
				continue;
			}
			r.rawQty = l.value / (r.close.price * f * rate);
			r.qty = Math.max(1, Math.round(r.rawQty));
			r.roundingPct = (Math.abs(r.qty - r.rawQty) / r.rawQty) * 100;
			if (r.roundingPct > 1) r.warnings.push(`Округление количества ${r.rawQty.toFixed(3)} → ${r.qty}: ${r.roundingPct.toFixed(1)}% — вопрос в канал`);
		}
		if (price === undefined) {
			r.ok = false;
			r.warnings.push('Нет цены: укажите price= или дождитесь загрузки цен');
			continue;
		}
		r.price = price;
		if (l.price !== undefined && r.close) {
			r.priceDiffPct = (l.price / r.close.price - 1) * 100;
			if (Math.abs(r.priceDiffPct) > 5) r.warnings.push(`Цена ${l.price} отличается от закрытия ${r.close.price} (${r.close.date}) на ${r.priceDiffPct.toFixed(1)}% — вопрос в канал`);
		}
		r.valuePc = (r.qty ?? 0) * price * f * rate;
	}
	const positions = rows.filter((r) => r.kind === 'position');
	const cash = rows.filter((r) => r.kind === 'cash');
	return {
		date,
		currency: pc,
		rows,
		total: {
			positions: positions.reduce((n, r) => n + (r.valuePc ?? 0), 0),
			cash: cash.reduce((n, r) => n + (r.amount ?? 0) * m.conv(r.currency!, pc, date), 0),
			cost: positions.reduce((n, r) => n + (r.cost ?? 0), 0)
		},
		ok: rows.every((r) => r.ok),
		/** securities to queue for prices now, so that a repeated preview finds them */
		securities: positions.map((r) => r.securityId).filter((x): x is number => !!x)
	};
}

/** Adds an ETF UCITS on the LSE to the reference by hand: not in the search, not in models; prices from Yahoo. */
export function addManualSecurity(market: Database.Database, input: { symbol: string; name: string; yahoo: string; isin?: string | null }) {
	const found = market
		.prepare(`select security_id as id from ref_provider_symbols where provider_code = 'yahoo' and provider_symbol = ?`)
		.get(input.yahoo) as { id: number } | undefined;
	if (found) return found.id;
	const id = (
		market
			.prepare(
				`insert into ref_securities (exchange_code, type, symbol, name_en, isin, currency, price_unit, manual, search)
				 values ('LSE', 'etf', ?, ?, ?, 'USD', 'USD', 1, ?) returning id`
			)
			.get(input.symbol, input.name, input.isin ?? null, searchText({ symbol: input.symbol, nameEn: input.name })) as { id: number }
	).id;
	market.prepare(`insert into ref_provider_symbols (security_id, provider_code, provider_symbol) values (?, 'yahoo', ?)`).run(id, input.yahoo);
	return id;
}

/**
 * «Перенести»: the lines that passed the preview become openings (with their purchase cost or average price),
 * deposits of the money and the accrued tax. Lines with problems are left out and listed back.
 */
export async function applyTransfer(
	app: Database.Database,
	market: Database.Database,
	portfolioId: number,
	text: string,
	opts: { get?: Fetcher; today?: string; now?: Date } = {}
) {
	const p = await previewTransfer(app, market, portfolioId, text, opts);
	const done: number[] = [];
	const skipped: { n: number; text: string; why: string }[] = [];
	app.transaction(() => {
		for (const r of p.rows) {
			if (!r.ok) {
				skipped.push({ n: r.n, text: r.text, why: r.warnings.join('; ') || r.error || 'ошибка' });
				continue;
			}
			if (r.kind === 'cash') addCash(app, market, portfolioId, { kind: 'deposit', date: p.date, amount: r.amount, currency: r.currency, note: 'перенос' }, opts.now);
			else if (r.kind === 'tax') updatePortfolio(app, portfolioId, { taxAccrued: r.amount });
			else if (r.kind === 'position') {
				let sid = r.securityId;
				if (!sid && r.found?.isNew && r.yahoo) sid = addManualSecurity(market, { symbol: r.found.symbol, name: r.found.name, yahoo: r.yahoo });
				if (!sid) continue;
				addEvent(
					app,
					market,
					{ portfolioId, securityId: sid, kind: 'opening', date: p.date, qty: r.qty, price: r.price, costTotal: r.cost, basisPrice: r.avg, note: 'перенос', confirm: true },
					opts.now
				);
				done.push(sid);
			}
		}
	})();
	return { date: p.date, added: done.length, securities: done, skipped };
}
