import type Database from 'better-sqlite3';
import type { Fetcher } from './types.js';

/**
 * Monthly prices for the quarterly model (spec section 21, T-009). Yahoo's chart API with interval=1mo gives a
 * bar per month: the close (split-adjusted) and the adjclose (also dividend-adjusted), and the month's volume.
 * Every load takes the whole 15 years: a new dividend changes the adjclose of all earlier months, and a quarter's
 * return is a ratio of two of them — mixing an old and a new adjustment would distort it. Only complete months
 * are kept. A security is loaded again once a newer complete month exists, at most every 20 days.
 */

export interface MonthRow {
	month: string;
	close: number;
	adjClose: number;
	volume: number | null;
}

export const monthlyUrl = (symbol: string, years = 15) =>
	`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${years}y&interval=1mo&events=div%2Csplit&includeAdjustedClose=true`;

const monthOf = (sec: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(new Date(sec * 1000)).slice(0, 7);

/** the month of a date in Israel, YYYY-MM */
export const currentMonth = (now = new Date()) => monthOf(now.getTime() / 1000, 'Asia/Jerusalem');

/** the last complete month before `now`: in November 2026 — 2026-10 */
export function lastCompleteMonth(now = new Date()) {
	const [y, m] = currentMonth(now).split('-').map(Number);
	return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function parseMonthly(body: string, now = new Date()): { unit: string | null; rows: MonthRow[] } {
	const r = JSON.parse(body)?.chart?.result?.[0];
	if (!r) return { unit: null, rows: [] };
	const tz: string = r.meta?.exchangeTimezoneName ?? 'UTC';
	const q = r.indicators?.quote?.[0] ?? {};
	const adj = r.indicators?.adjclose?.[0]?.adjclose ?? [];
	const done = currentMonth(now);
	const by = new Map<string, MonthRow>();
	(r.timestamp ?? []).forEach((t: number, i: number) => {
		const close = q.close?.[i];
		const a = adj[i] ?? close;
		if (typeof close !== 'number' || !(close > 0) || typeof a !== 'number' || !(a > 0)) return;
		// a bar is stamped with the first day of its month in the exchange's time zone
		const month = monthOf(t, tz);
		if (month >= done) return; // the month still runs
		const v = q.volume?.[i];
		// the last bar of a month can repeat (a forming bar): the later one wins
		by.set(month, { month, close, adjClose: a, volume: typeof v === 'number' ? v : null });
	});
	const rows = [...by.values()].sort((x, y) => x.month.localeCompare(y.month));
	// a split Yahoo has not adjusted the history for (EMBJ 4:1, 16.11.2026): the months before it into the new scale
	// — only when the jump around it is nearer the ratio than to no change (an adjusted history is left as it is)
	for (const sp of Object.values((r.events?.splits ?? {}) as Record<string, { date: number; numerator: number; denominator: number }>)) {
		const ratio = sp.numerator / sp.denominator;
		if (!(ratio > 0) || ratio === 1) continue;
		const m = monthOf(sp.date, tz);
		const i = rows.findIndex((x) => x.month >= m);
		if (i <= 0) continue;
		// the month of the split mixes both scales: compare the month before with the month after it, if there is one
		const a = rows[i - 1].close;
		const b = (rows[i].month === m ? rows[i + 1] ?? rows[i] : rows[i]).close;
		const jump = Math.log(a / b);
		if (Math.abs(jump - Math.log(ratio)) >= Math.abs(jump)) continue;
		for (let j = 0; j < rows.length && rows[j].month < m; j++) rows[j] = { ...rows[j], close: rows[j].close / ratio, adjClose: rows[j].adjClose / ratio };
	}
	return { unit: r.meta?.currency ?? null, rows };
}

export interface MonthlySec {
	id: number;
	symbol: string;
	yahoo: string;
}

/**
 * The shares (not funds) of the base with a Yahoo symbol, and the benchmarks, that need a load: never loaded,
 * or a newer complete month exists and the last load is older than 20 days (or 7 after an error).
 */
export function monthlyDue(market: Database.Database, now = new Date(), limit = 100_000): MonthlySec[] {
	const want = lastCompleteMonth(now);
	const rows = market
		.prepare(
			`select s.id, s.symbol, p.provider_symbol as yahoo, l.fetched_at as at, l.status, l.last_month as last
			   from ref_securities s
			   join ref_provider_symbols p on p.security_id = s.id and p.provider_code = 'yahoo'
			   left join ops_monthly_loads l on l.security_id = s.id
			  where (s.type = 'stock' and s.active = 1 and s.manual = 0) or s.is_benchmark = 1
			  order by l.fetched_at is not null, l.fetched_at, s.id`
		)
		.all() as (MonthlySec & { at: string | null; status: string | null; last: string | null })[];
	const DAY = 86_400_000;
	return rows
		.filter((r) => {
			if (!r.at) return true;
			const age = now.getTime() - Date.parse(r.at);
			if (r.status === 'error') return age > 7 * DAY;
			if (r.status === 'none') return age > 30 * DAY;
			return (r.last ?? '') < want && age > 20 * DAY;
		})
		.slice(0, limit)
		.map(({ id, symbol, yahoo }) => ({ id, symbol, yahoo }));
}

export interface MonthlySummary {
	securities: number;
	loaded: number;
	none: number;
	rows: number;
	errors: string[];
	ms: number;
}

/** loads `secs` one by one (with a pause: the provider is free and must not be pushed) */
export async function loadMonthly(market: Database.Database, secs: MonthlySec[], get: Fetcher, opts: { now?: Date; pause?: number } = {}): Promise<MonthlySummary> {
	const t0 = Date.now();
	const now = opts.now ?? new Date();
	const at = now.toISOString();
	const s: MonthlySummary = { securities: secs.length, loaded: 0, none: 0, rows: 0, errors: [], ms: 0 };
	const del = market.prepare('delete from market_prices_monthly where security_id = ?');
	const put = market.prepare(
		`insert into market_prices_monthly (security_id, month, close, adj_close, volume, provider_code, fetched_at) values (?, ?, ?, ?, ?, 'yahoo', ?)`
	);
	const mark = market.prepare(
		`insert into ops_monthly_loads (security_id, fetched_at, status, months, first_month, last_month, error) values (?, ?, ?, ?, ?, ?, ?)
		 on conflict (security_id) do update set fetched_at = excluded.fetched_at, status = excluded.status, months = excluded.months,
		   first_month = excluded.first_month, last_month = excluded.last_month, error = excluded.error`
	);
	// one security's months are replaced whole, in one transaction (the adjustment of all of them changes together)
	const save = market.transaction((id: number, rows: MonthRow[]) => {
		del.run(id);
		for (const r of rows) put.run(id, r.month, r.close, r.adjClose, r.volume, at);
		mark.run(id, at, 'ok', rows.length, rows[0].month, rows.at(-1)!.month, null);
	});
	for (const sec of secs) {
		try {
			const body = (await get(monthlyUrl(sec.yahoo))).toString('utf8');
			const { rows } = parseMonthly(body, now);
			if (!rows.length) {
				mark.run(sec.id, at, 'none', 0, null, null, null);
				s.none++;
			} else {
				save(sec.id, rows);
				s.loaded++;
				s.rows += rows.length;
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			// 404: Yahoo does not know the symbol
			if (/\b404\b/.test(msg)) {
				mark.run(sec.id, at, 'none', 0, null, null, null);
				s.none++;
			} else {
				mark.run(sec.id, at, 'error', 0, null, null, msg.slice(0, 200));
				s.errors.push(`${sec.symbol}: ${msg}`);
			}
		}
		if (opts.pause !== 0) await new Promise((r) => setTimeout(r, opts.pause ?? 250));
	}
	s.ms = Date.now() - t0;
	return s;
}

/**
 * The check of the spec: a monthly close agrees with the daily close of the month's last trading day (both
 * split-adjusted). A sample — some securities that have daily prices, their last 12 months — read by index only:
 * a check over the whole tables blocked the server for minutes on the NAS (19.11.2026).
 */
export function checkMonthlyAgainstDaily(market: Database.Database, securities = 40) {
	const ids = (
		market
			.prepare(
				`select security_id as id from ops_monthly_loads l where status = 'ok'
				   and exists (select 1 from market_prices_daily d where d.security_id = l.security_id) order by random() limit ?`
			)
			.all(securities) as { id: number }[]
	).map((r) => r.id);
	const months = market.prepare('select month, close from market_prices_monthly where security_id = ? order by month desc limit 12');
	const lastDay = market.prepare('select date, close from market_prices_daily where security_id = ? and date >= ? and date < ? order by date desc limit 1');
	const next = (m: string) => {
		const [y, mo] = m.split('-').map(Number);
		return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
	};
	let checked = 0;
	const bad: { id: number; month: string; mc: number; dc: number }[] = [];
	for (const id of ids)
		for (const { month, close } of months.all(id) as { month: string; close: number }[]) {
			const d = lastDay.get(id, `${month}-01`, next(month)) as { date: string; close: number } | undefined;
			if (!d) continue;
			checked++;
			if (Math.abs(close / d.close - 1) > 0.01) bad.push({ id, month, mc: close, dc: d.close });
		}
	return { checked, agree: checked - bad.length, bad: bad.slice(0, 10) };
}
