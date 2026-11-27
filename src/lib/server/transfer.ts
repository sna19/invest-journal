import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { unitFactor } from '../portfolio.js';
import { searchText } from './market/pipeline.js';
import { chartUrl } from './market/yahoo.js';
import type { Fetcher } from './market/types.js';
import { addCash, addEvent, marketView, moneyOf, portfolioView, reverseEvent, security, updatePortfolio } from './portfolio.js';

/**
 * Spec section 18 «Перенос существующих позиций» — positions bought before the portfolio was kept, entered as a list
 * pasted into the app (the portfolio's data never goes into the repository). One line per position:
 *
 *   SCHD 40.5 30.00                 symbol, quantity, the transfer day's price (a broker with fractional shares)
 *   ESLT value=5000 cost=4000          symbol, the position's value and its purchase cost in the portfolio's currency
 *                                      (a broker without them): quantity = value / the day's close, rounded to whole shares
 *   yahoo:CSPX.L value=10000 cost=9000   an ETF UCITS on the LSE, added to the reference by hand
 *   cash ILS 5290.91 · cash USD 663.15 · tax 2881.45 · date 2026-11-17
 *   (cash — the broker's balance of that currency now: the app deposits or withdraws the difference from what the
 *   portfolio holds, dated no later than its first trade, so a portfolio of hand-entered purchases is not «minus»)
 *
 * Optional on a position line: avg=<average price> or cost=<whole purchase cost>, price=<price>. First a preview
 * (matches, quantities, roundings over 1%, prices off the base by more than 5%), then «Перенести» writes it all.
 *
 * Owner 27.11.2026 («сверь, что уже есть, недостающее добавь, сверь контрольные суммы»): the whole broker list can be
 * pasted into a portfolio that already holds some of it. Each line is matched with the portfolio's holding of the
 * security: the same quantity — «уже есть», nothing is added (an average price off by more than 1% is reported);
 * another quantity — reported, nothing is added (a trade fixes it); none — added. Holdings missing from the list are
 * reported too. Duplicates (owner 27.11.2026, «разбери дубликаты»): a holding bigger than the broker's by exactly some
 * repeated purchases (the same kind, date, quantity and price) gets those repeats reversed by «Перенести»; a security
 * held here on another exchange under the same symbol is shown, not added twice. `total 150000` — the broker's value of the positions today: the sum of the lines at today's prices
 * is checked against it.
 */

export interface Line {
	n: number;
	text: string;
	kind: 'position' | 'cash' | 'tax' | 'total' | 'date' | 'skip' | 'error';
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
			if (head === 'total') {
				if (!NUM.test(parts[1] ?? '')) return { n, text: raw, kind: 'error' as const, error: 'total сумма' };
				return { n, text: raw, kind: 'total' as const, amount: toNum(parts[1]) };
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
	/** today's value in the portfolio's currency, by the latest price (for the check against the broker's total) */
	valueNow?: number;
	/** against the portfolio's holding: add — not there; same — the same quantity; differs — another quantity */
	match?: 'add' | 'same' | 'differs' | 'dedupe' | 'other_listing';
	/** dedupe: the repeated purchase events to reverse, so that the holding comes to the broker's quantity */
	dedupe?: { id: number; date: string; qty: number; price: number | null }[];
	existing?: { qty: number; avgPrice: number | null };
	/** cash: what the portfolio holds of the currency now, and the deposit (+) or withdrawal (−) that brings it there */
	cashNow?: number;
	cashMove?: number;
	cashDate?: string;
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
	// what the portfolio holds now, by security
	const held = new Map<number, { qty: number; avgPrice: number | null; symbol: string; positions: number[] }>();
	const view = portfolioView(app, market, portfolioId, today);
	const firstTrade = (app.prepare(`select min(e.date) as d from position_events e join positions s on s.id = e.position_id where s.portfolio_id = ? and e.cancelled_at is null`).get(portfolioId) as { d: string | null }).d;
	for (const x of (view?.positions ?? []).filter((x) => x.qty > 1e-9 && x.stage !== 'closed')) {
		const h = held.get(x.securityId);
		if (h) ((h.qty += x.qty), h.positions.push(x.id));
		else held.set(x.securityId, { qty: x.qty, avgPrice: x.avgPrice, symbol: x.symbol, positions: [x.id] });
	}
	// the purchases still counted (not cancelled, not reversed) of the given positions, oldest first
	const buysOf = (ids: number[]) =>
		app
			.prepare(
				`select e.id, e.kind, e.date, e.qty, e.price from position_events e
				  where e.position_id in (${ids.map(() => '?').join(',')}) and e.kind in ('buy', 'opening') and e.cancelled_at is null
				    and not exists (select 1 from position_events r where r.reverses_event_id = e.id and r.cancelled_at is null)
				  order by e.date, e.id`
			)
			.all(...ids) as { id: number; kind: string; date: string; qty: number; price: number | null }[];
	const rows: Row[] = [];
	for (const l of lines) {
		if (l.kind === 'skip' || l.kind === 'date') continue;
		const r: Row = { ...l, warnings: [], ok: l.kind !== 'error' };
		rows.push(r);
		if (l.kind === 'cash') {
			r.cashNow = view?.summary.balances.find((b) => b.currency === l.currency)?.amount ?? 0;
			r.cashMove = Math.round((l.amount! - r.cashNow) * 100) / 100;
			r.cashDate = firstTrade && firstTrade < date ? firstTrade : date;
			if (Math.abs(r.cashMove) < 0.01) r.warnings.push('Деньги уже совпадают с брокером');
			else if (Math.abs(r.cashNow) >= 0.01) r.warnings.push(`В портфеле сейчас ${Math.round(r.cashNow * 100) / 100} ${l.currency}: ${r.cashMove > 0 ? 'взнос' : 'вывод'} ${Math.abs(r.cashMove)} от ${r.cashDate}`);
		}
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
			if (!day) r.warnings.push('Цен этой бумаги в базе ещё нет — сверить цену нельзя; история загрузится сама');
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
		if (r.securityId) {
			const now = m.live(r.securityId)?.price ?? m.last(r.securityId)?.close ?? null;
			if (now !== null) r.valueNow = (r.qty ?? 0) * now * f * m.conv(moneyOf(unit), pc, today);
			const h = held.get(r.securityId);
			// the same symbol held here on another exchange (a share listed in New York and Tel Aviv)
			const twin = !h ? [...held.entries()].find(([id, x]) => id !== r.securityId && x.symbol === r.found?.symbol) : undefined;
			if (twin) {
				r.match = 'other_listing';
				r.warnings.push(`${twin[1].symbol} уже есть в портфеле на другой бирже (${twin[1].qty}) — не добавляется; если у брокера она на этой бирже, удали ту позицию и проверь ещё раз`);
			} else if (!h) r.match = 'add';
			else {
				r.existing = { qty: h.qty, avgPrice: h.avgPrice };
				if (Math.abs(h.qty - (r.qty ?? 0)) < 1e-6) {
					r.match = 'same';
					r.warnings.push(`Уже есть в портфеле: ${h.qty} — совпадает, не добавляется`);
					const avg = l.avg ?? (l.cost !== undefined && r.qty ? l.cost / (r.qty * f * rate) : undefined);
					if (avg !== undefined && h.avgPrice && Math.abs(avg / h.avgPrice - 1) > 0.01) r.warnings.push(`Средняя цена в портфеле ${+h.avgPrice.toFixed(4)}, у брокера ${+avg.toFixed(4)} — поправь «Цену покупки» в карточке`);
				} else {
					// more than the broker by exactly some repeats of a purchase — a double entry
					const extra = h.qty - (r.qty ?? 0);
					const seen = new Set<string>();
					const repeats: { id: number; date: string; qty: number; price: number | null }[] = [];
					for (const e of buysOf(h.positions)) {
						const k = `${e.kind}|${e.date}|${e.qty}|${e.price}`;
						if (seen.has(k)) repeats.push({ id: e.id, date: e.date, qty: e.qty, price: e.price });
						else seen.add(k);
					}
					let sum = 0;
					const pick: typeof repeats = [];
					for (const e of repeats.reverse()) if (sum + e.qty <= extra + 1e-6) ((sum += e.qty), pick.push(e));
					if (extra > 0 && Math.abs(sum - extra) < 1e-6) {
						r.match = 'dedupe';
						r.dedupe = pick;
						r.warnings.push(`Дубликат: в портфеле ${h.qty}, у брокера ${r.qty}; повтор ${pick.map((e) => `${e.date} × ${e.qty}`).join(', ')} будет сторнирован`);
					} else {
						r.match = 'differs';
						r.warnings.push(`В портфеле ${h.qty}, у брокера ${r.qty} — не добавляется: внеси разницу сделкой «Купил» / «Продал»`);
					}
				}
			}
		}
	}
	// held here but not in the broker's list
	const listed = new Set(rows.map((r) => r.securityId).filter((x): x is number => !!x));
	for (const r of rows) if (r.match === 'other_listing') for (const [id, x] of held) if (x.symbol === r.found?.symbol) listed.add(id);
	const notListed = [...held.entries()].filter(([id]) => !listed.has(id)).map(([, h]) => ({ symbol: h.symbol, qty: h.qty }));
	const brokerTotal = rows.find((r) => r.kind === 'total')?.amount ?? null;
	const totalNow = rows.filter((r) => r.kind === 'position').reduce((n, r) => n + (r.valueNow ?? 0), 0);
	const positions = rows.filter((r) => r.kind === 'position');
	const cash = rows.filter((r) => r.kind === 'cash');
	return {
		date,
		currency: pc,
		rows,
		total: {
			positions: positions.reduce((n, r) => n + (r.valuePc ?? 0), 0),
			cash: cash.reduce((n, r) => n + (r.amount ?? 0) * m.conv(r.currency!, pc, date), 0),
			/** the money's moves «Перенести» makes, in the portfolio's currency */
			cashMove: cash.reduce((n, r) => n + (r.cashMove ?? 0) * m.conv(r.currency!, pc, date), 0),
			cost: positions.reduce((n, r) => n + (r.cost ?? 0), 0),
			/** the lines at today's prices, and the broker's own total to check it against */
			now: totalNow,
			broker: brokerTotal
		},
		match: { add: positions.filter((r) => r.match === 'add').length, same: positions.filter((r) => r.match === 'same').length, differs: positions.filter((r) => r.match === 'differs' || r.match === 'other_listing').length, dedupe: positions.filter((r) => r.match === 'dedupe').length, notListed },
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
	const deduped: number[] = [];
	app.transaction(() => {
		for (const r of p.rows) {
			if (!r.ok) {
				skipped.push({ n: r.n, text: r.text, why: r.warnings.join('; ') || r.error || 'ошибка' });
				continue;
			}
			if (r.kind === 'position' && r.match === 'dedupe') {
				for (const e of r.dedupe ?? []) reverseEvent(app, market, e.id, 'дубликат — сверка с брокером', opts.now);
				deduped.push(r.n);
				continue;
			}
			if (r.kind === 'position' && r.match && r.match !== 'add') {
				skipped.push({ n: r.n, text: r.text, why: r.match === 'same' ? 'уже есть' : (r.warnings.at(-1) ?? 'другое количество') });
				continue;
			}
			if (r.kind === 'total') continue;
			if (r.kind === 'cash') {
				const mv = r.cashMove ?? r.amount ?? 0;
				if (Math.abs(mv) >= 0.01) addCash(app, market, portfolioId, { kind: mv > 0 ? 'deposit' : 'withdraw', date: r.cashDate ?? p.date, amount: Math.abs(mv), currency: r.currency, note: 'перенос — остаток как у брокера' }, opts.now);
			} else if (r.kind === 'tax') updatePortfolio(app, portfolioId, { taxAccrued: r.amount });
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
	return { date: p.date, added: done.length, deduped: deduped.length, securities: done, skipped };
}
