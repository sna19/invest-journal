import type Database from 'better-sqlite3';
import { HttpError } from './http.js';
import { saveRaw } from './pipeline.js';
import type { Fetcher } from './types.js';
import { fetchPrices, parseChart, YAHOO, type ActionRow, type PriceRow } from './yahoo.js';
import type { MarketDb } from '../db.js';

/**
 * Spec section 14 — prices of one security over a period through the five steps: get (with retries) → keep the
 * raw answer → parse → check → merge. Rows that break a rule go to ops_quality_issues, not to the table.
 */

export interface Sec {
	id: number;
	symbol: string;
	exchangeCode: string;
	priceUnit: string;
	isBenchmark: boolean;
	/** US | TASE — whose trading days apply */
	calendar: string;
	yahoo: string;
}

export interface LoadResult {
	status: 'ok' | 'none' | 'error';
	received: number;
	added: number;
	updated: number;
	issues: number;
	/** a split the base did not know: the provider rewrote the history, load it again */
	newSplit: boolean;
	error?: string;
}

export interface Ctx {
	db: MarketDb;
	sqlite: Database.Database;
	get: Fetcher;
	rawDir: string;
	runId: number;
	/** today, YYYY-MM-DD */
	day: string;
}

/** A security as the loaders need it, with its Yahoo name and calendar. */
export function securitiesForPrices(sqlite: Database.Database, ids?: number[]): Sec[] {
	const rows = sqlite
		.prepare(
			`select s.id, s.symbol, s.exchange_code as exchangeCode, s.price_unit as priceUnit, s.is_benchmark as isBenchmark,
			        case e.country when 'IL' then 'TASE' else 'US' end as calendar, p.provider_symbol as yahoo
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code
			   join ref_provider_symbols p on p.security_id = s.id and p.provider_code = 'yahoo'
			  ${ids ? `where s.id in (${ids.map(Number).join(',') || 'null'})` : ''}`
		)
		.all() as (Omit<Sec, 'isBenchmark'> & { isBenchmark: number })[];
	return rows.map((r) => ({ ...r, isBenchmark: !!r.isBenchmark }));
}

/** The exchange's weekend: US Sat–Sun; TASE Fri–Sat until 2026-01-02, Sat–Sun since (it moved to Mon–Fri). */
export function isWeekend(calendar: string, date: string) {
	const d = new Date(date + 'T12:00:00Z').getUTCDay();
	if (calendar === 'TASE' && date < '2026-01-04') return d === 5 || d === 6;
	return d === 0 || d === 6;
}

/**
 * ×100 with the day's own move on top (AMPA 28→29.04.2026: 16.53 shekels → 1757 agorot, ×106): no real price
 * moves 30-fold in a day, and splits come already adjusted from the provider.
 */
/** A price for a message: 4 significant digits, no float tails (240.60000610351562 → 240.6). */
const n = (v: number | null) => (v === null ? '—' : String(Number(v.toPrecision(Math.max(4, Math.ceil(Math.log10(Math.abs(v) + 1)))))));

const isHundred = (q: number) => q > 30 && q < 300;
const isHundredth = (q: number) => q > 1 / 300 && q < 1 / 30;

/**
 * TASE shares in agorot: Yahoo gives parts of some histories in shekels (AMPA up to 15.05.2026: 16.67, from
 * 18.05.2026: 1652 — checked against the TASE site 15.11.2026). The latest part of the series is in the unit
 * the answer declares (ILA), so the series is walked from its end back and a close exactly ×100 or ÷100 off the
 * next one is brought to the unit of the newer part. Returns the factor applied per date.
 */
export function normalizeAgorot(rows: PriceRow[]): Map<string, number> {
	const scaled = new Map<string, number>();
	let ref: number | null = null;
	for (let i = rows.length - 1; i >= 0; i--) {
		const r = rows[i];
		if (!(r.close > 0)) continue;
		if (ref !== null) {
			const q = r.close / ref;
			const k = isHundredth(q) ? 100 : isHundred(q) ? 0.01 : 1;
			if (k !== 1) {
				for (const f of ['open', 'high', 'low', 'close'] as const) if (r[f] !== null) r[f] = (r[f] as number) * k;
				scaled.set(r.date, k);
			}
		}
		ref = r.close;
	}
	return scaled;
}

/**
 * Step 4. Pure, so the rules are tested on their own. Rules of spec section 14, adapted to what the data are
 * (15.11.2026, stage 3 acceptance on 30 TASE shares over 10 years):
 * — close > 0; low ≤ close ≤ high; volume ≥ 0;
 * — an open outside [low, high] (TASE's opening auction often is) drops the open, not the row;
 * — on TASE a close outside Yahoo's [low, high] keeps the close and drops the range: the official close comes
 *   from the closing auction, Yahoo's range covers the continuous session only (thin shares often have high = low);
 * — the exchange's weekend is refused; a weekday the benchmark lacks is kept (the index series has holes);
 * — the unit: for a share in agorot, days ×100 / ÷100 off are brought to agorot (normalizeAgorot, and against the
 *   last stored close); for anything else such a day is refused as agorot and shekels mixed up;
 * — a close more than 50% off the last accepted close without a corporate action waits for confirmation and is
 *   kept out. Two days in a row at the new level confirm it: the second is accepted, so a real level change
 *   loses only its first day.
 */
export function checkPrices(
	input: PriceRow[],
	opts: {
		prevClose: number | null;
		actionDates: Set<string>;
		calendar: Set<string> | null;
		calendarMax: string | null;
		calendarName?: string;
		/** the security is quoted in agorot (ILA) */
		agorot?: boolean;
		/** jump days a person looked at: «Цена верна» — accepted as is; «Цена ошибочна» — left out quietly */
		confirmed?: Set<string>;
		rejected?: Set<string>;
	}
) {
	const good: PriceRow[] = [];
	const issues: { date: string; rule: string; detail: string; row?: PriceRow }[] = [];
	/** known, not a problem: kept rows whose day range was dropped or whose unit was brought to agorot */
	const known: { date: string; rule: string; detail: string }[] = [];
	const rows = input.map((r) => ({ ...r }));
	const scaled = opts.agorot ? normalizeAgorot(rows) : new Map<string, number>();
	const far = (a: number, b: number) => Math.abs(a / b - 1) > 0.5;
	let accepted = opts.prevClose;
	/** the provider's previous close when that day was refused as a jump */
	let pending: number | null = null;
	for (const r of rows) {
		const bad = (rule: string, detail: string) => issues.push({ date: r.date, rule, detail });
		if (!(r.close > 0)) {
			bad('price.not_positive', `close ${r.close}`);
			continue;
		}
		if (r.volume !== null && r.volume < 0) {
			bad('price.volume', `volume ${r.volume}`);
			continue;
		}
		if (opts.calendarName && isWeekend(opts.calendarName, r.date)) {
			bad('price.not_trading_day', r.date);
			continue;
		}
		// the batch against what is stored: the whole batch may be in the other unit
		const q = accepted !== null ? r.close / accepted : 1;
		if (isHundred(q) || isHundredth(q)) {
			if (!opts.agorot) {
				bad('price.unit_glitch', `${n(accepted)} → ${n(r.close)}, ×${q >= 1 ? Math.round(q) : '1/' + Math.round(1 / q)}`);
				continue;
			}
			const k = isHundredth(q) ? 100 : 0.01;
			for (const f of ['open', 'high', 'low', 'close'] as const) if (r[f] !== null) r[f] = (r[f] as number) * k;
			scaled.set(r.date, (scaled.get(r.date) ?? 1) * k);
		}
		if (scaled.has(r.date)) known.push({ date: r.date, rule: 'price.unit_converted', detail: `×${scaled.get(r.date) === 100 ? '100 (шекели → агороты)' : '1/100'}` });
		const eps = r.close * 1e-6;
		if (r.high !== null && r.low !== null) {
			const range = `o ${r.open} h ${r.high} l ${r.low} c ${r.close}`;
			if (r.low > r.high + eps) {
				bad('price.ohlc', range);
				continue;
			}
			if (r.close < r.low - eps || r.close > r.high + eps) {
				if (opts.calendarName !== 'TASE') {
					bad('price.ohlc', range);
					continue;
				}
				known.push({ date: r.date, rule: 'price.ohlc_auction', detail: range });
				r.open = r.high = r.low = null;
			} else if (r.open !== null && (r.open < r.low - eps || r.open > r.high + eps)) r.open = null;
		}
		if (opts.rejected?.has(r.date)) continue;
		if (opts.confirmed?.has(r.date) && accepted !== null && far(r.close, accepted)) {
			// confirmed by a person: kept, but not a reference for the next days (a one-day spike would raise another)
			good.push(r);
			continue;
		}
		if (accepted !== null && far(r.close, accepted) && !opts.actionDates.has(r.date) && !opts.confirmed?.has(r.date)) {
			if (pending === null || far(r.close, pending)) {
				issues.push({ date: r.date, rule: 'price.jump', row: { ...r }, detail: '' });
				issues.at(-1)!.detail = ( `${n(accepted)} → ${n(r.close)} (${r.close > accepted ? '+' : ''}${((r.close / accepted - 1) * 100).toFixed(1).replace('.', ',')}%)`);
				pending = r.close;
				continue;
			}
			// the second day at the new level: the change is real
		}
		pending = null;
		accepted = r.close;
		good.push(r);
	}
	return { good, issues, known, scaled };
}

/**
 * Cumulative dividend factors (CRSP style): every dividend D on ex-date e multiplies all earlier prices by
 * (1 − D / close of the last trading day before e). A row (e, F) means: prices before e × F.
 */
export function computeFactors(dividends: { exDate: string; amount: number }[], closeBefore: (date: string) => number | null) {
	const out: { date: string; factor: number }[] = [];
	let f = 1;
	for (const d of [...dividends].sort((a, b) => b.exDate.localeCompare(a.exDate))) {
		const c = closeBefore(d.exDate);
		if (!c || d.amount <= 0 || d.amount >= c) continue;
		f *= 1 - d.amount / c;
		out.push({ date: d.exDate, factor: f });
	}
	return out.reverse();
}

export function recomputeFactors(sqlite: Database.Database, securityId: number) {
	const divs = sqlite
		.prepare(`select ex_date as exDate, amount from market_corporate_actions where security_id = ? and kind = 'dividend' and amount > 0`)
		.all(securityId) as { exDate: string; amount: number }[];
	const before = sqlite.prepare(`select close from market_prices_daily where security_id = ? and date < ? order by date desc limit 1`);
	const factors = computeFactors(divs, (d) => (before.get(securityId, d) as { close: number } | undefined)?.close ?? null);
	sqlite.transaction(() => {
		sqlite.prepare('delete from market_adjustment_factors where security_id = ?').run(securityId);
		const ins = sqlite.prepare('insert into market_adjustment_factors (security_id, date, factor) values (?, ?, ?)');
		for (const f of factors) ins.run(securityId, f.date, f.factor);
	})();
	return factors.length;
}

/** Trading days of a calendar = the benchmark's real trading days (spec section 14). */
function addTradingDays(sqlite: Database.Database, calendar: string, dates: string[]) {
	const ins = sqlite.prepare('insert or ignore into ref_trading_days (exchange_code, date) values (?, ?)');
	for (const d of dates) ins.run(calendar, d);
}

export async function loadSecurity(ctx: Ctx, sec: Sec, from: string, to: string): Promise<LoadResult> {
	const { sqlite } = ctx;
	const res: LoadResult = { status: 'ok', received: 0, added: 0, updated: 0, issues: 0, newSplit: false };
	// one issue per security, day and rule: a reload does not repeat it, and a person's decision stays
	const issueInsert = sqlite.prepare(
		`insert into ops_quality_issues (run_id, security_id, date, rule, detail, status, payload)
		 select ?, ?, ?, ?, ?, ?, ? where not exists (
		   select 1 from ops_quality_issues where security_id = ? and date is ? and rule = ?)`
	);
	// an open issue raised before the row was kept (older loads) gets it now, so «Цена верна» can work
	const issuePayload = sqlite.prepare(
		`update ops_quality_issues set payload = ? where security_id = ? and date is ? and rule = ? and status = 'open' and payload is null`
	);
	const issue = {
		run: (runId: number, securityId: number, date: string | null, rule: string, detail: string, status: string, payload: string | null = null) => {
			issueInsert.run(runId, securityId, date, rule, detail, status, payload, securityId, date, rule);
			if (payload) issuePayload.run(payload, securityId, date, rule);
		}
	};
	const decided = (status: string) =>
		new Set(
			(sqlite.prepare(`select date from ops_quality_issues where security_id = ? and rule = 'price.jump' and status = ?`).all(sec.id, status) as {
				date: string;
			}[]).map((r) => r.date)
		);

	// 1 get
	let raw;
	try {
		raw = await fetchPrices(ctx.get, sec.yahoo, from, to);
	} catch (e) {
		if (e instanceof HttpError && e.status === 404) {
			sqlite.prepare(`update ref_securities set price_status = 'none' where id = ?`).run(sec.id);
			return { ...res, status: 'none' };
		}
		return { ...res, status: 'error', error: (e as Error).message };
	}
	// 2 keep the raw answer
	saveRaw(ctx.db, ctx.rawDir, YAHOO, ctx.runId, ctx.day, [raw]);
	// 3 parse
	let parsed;
	try {
		parsed = parseChart(raw, from, to);
	} catch (e) {
		return { ...res, status: 'error', error: `parse: ${(e as Error).message}` };
	}
	if (!parsed.unit && !parsed.rows.length) {
		sqlite.prepare(`update ref_securities set price_status = 'none' where id = ?`).run(sec.id);
		return { ...res, status: 'none' };
	}
	res.received = parsed.rows.length;

	// 4 check: the unit first — shekels and agorot must never mix
	const hasPrices = !!sqlite.prepare('select 1 from market_prices_daily where security_id = ? limit 1').get(sec.id);
	if (parsed.unit && parsed.unit !== sec.priceUnit) {
		if (!hasPrices && ['USD', 'ILS', 'ILA'].includes(parsed.unit)) {
			// the listing guessed the unit; the price provider knows it — adopt before the first price is stored
			sqlite.prepare('update ref_securities set price_unit = ? where id = ?').run(parsed.unit, sec.id);
			issue.run(ctx.runId, sec.id, null, 'price.unit_adopted', `${sec.priceUnit} → ${parsed.unit}`, 'resolved');
			sec.priceUnit = parsed.unit;
		} else {
			issue.run(ctx.runId, sec.id, null, 'price.unit_mismatch', `base ${sec.priceUnit}, provider ${parsed.unit}`, 'open');
			return { ...res, status: 'error', issues: 1, error: `unit ${parsed.unit} ≠ ${sec.priceUnit}` };
		}
	}
	const first = parsed.rows[0]?.date;
	const prevClose = first
		? ((sqlite.prepare('select close from market_prices_daily where security_id = ? and date < ? order by date desc limit 1').get(sec.id, first) as
				| { close: number }
				| undefined)?.close ?? null)
		: null;
	const { good, issues, known, scaled } = checkPrices(parsed.rows, {
		prevClose,
		actionDates: new Set(parsed.actions.map((a) => a.exDate)),
		calendar: null,
		calendarMax: null,
		calendarName: sec.calendar,
		agorot: sec.priceUnit === 'ILA',
		confirmed: decided('confirmed'),
		rejected: decided('rejected')
	});
	// a dividend paid in the converted part of the history is in the same wrong unit as those closes
	if (scaled.size) {
		const dates = parsed.rows.map((r) => r.date);
		for (const a of parsed.actions) {
			if (a.kind !== 'dividend' || a.amount === null) continue;
			const day = dates.find((d) => d >= a.exDate);
			const k = day ? scaled.get(day) : undefined;
			if (k) a.amount *= k;
		}
	}
	res.issues = issues.length;

	// 5 merge: insert or update by (security, date); a rerun changes nothing
	sqlite.transaction(() => {
		for (const i of issues) issue.run(ctx.runId, sec.id, i.date, i.rule, i.detail, 'open', i.row ? JSON.stringify(i.row) : null);
		for (const i of known) issue.run(ctx.runId, sec.id, i.date, i.rule, i.detail, 'known');
		const old = sqlite.prepare('select open, high, low, close, volume from market_prices_daily where security_id = ? and date = ?');
		const up = sqlite.prepare(
			`insert into market_prices_daily (security_id, date, open, high, low, close, volume, provider_code, run_id)
			 values (?, ?, ?, ?, ?, ?, ?, 'yahoo', ?)
			 on conflict (security_id, date) do update set open = excluded.open, high = excluded.high, low = excluded.low,
			   close = excluded.close, volume = excluded.volume, provider_code = excluded.provider_code, run_id = excluded.run_id`
		);
		for (const r of good) {
			const o = old.get(sec.id, r.date) as PriceRow | undefined;
			if (o && o.close === r.close && o.open === r.open && o.high === r.high && o.low === r.low && o.volume === r.volume) continue;
			up.run(sec.id, r.date, r.open, r.high, r.low, r.close, r.volume, ctx.runId);
			if (o) res.updated++;
			else res.added++;
		}
		if (sec.isBenchmark) addTradingDays(sqlite, sec.calendar, good.map((r) => r.date));
		sqlite.prepare(`update ref_securities set price_status = 'ok' where id = ?`).run(sec.id);
	})();

	if (mergeActions(sqlite, sec.id, parsed.actions, hasPrices)) res.newSplit = true;
	return res;
}

/** Upserts actions; recomputes factors when a dividend is new; tells whether a split is new. */
function mergeActions(sqlite: Database.Database, securityId: number, actions: ActionRow[], hadPrices: boolean) {
	let newDividend = false;
	let newSplit = false;
	const has = sqlite.prepare('select amount, ratio from market_corporate_actions where security_id = ? and ex_date = ? and kind = ?');
	const ins = sqlite.prepare(
		`insert into market_corporate_actions (security_id, ex_date, kind, ratio, amount, provider_code) values (?, ?, ?, ?, ?, 'yahoo')
		 on conflict (security_id, ex_date, kind) do update set ratio = excluded.ratio, amount = excluded.amount`
	);
	for (const a of actions) {
		const o = has.get(securityId, a.exDate, a.kind) as { amount: number | null; ratio: number | null } | undefined;
		if (o && o.amount === a.amount && o.ratio === a.ratio) continue;
		ins.run(securityId, a.exDate, a.kind, a.ratio, a.amount);
		if (a.kind === 'dividend') newDividend = true;
		else if (!o && hadPrices) newSplit = true;
	}
	if (newDividend || newSplit) recomputeFactors(sqlite, securityId);
	return newSplit;
}
