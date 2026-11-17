import type Database from 'better-sqlite3';
import { saveRaw } from './pipeline.js';
import type { MarketDb } from '../db.js';
import type { Fetcher } from './types.js';

/**
 * Spec section 18 — the USD/ILS rate for portfolios: the Bank of Israel representative rate («שער יציג»),
 * SDMX series RER_USD_ILS, CSV. Checked from the NAS on 17.11.2026: open, no key, Israeli business days only.
 * The same five steps as every provider: get → raw → parse → check → merge (a rerun adds nothing).
 */
export const BOI = 'boi';
export const USD_ILS = 'USD/ILS';

export const boiUrl = (from: string, to: string) =>
	`https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startperiod=${from}&endperiod=${to}&format=csv`;

export interface FxRow {
	date: string;
	rate: number;
}

/** Step 3: the CSV to rows; the columns are found by name, not by place. */
export function parseBoi(csv: string): FxRow[] {
	const lines = csv.replace(/\r/g, '').split('\n').filter(Boolean);
	if (!lines.length) return [];
	const head = lines[0].split(',');
	const iDate = head.indexOf('TIME_PERIOD');
	const iVal = head.indexOf('OBS_VALUE');
	if (iDate < 0 || iVal < 0) throw new Error('BOI: no TIME_PERIOD / OBS_VALUE columns');
	return lines.slice(1).map((l) => {
		const c = l.split(',');
		return { date: c[iDate], rate: Number(c[iVal]) };
	});
}

/** Step 4: a sane rate (1–10 ILS per dollar), a real date, no day-to-day jump over 10% against the day before. */
export function checkFx(rows: FxRow[], before: number | null) {
	const good: FxRow[] = [];
	const issues: { date: string | null; rule: string; detail: string }[] = [];
	let prev = before;
	for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) issues.push({ date: null, rule: 'fx.bad_date', detail: `USD/ILS ${r.date}` });
		else if (!Number.isFinite(r.rate) || r.rate < 1 || r.rate > 10) issues.push({ date: r.date, rule: 'fx.bad_rate', detail: `USD/ILS ${r.date}: ${r.rate}` });
		else if (prev !== null && Math.abs(r.rate / prev - 1) > 0.1)
			issues.push({ date: r.date, rule: 'fx.jump', detail: `USD/ILS ${r.date}: ${prev} → ${r.rate}` });
		else {
			good.push(r);
			prev = r.rate;
		}
	}
	return { good, issues };
}

export interface FxSummary {
	received: number;
	added: number;
	updated: number;
	issues: number;
}

/** Loads the rate from `from` to `to` (inclusive) into market_fx_daily. */
export async function loadFx(
	c: { db: MarketDb; sqlite: Database.Database; get: Fetcher; rawDir: string; runId: number; day: string },
	from: string,
	to: string
): Promise<FxSummary> {
	const body = await c.get(boiUrl(from, to));
	saveRaw(c.db, c.rawDir, BOI, c.runId, c.day, [{ name: `usd-ils-${from}-${to}.csv`, body }]);
	const rows = parseBoi(body.toString('utf8'));
	const before = (
		c.sqlite.prepare('select rate from market_fx_daily where pair = ? and date < ? order by date desc limit 1').get(USD_ILS, from) as
			| { rate: number }
			| undefined
	)?.rate;
	const { good, issues } = checkFx(rows, before ?? null);
	const s: FxSummary = { received: rows.length, added: 0, updated: 0, issues: issues.length };
	const old = c.sqlite.prepare('select rate from market_fx_daily where pair = ? and date = ?');
	const put = c.sqlite.prepare(
		`insert into market_fx_daily (pair, date, rate, provider_code, run_id) values (?, ?, ?, ?, ?)
		 on conflict (pair, date) do update set rate = excluded.rate, run_id = excluded.run_id`
	);
	const issue = c.sqlite.prepare(`insert into ops_quality_issues (run_id, date, rule, detail) values (?, ?, ?, ?)`);
	c.sqlite.transaction(() => {
		for (const r of good) {
			const was = old.get(USD_ILS, r.date) as { rate: number } | undefined;
			if (was && was.rate === r.rate) continue;
			put.run(USD_ILS, r.date, r.rate, BOI, c.runId);
			if (was) s.updated++;
			else s.added++;
		}
		for (const i of issues) issue.run(c.runId, i.date, i.rule, i.detail);
	})();
	return s;
}

/** ILS per dollar on a date: the last published rate on or before it (the rate is not published on weekends). */
export function fxOn(sqlite: Database.Database, date: string): number | null {
	return (
		(sqlite.prepare('select rate from market_fx_daily where pair = ? and date <= ? order by date desc limit 1').get(USD_ILS, date) as
			| { rate: number }
			| undefined)?.rate ?? null
	);
}
