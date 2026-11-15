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

/** Step 4. Pure, so the rules are tested on their own. */
export function checkPrices(
	rows: PriceRow[],
	opts: { prevClose: number | null; actionDates: Set<string>; calendar: Set<string> | null; calendarMax: string | null }
) {
	const good: PriceRow[] = [];
	const issues: { date: string; rule: string; detail: string }[] = [];
	let prev = opts.prevClose;
	for (const r of rows) {
		const bad = (rule: string, detail: string) => issues.push({ date: r.date, rule, detail });
		if (!(r.close > 0)) {
			bad('price.not_positive', `close ${r.close}`);
			continue;
		}
		const eps = r.close * 1e-6;
		if (r.high !== null && r.low !== null) {
			const lo = Math.min(r.open ?? r.close, r.close);
			const hi = Math.max(r.open ?? r.close, r.close);
			if (r.low > lo + eps || hi > r.high + eps || r.low > r.high + eps) {
				bad('price.ohlc', `o ${r.open} h ${r.high} l ${r.low} c ${r.close}`);
				continue;
			}
		}
		if (r.volume !== null && r.volume < 0) {
			bad('price.volume', `volume ${r.volume}`);
			continue;
		}
		if (opts.calendar && opts.calendarMax && r.date <= opts.calendarMax && !opts.calendar.has(r.date)) {
			bad('price.not_trading_day', r.date);
			continue;
		}
		if (prev !== null && Math.abs(r.close / prev - 1) > 0.5 && !opts.actionDates.has(r.date)) {
			// waits for a person: kept out of the table until confirmed (spec section 14)
			bad('price.jump', `${prev} → ${r.close} (${(((r.close / prev) - 1) * 100).toFixed(1)}%) without a corporate action`);
			continue;
		}
		good.push(r);
		prev = r.close;
	}
	return { good, issues };
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
	const issue = sqlite.prepare(
		`insert into ops_quality_issues (run_id, security_id, date, rule, detail, status) values (?, ?, ?, ?, ?, ?)`
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
	let calendar: Set<string> | null = null;
	let calendarMax: string | null = null;
	if (!sec.isBenchmark && first) {
		calendar = new Set(
			(sqlite.prepare('select date from ref_trading_days where exchange_code = ? and date >= ?').all(sec.calendar, first) as { date: string }[]).map(
				(r) => r.date
			)
		);
		calendarMax = (sqlite.prepare('select max(date) as m from ref_trading_days where exchange_code = ?').get(sec.calendar) as { m: string | null }).m;
	}
	const { good, issues } = checkPrices(parsed.rows, { prevClose, actionDates: new Set(parsed.actions.map((a) => a.exDate)), calendar, calendarMax });
	res.issues = issues.length;

	// 5 merge: insert or update by (security, date); a rerun changes nothing
	sqlite.transaction(() => {
		for (const i of issues) issue.run(ctx.runId, sec.id, i.date, i.rule, i.detail, 'open');
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
