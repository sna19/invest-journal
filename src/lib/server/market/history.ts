import type Database from 'better-sqlite3';
import { loadSecurity, securitiesForPrices, type Ctx, type LoadResult } from './prices.js';

/**
 * Spec section 14 — the history load goes through the ops_ingest_tasks queue (security × period), so an
 * interrupted load goes on from where it stopped: a task is «done» only after its prices are merged.
 */
export const YEARS = 10;
const MAX_ATTEMPTS = 3;

export const yearsBack = (day: string, years = YEARS) => `${Number(day.slice(0, 4)) - years}${day.slice(4)}`;

/** Queues a period for a security unless the same or a wider one is already waiting. Returns true if queued. */
export function enqueue(market: Database.Database, securityId: number, from: string, to: string) {
	const dup = market
		.prepare(
			`select 1 from ops_ingest_tasks where job = 'history' and security_id = ? and status in ('queued', 'running')
			    and period_from <= ? and period_to >= ?`
		)
		.get(securityId, from, to);
	if (dup) return false;
	market
		.prepare(`insert into ops_ingest_tasks (job, security_id, period_from, period_to, status) values ('history', ?, ?, ?, 'queued')`)
		.run(securityId, from, to);
	return true;
}

/** Ten years for every given security that has no prices yet and is not «нет цен». */
export function enqueueMissingHistory(market: Database.Database, ids: number[], day: string) {
	let n = 0;
	const hasPrices = market.prepare('select 1 from market_prices_daily where security_id = ? limit 1');
	const status = market.prepare('select price_status as s from ref_securities where id = ?');
	for (const id of ids) {
		if ((status.get(id) as { s: string | null } | undefined)?.s === 'none') continue;
		if (hasPrices.get(id)) continue;
		if (enqueue(market, id, yearsBack(day), day)) n++;
	}
	return n;
}

/** Tasks left «running» by a stopped process go back to the queue. */
export function resetRunning(market: Database.Database) {
	return market.prepare(`update ops_ingest_tasks set status = 'queued' where status = 'running'`).run().changes;
}

export interface QueueSummary {
	done: number;
	failed: number;
	none: number;
	added: number;
	updated: number;
	received: number;
	issues: number;
	errors: string[];
}

/**
 * Works the queue: benchmarks first (the trading calendar comes from them), then the rest; `parallel` at a
 * time. `stopAfter` — for tests: stop after so many tasks, as if the process were killed.
 */
export async function runQueue(ctx: Ctx, opts: { parallel?: number; stopAfter?: number; benchmarksOnly?: boolean } = {}): Promise<QueueSummary> {
	const { sqlite } = ctx;
	const sum: QueueSummary = { done: 0, failed: 0, none: 0, added: 0, updated: 0, received: 0, issues: 0, errors: [] };
	const next = sqlite.prepare(
		`select t.id, t.security_id as securityId, t.period_from as periodFrom, t.period_to as periodTo, t.attempts
		   from ops_ingest_tasks t join ref_securities s on s.id = t.security_id
		  where t.job = 'history' and t.status = 'queued' ${opts.benchmarksOnly ? 'and s.is_benchmark = 1' : ''}
		  order by s.is_benchmark desc, t.id limit 1`
	);
	const set = sqlite.prepare(`update ops_ingest_tasks set status = ?, attempts = ?, last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ?`);
	let taken = 0;
	const take = () => {
		if (opts.stopAfter !== undefined && taken >= opts.stopAfter) return null;
		const t = next.get() as { id: number; securityId: number; periodFrom: string; periodTo: string; attempts: number } | undefined;
		if (!t) return null;
		set.run('running', t.attempts + 1, null, t.id);
		taken++;
		return t;
	};
	const worker = async () => {
		for (let t = take(); t; t = take()) {
			const sec = securitiesForPrices(sqlite, [t.securityId])[0];
			let r: LoadResult;
			if (!sec) r = { status: 'error', received: 0, added: 0, updated: 0, issues: 0, newSplit: false, error: 'no Yahoo symbol' };
			else r = await loadSecurity(ctx, sec, t.periodFrom, t.periodTo);
			sum.added += r.added;
			sum.updated += r.updated;
			sum.received += r.received;
			sum.issues += r.issues;
			if (r.status === 'error') {
				const final = t.attempts + 1 >= MAX_ATTEMPTS;
				set.run(final ? 'failed' : 'queued', t.attempts + 1, r.error ?? null, t.id);
				if (final) {
					sum.failed++;
					sum.errors.push(`${sec?.symbol ?? t.securityId}: ${r.error}`);
				}
				continue;
			}
			set.run('done', t.attempts + 1, r.status === 'none' ? 'нет у поставщика цен' : null, t.id);
			if (r.status === 'none') sum.none++;
			else {
				sum.done++;
				// a reload settles the jumps it covered
				sqlite
					.prepare(
						`update ops_quality_issues set status = 'resolved' where security_id = ? and rule = 'price.jump' and status = 'open'
						    and date in (select date from market_prices_daily where security_id = ?)`
					)
					.run(t.securityId, t.securityId);
			}
		}
	};
	await Promise.all(Array.from({ length: opts.parallel ?? 4 }, worker));
	return sum;
}

/**
 * Weekly gap control: for each security, the trading days of its calendar between its first and last price
 * that have no price, queued as one period per security.
 */
export function findGaps(market: Database.Database, ids: number[]) {
	let queued = 0;
	const range = market.prepare('select min(date) as a, max(date) as b from market_prices_daily where security_id = ?');
	const cal = market.prepare(
		`select case e.country when 'IL' then 'TASE' else 'US' end as c from ref_securities s join ref_exchanges e on e.code = s.exchange_code where s.id = ?`
	);
	const missing = market.prepare(
		`select min(t.date) as a, max(t.date) as b, count(*) as n from ref_trading_days t
		  where t.exchange_code = ? and t.date between ? and ?
		    and not exists (select 1 from market_prices_daily p where p.security_id = ? and p.date = t.date)
		    and not exists (select 1 from ops_quality_issues q where q.security_id = ? and q.date = t.date and q.status = 'open')`
	);
	for (const id of ids) {
		const r = range.get(id) as { a: string | null; b: string | null };
		if (!r.a || !r.b) continue;
		const c = (cal.get(id) as { c: string }).c;
		const m = missing.get(c, r.a, r.b, id, id) as { a: string | null; b: string | null; n: number };
		if (m.n > 0 && m.a && m.b && enqueue(market, id, m.a, m.b)) queued++;
	}
	return queued;
}
