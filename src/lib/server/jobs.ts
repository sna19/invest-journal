import cron from 'node-cron';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { israelDate } from '../hypothesis.js';
import { backupDir, getApp, getMarket, rawDir } from './db.js';
import { findGaps, enqueueMissingHistory, resetRunning, runQueue, type QueueSummary } from './market/history.js';
import { makeFetcher } from './market/http.js';
import { nasdaqTrader } from './market/nasdaqtrader.js';
import { runListings, type RunSummary } from './market/pipeline.js';
import { loadSecurity, securitiesForPrices, type Ctx } from './market/prices.js';
import { ringSecurities } from './market/rings.js';
import { tase } from './market/tase.js';
import { updateHypotheses, type Summary } from './results.js';

/**
 * Background jobs (spec sections 10 and 14): node-cron inside the app, Israel time, each run written to
 * ops_ingest_runs; a missed run is caught up at start.
 *   listings — weekly; prices — every morning (new days of the ring + the history queue + hypotheses);
 *   gaps — weekly; backups — app.db daily (30), market.db weekly (2), by VACUUM INTO.
 */
const TZ = 'Asia/Jerusalem';
const WEEK = 7 * 24 * 3600 * 1000;

const running = new Map<string, Promise<unknown>>();
export const jobRunning = (job: string) => running.has(job);
export const listingsRunning = () => running.has('listings');

/** One job at a time per name; a second call joins the first. */
function single<T>(job: string, f: () => Promise<T>): Promise<T> {
	const r = running.get(job) as Promise<T> | undefined;
	if (r) return r;
	const p = f().finally(() => running.delete(job));
	running.set(job, p);
	return p;
}

// ── run log ─────────────────────────────────────────────────────────────────────

function startRun(job: string, provider: string) {
	return (getMarket().sqlite.prepare(`insert into ops_ingest_runs (job, provider_code) values (?, ?) returning id`).get(job, provider) as { id: number }).id;
}

function finishRun(id: number, r: { status: string; received?: number; added?: number; updated?: number; error?: string | null }) {
	getMarket()
		.sqlite.prepare(
			`update ops_ingest_runs set finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status = ?, rows_received = ?, rows_added = ?,
			        rows_updated = ?, error = ? where id = ?`
		)
		.run(r.status, r.received ?? 0, r.added ?? 0, r.updated ?? 0, r.error ?? null, id);
}

/** A run whose row count differs from the average of the last ten good ones more than twofold (spec section 14). */
function suspicious(job: string, received: number) {
	const rows = getMarket()
		.sqlite.prepare(`select rows_received as n from ops_ingest_runs where job = ? and status = 'ok' and rows_received > 0 order by id desc limit 10`)
		.all(job) as { n: number }[];
	if (rows.length < 3 || received === 0) return false;
	const avg = rows.reduce((a, r) => a + r.n, 0) / rows.length;
	return received > avg * 2 || received < avg / 2;
}

function ctx(runId: number): Ctx {
	const m = getMarket();
	return { db: m.db, sqlite: m.sqlite, get: makeFetcher(), rawDir, runId, day: israelDate() };
}

// ── listings ───────────────────────────────────────────────────────────────────

export function runListingsJob(): Promise<RunSummary[]> {
	return single('listings', async () => {
		const db = getMarket().db;
		const get = makeFetcher();
		const out: RunSummary[] = [];
		for (const adapter of [nasdaqTrader, tase]) {
			const s = await runListings(db, adapter, { get, rawDir });
			console.log(`listings ${s.provider}: ${s.status} received ${s.received}, +${s.added}, ~${s.updated}, -${s.deactivated}${s.error ? ' ' + s.error : ''}`);
			out.push(s);
		}
		return out;
	});
}

// ── history queue ──────────────────────────────────────────────────────────────

/** Works the queue: benchmarks first, then the rest. Written as a «history» run. */
export function runHistoryJob(): Promise<QueueSummary> {
	return single('history', async () => {
		const m = getMarket().sqlite;
		resetRunning(m);
		const pending = (m.prepare(`select count(*) as n from ops_ingest_tasks where job = 'history' and status = 'queued'`).get() as { n: number }).n;
		const empty: QueueSummary = { done: 0, failed: 0, none: 0, added: 0, updated: 0, received: 0, issues: 0, errors: [] };
		if (!pending) return empty;
		const id = startRun('history', 'yahoo');
		try {
			const c = ctx(id);
			const a = await runQueue(c, { benchmarksOnly: true, parallel: 2 });
			const b = await runQueue(c, { parallel: 4 });
			const s: QueueSummary = {
				done: a.done + b.done,
				failed: a.failed + b.failed,
				none: a.none + b.none,
				added: a.added + b.added,
				updated: a.updated + b.updated,
				received: a.received + b.received,
				issues: a.issues + b.issues,
				errors: [...a.errors, ...b.errors]
			};
			finishRun(id, { status: s.failed ? 'suspicious' : 'ok', ...s, error: s.errors.slice(0, 5).join('; ') || null });
			console.log(`history: ${s.done} done, ${s.none} without prices, ${s.failed} failed, +${s.added} rows`);
			return s;
		} catch (e) {
			finishRun(id, { status: 'error', error: String(e) });
			throw e;
		}
	});
}

/** A new hypothesis's security joins ring 1 at once: its history is queued and loaded in the background. */
export function queueSecurity(securityId: number) {
	const m = getMarket().sqlite;
	if (enqueueMissingHistory(m, [securityId], israelDate())) void runHistoryJob().then(() => runHypothesesStep());
}

// ── daily prices ───────────────────────────────────────────────────────────────

export interface DailySummary {
	securities: number;
	received: number;
	added: number;
	updated: number;
	issues: number;
	none: number;
	errors: string[];
	splits: number;
	history?: QueueSummary;
	hypotheses?: Summary;
}

/**
 * Every morning: for each security of the ring, the days after its last loaded one (so missed days come with
 * the next run); securities without history are queued; then the queue; then the hypotheses.
 */
export function runPricesJob(): Promise<DailySummary> {
	return single('prices', async () => {
		const app = getApp().sqlite;
		const m = getMarket().sqlite;
		const day = israelDate();
		const ids = ringSecurities(m, app);
		enqueueMissingHistory(m, ids, day);
		const id = startRun('prices', 'yahoo');
		const c = ctx(id);
		const s: DailySummary = { securities: 0, received: 0, added: 0, updated: 0, issues: 0, none: 0, errors: [], splits: 0 };
		try {
			const last = m.prepare('select max(date) as d from market_prices_daily where security_id = ?');
			const secs = securitiesForPrices(m, ids).sort((a, b) => Number(b.isBenchmark) - Number(a.isBenchmark));
			for (const sec of secs) {
				const d = (last.get(sec.id) as { d: string | null }).d;
				if (!d || d >= day) continue;
				const from = new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
				const r = await loadSecurity(c, sec, from, day);
				s.securities++;
				s.received += r.received;
				s.added += r.added;
				s.updated += r.updated;
				s.issues += r.issues;
				if (r.status === 'none') s.none++;
				if (r.status === 'error') s.errors.push(`${sec.symbol}: ${r.error}`);
				if (r.newSplit) {
					// the provider rewrote the history in the new scale: load it all again
					s.splits++;
					m.prepare(`insert into ops_ingest_tasks (job, security_id, period_from, period_to) values ('history', ?, ?, ?)`).run(
						sec.id,
						`${Number(day.slice(0, 4)) - 10}${day.slice(4)}`,
						day
					);
				}
			}
			const status = s.errors.length ? 'suspicious' : suspicious('prices', s.received) ? 'suspicious' : 'ok';
			finishRun(id, { status, ...s, error: s.errors.slice(0, 5).join('; ') || null });
		} catch (e) {
			finishRun(id, { status: 'error', error: String(e) });
			throw e;
		}
		s.history = await runHistoryJob();
		s.hypotheses = runHypothesesStep();
		console.log(`prices: ${s.securities} securities, +${s.added} rows, ${s.errors.length} errors; hypotheses ${JSON.stringify({ ...s.hypotheses, waiting: s.hypotheses.waiting.length })}`);
		return s;
	});
}

/** Entry prices, current results, closing — written as a «hypotheses» run. */
export function runHypothesesStep(): Summary {
	const id = startRun('hypotheses', 'app');
	try {
		const r = updateHypotheses(getApp().sqlite, getMarket().sqlite);
		finishRun(id, { status: 'ok', received: r.entries + r.updated + r.closed, added: r.closed, updated: r.entries + r.updated });
		return r;
	} catch (e) {
		finishRun(id, { status: 'error', error: String(e) });
		throw e;
	}
}

// ── gaps ───────────────────────────────────────────────────────────────────────

export function runGapsJob() {
	return single('gaps', async () => {
		const id = startRun('gaps', 'yahoo');
		const queued = findGaps(getMarket().sqlite, ringSecurities(getMarket().sqlite, getApp().sqlite));
		finishRun(id, { status: 'ok', received: queued, added: queued });
		if (queued) await runHistoryJob();
		return queued;
	});
}

// ── backups ────────────────────────────────────────────────────────────────────

/** Consistent copy while the app runs; keeps the newest `keep` files of this kind. */
export function backup(kind: 'app' | 'market', keep: number, dir = backupDir) {
	mkdirSync(dir, { recursive: true });
	const sqlite = kind === 'app' ? getApp().sqlite : getMarket().sqlite;
	const file = join(dir, `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
	sqlite.prepare('VACUUM INTO ?').run(file);
	const old = readdirSync(dir)
		.filter((f) => new RegExp(`^${kind}-\\d{4}-.*\\.db$`).test(f))
		.sort()
		.slice(0, -keep);
	for (const f of old) rmSync(join(dir, f));
	return file;
}

export function runBackupJob(kind: 'app' | 'market') {
	return single(`backup-${kind}`, async () => {
		const id = startRun(`backup-${kind}`, 'local');
		try {
			const file = backup(kind, kind === 'app' ? 30 : 2);
			finishRun(id, { status: 'ok', received: 1, added: 1, error: null });
			console.log(`backup: ${file}`);
			return file;
		} catch (e) {
			finishRun(id, { status: 'error', error: String(e) });
			throw e;
		}
	});
}

// ── scheduler ──────────────────────────────────────────────────────────────────

/** When a job last finished with data (ok or suspicious); null — never. */
export function lastRun(job: string, provider?: string): Date | null {
	const r = getMarket()
		.sqlite.prepare(
			`select max(finished_at) as at from ops_ingest_runs where job = ? ${provider ? 'and provider_code = ?' : ''} and status in ('ok', 'suspicious')`
		)
		.get(...(provider ? [job, provider] : [job])) as { at: string | null };
	return r.at ? new Date(r.at) : null;
}

/** The oldest of the providers' last good listings runs; null — some provider never loaded. */
export function lastListings(): Date | null {
	let oldest = new Date(8.64e15);
	for (const p of ['nasdaqtrader', 'tase']) {
		const d = lastRun('listings', p);
		if (!d) return null;
		if (d < oldest) oldest = d;
	}
	return oldest;
}

let started = false;

export function startScheduler() {
	if (started) return;
	started = true;
	const at = (expr: string, name: string, f: () => unknown) =>
		cron.schedule(expr, () => void Promise.resolve(f()).catch((e) => console.error(`${name}: ${e}`)), { timezone: TZ, name });
	// both exchanges are closed by the Israeli morning
	at('15 7 * * *', 'prices', runPricesJob);
	at('30 6 * * 0', 'listings', runListingsJob);
	at('0 9 * * 6', 'gaps', runGapsJob);
	at('40 3 * * *', 'backup-app', () => runBackupJob('app'));
	at('10 4 * * 0', 'backup-market', () => runBackupJob('market'));

	// catch up what was missed while the app was down
	void (async () => {
		const listings = lastListings();
		if (!listings || Date.now() - listings.getTime() > WEEK) {
			console.log(`listings: ${listings ? 'missed run since ' + listings.toISOString() : 'never loaded'} — catching up`);
			await runListingsJob();
		}
		const prices = lastRun('prices');
		if (!prices || israelDate(prices) < israelDate()) await runPricesJob();
		else await runHistoryJob();
		const bApp = lastRun('backup-app');
		if (!bApp || Date.now() - bApp.getTime() > 26 * 3600 * 1000) await runBackupJob('app');
		const bMarket = lastRun('backup-market');
		if (!bMarket || Date.now() - bMarket.getTime() > WEEK) await runBackupJob('market');
	})().catch((e) => console.error(`catch-up: ${e}`));
}
