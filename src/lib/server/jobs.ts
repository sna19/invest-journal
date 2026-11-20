import cron from 'node-cron';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { israelDate } from '../hypothesis.js';
import { DEFAULTS, dropUniverse, nextQuarter, runModel, universe, universeIds } from './model/quarterly.js';
import { recordQuarter, VARIANTS } from './model/service.js';
import { checkMonthlyAgainstDaily, loadMonthly, monthlyDue, type MonthlySummary } from './market/monthly.js';
import { loadProfiles, staleProfiles, type ProfilesSummary } from './market/profiles.js';
import { heldSecurities, loadQuotes, marketsOpen, readSchedule, type QuotesSummary } from './market/quotes.js';
import { asUser, currentUserId, forEachUser, listUsers } from './auth.js';
import { backupDir, getApp, getMarket, rawDir } from './db.js';
import { findGaps, enqueueMissingHistory, resetRunning, runQueue, type QueueSummary } from './market/history.js';
import { makeFetcher } from './market/http.js';
import { nasdaqTrader } from './market/nasdaqtrader.js';
import { runListings, type RunSummary } from './market/pipeline.js';
import { loadSecurity, securitiesForPrices, type Ctx } from './market/prices.js';
import { ringSecurities } from './market/rings.js';
import { tase } from './market/tase.js';
import { loadFx, USD_ILS, type FxSummary } from './market/boi.js';
import { updateHypotheses, type Summary } from './results.js';
import { syncAuto } from './portfolio.js';

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
	fx?: FxSummary;
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
		const ids = await ringOfAll(m);
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
		s.fx = await runFxJob().catch((e) => (console.error(`fx: ${e}`), undefined));
		s.hypotheses = runHypothesesStep();
		console.log(`prices: ${s.securities} securities, +${s.added} rows, ${s.errors.length} errors; hypotheses ${JSON.stringify({ ...s.hypotheses, waiting: s.hypotheses.waiting.length })}`);
		return s;
	});
}

/**
 * Spec section 18 — the USD/ILS rate: ten years at the first run, then from a week before the last loaded day
 * (the bank sometimes publishes late). Written as an «fx» run.
 */
export function runFxJob(): Promise<FxSummary> {
	return single('fx', async () => {
		const m = getMarket().sqlite;
		const day = israelDate();
		const last = (m.prepare('select max(date) as d from market_fx_daily where pair = ?').get(USD_ILS) as { d: string | null }).d;
		const from = last
			? new Date(Date.parse(last + 'T12:00:00Z') - 7 * 86400000).toISOString().slice(0, 10)
			: `${Number(day.slice(0, 4)) - 10}${day.slice(4)}`;
		const id = startRun('fx', 'boi');
		try {
			const s = await loadFx(ctx(id), from, day);
			finishRun(id, { status: s.issues ? 'suspicious' : 'ok', ...s });
			console.log(`fx: ${from}…${day} received ${s.received}, +${s.added}, ~${s.updated}, issues ${s.issues}`);
			return s;
		} catch (e) {
			finishRun(id, { status: 'error', error: String(e) });
			throw e;
		}
	});
}

/** the securities to load for all users together: the union of every journal's ring (owner 19.11.2026) */
async function ringOfAll(m: import('better-sqlite3').Database): Promise<number[]> {
	return [...new Set((await forEachUser(() => ringSecurities(m, getApp().sqlite))).flat())];
}

/** Entry prices, current results, closing — for every user's journal, written as one «hypotheses» run. */
export function runHypothesesStep(): Summary {
	const id = startRun('hypotheses', 'app');
	try {
		const all: Summary[] = [];
		for (const u of listUsersSafe()) all.push(asUser(u, () => hypothesesOf()));
		const r = all.reduce((a, b) => ({ ...a, entries: a.entries + b.entries, updated: a.updated + b.updated, closed: a.closed + b.closed, waiting: [...a.waiting, ...b.waiting] }));
		finishRun(id, { status: 'ok', received: r.entries + r.updated + r.closed, added: r.closed, updated: r.entries + r.updated });
		return r;
	} catch (e) {
		finishRun(id, { status: 'error', error: String(e) });
		throw e;
	}
}

const listUsersSafe = () => {
	try {
		const ids = listUsers().map((u) => u.id);
		return ids.length ? ids : [1];
	} catch {
		return [1];
	}
};

/** one user's step: hypotheses, then the automatic portfolios */
function hypothesesOf(): Summary {
	{
		const r = updateHypotheses(getApp().sqlite, getMarket().sqlite);
		// section 18: automatic portfolios follow their sources' hypotheses (entries, closes, dividends)
		try {
			const a = getApp().sqlite;
			const auto = a.transaction(() => syncAuto(a, getMarket().sqlite))();
			if (auto.bought || auto.sold || auto.dividends || auto.reversed) console.log(`auto portfolios: ${JSON.stringify(auto)}`);
		} catch (e) {
			console.error(`auto portfolios: ${e}`);
		}
		return r;
	}
}

// ── gaps ───────────────────────────────────────────────────────────────────────

export function runGapsJob() {
	return single('gaps', async () => {
		const id = startRun('gaps', 'yahoo');
		const queued = findGaps(getMarket().sqlite, await ringOfAll(getMarket().sqlite));
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
	// a user's journal other than the first: app-u<id>-<time>.db
	const uid = currentUserId();
	if (kind === 'app' && uid && uid !== 1) kind = `app-u${uid}` as 'app';
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
			const file = kind === 'app' ? (await forEachUser(() => backup('app', 30))).join(', ') : backup(kind, 2);
			finishRun(id, { status: 'ok', received: 1, added: 1, error: null });
			console.log(`backup: ${file}`);
			return file;
		} catch (e) {
			finishRun(id, { status: 'error', error: String(e) });
			throw e;
		}
	});
}

// ── live quotes ─────────────────────────────────────────────────────────────────

/** Owner's request 19.11.2026: quotes of held securities and the dollar during the day (market/quotes.ts). */
export function runQuotesJob(): Promise<QuotesSummary> {
	return single('quotes', async () => {
		const id = startRun('quotes', 'yahoo');
		try {
			const held = new Set((await forEachUser(() => heldSecurities(getApp().sqlite))).flat());
			const s = await loadQuotes(getMarket().sqlite, [...held], makeFetcher({ retries: 1 }));
			finishRun(id, { status: s.errors.length > s.securities / 2 ? 'error' : s.errors.length ? 'suspicious' : 'ok', received: s.securities, updated: s.updated, error: s.errors.slice(0, 5).join('; ') || null });
			// a security new in a portfolio gets its profile (sector, …) right away, not at the next daily run
			if (staleProfiles(getMarket().sqlite, [...held]).length) void runProfilesJob().catch((e) => console.error(`profiles: ${e}`));
			return s;
		} catch (e) {
			finishRun(id, { status: 'error', error: String(e) });
			throw e;
		}
	});
}

// ── monthly prices (quarterly model, T-009) ─────────────────────────────────────

/** Spec section 21: monthly bars of all shares and the benchmarks, in portions at night (market/monthly.ts). */
/** `limit` — securities per run (a night hour takes 2 500; the «now» button — all that are due) */
export function runMonthlyJob(limit = 2500, sectorLimit = 1500): Promise<MonthlySummary> {
	return single('monthly', async () => {
		const id = startRun('monthly', 'yahoo');
		try {
			const m = getMarket().sqlite;
			const due = monthlyDue(m, new Date(), limit);
			const s = await loadMonthly(m, due, makeFetcher({ retries: 1 }));
			const check = s.loaded ? checkMonthlyAgainstDaily(m) : null;
			// the model reads the new prices: the report line, and its next request gets them
			if (s.loaded) logModel();
			// the model's caps need a sector and a market cap for every share of its universe; refreshed weekly
			const need = staleProfiles(m, universeIds(universe(m))).slice(0, sectorLimit);
			if (need.length) {
				const pr = await loadProfiles(m, need).catch((e) => ({ updated: 0, errors: [String(e)] }));
				console.log(`monthly: sectors of ${need.length} shares — ${pr.updated} loaded${pr.errors.length ? `, ${pr.errors.length} errors` : ''}`);
			}
			if (check) console.log(`monthly: ${s.loaded} loaded, ${s.rows} rows in ${Math.round(s.ms / 1000)} s; agrees with daily ${check.agree}/${check.checked}`);
			finishRun(id, {
				status: s.errors.length > s.securities / 2 ? 'error' : s.errors.length ? 'suspicious' : 'ok',
				received: s.securities,
				added: s.rows,
				updated: s.loaded,
				error: s.errors.slice(0, 5).join('; ') || null
			});
			return s;
		} catch (e) {
			finishRun(id, { status: 'error', error: String(e) });
			throw e;
		}
	});
}

/**
 * T-009 report: the model's universe and the next quarter's candidates with the default parameters, with the
 * time and memory it takes on the NAS — written to the log at start and after a monthly load.
 */
export function logModel() {
	const m = getMarket().sqlite;
	dropUniverse();
	const rss0 = process.memoryUsage().rss;
	const t0 = performance.now();
	const u = universe(m);
	const build = Math.round(performance.now() - t0);
	const rss = Math.round((process.memoryUsage().rss - rss0) / 1e6);
	if (u.stocks.length < 500) return console.log(`model: ${u.stocks.length} shares with monthly prices — too few yet`);
	const nq = nextQuarter();
	const out: string[] = [];
	const candidates: number[] = [];
	const capLine = (label: string, groups: string[]) => {
		const r = runModel(u, 'A', nq.quarter, { ...DEFAULTS, capGroups: groups });
		return `A Q${r.quarter} ${r.forYear} ${label}: universe ${r.universe}, passed ${r.passed}, by chance ≈ ${r.expected} — ${r.candidates.map((c) => `${c.symbol} ${c.up}/10 ${c.mean > 0 ? '+' : ''}${c.mean}% (${c.capUsd ? Math.round(c.capUsd / 1e9) + 'B$' : '?'})`).join('; ')}`;
	};
	for (const v of ['A', 'B'] as const) {
		const t = performance.now();
		const r = runModel(u, v, nq.quarter, DEFAULTS);
		if (v === 'A') out.push(`caps (liquid shares): ${JSON.stringify(r.capCounts)}`);
		candidates.push(...r.candidates.map((c) => c.id));
		out.push(
			`${v} Q${r.quarter} ${r.forYear}: universe ${r.universe} (no history ${r.noHistory}, illiquid ${r.illiquid}), passed ${r.passed}, by chance ≈ ${r.expected}, p ${r.p}, ${Math.round(performance.now() - t)} ms — ` +
				r.candidates.map((c) => `${c.symbol}${c.market === 'IL' ? '.TA' : ''} ${c.up}/10 ${c.mean > 0 ? '+' : ''}${c.mean}% (med ${c.median}, worst ${c.worst}, ${c.sector ?? '?'})`).join('; ') +
				` | walk ${r.walk.map((w) => `${w.year}: ${w.pickedMean}% vs ${w.allMean}%`).join(', ')}`
		);
	}
	console.log(`model: ${u.stocks.length} shares, data to ${u.lastMonth % 12 + 1}/${Math.floor(u.lastMonth / 12)}, built in ${build} ms, +${rss} MB rss (heap ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB)`);
	// T-021 report: large + mega and small + micro apart
	out.push(capLine('large+mega', ['mega', 'large']), capLine('small+micro', ['small', 'micro']));
	for (const l of out) console.log(`model: ${l}`);
	// T-020: the candidates' cards need daily history — load it now rather than on the first open
	if (enqueueMissingHistory(m, [...new Set(candidates)], israelDate())) void runHistoryJob().catch((e) => console.error(`history: ${e}`));
}

// ── the quarterly model records its hypotheses (T-009) ──────────────────────────────

/** on the first weekday of a quarter each variant of every user records its candidates (model/service.ts) */
export function runModelJob(now = new Date()) {
	return single('model', async () => {
		const out = await forEachUser(() => VARIANTS.map((v) => recordQuarter(getApp().db, getApp().sqlite, getMarket().sqlite, v, now)));
		const done = out.flat().filter((r) => r.recorded);
		if (done.length) {
			const id = startRun('model', 'model');
			finishRun(id, { status: 'ok', received: done.length, added: done.reduce((n, r) => n + r.recorded, 0) });
			console.log(`model: ${done.map((r) => `${r.variant} ${r.quarter} ${r.recorded}`).join(', ')}`);
		}
		return out.flat();
	});
}

// ── security profiles ───────────────────────────────────────────────────────────

/** Owner's request 19.11.2026: sector, industry, country, size of the held securities (market/profiles.ts). */
export function runProfilesJob(): Promise<ProfilesSummary> {
	return single('profiles', async () => {
		const id = startRun('profiles', 'yahoo');
		try {
			const heldNow = async () => [...new Set((await forEachUser(() => heldSecurities(getApp().sqlite))).flat())];
			const s = await loadProfiles(getMarket().sqlite, await heldNow());
			// securities bought while this run went on (several buys in a row): load them too
			for (let i = 0; i < 3; i++) {
				const more = staleProfiles(getMarket().sqlite, await heldNow());
				if (!more.length) break;
				const n = await loadProfiles(getMarket().sqlite, more);
				s.securities += n.securities;
				s.updated += n.updated;
				s.none += n.none;
				s.errors.push(...n.errors);
				if (!n.updated && !n.none) break;
			}
			finishRun(id, { status: s.errors.length > s.securities / 2 ? 'error' : s.errors.length ? 'suspicious' : 'ok', received: s.securities, updated: s.updated, error: s.errors.slice(0, 5).join('; ') || null });
			return s;
		} catch (e) {
			finishRun(id, { status: 'error', error: String(e) });
			throw e;
		}
	});
}

/** whether the quotes are due now by the schedule */
export function quotesDue(now = new Date()): boolean {
	const sch = readSchedule(getMarket().sqlite);
	if (!sch.quotesEvery) return false;
	if (sch.quotesMarketHours) {
		const o = marketsOpen(now);
		if (!o.tase && !o.us) return false;
	}
	const last = lastRun('quotes');
	return !last || now.getTime() - last.getTime() >= sch.quotesEvery * 60_000 - 5_000;
}

/** when the next loads happen, for the settings screen */
export function nextRuns(now = new Date()) {
	const sch = readSchedule(getMarket().sqlite);
	const [h, m] = sch.pricesAt.split(':').map(Number);
	const last = lastRun('quotes');
	const open = marketsOpen(now);
	return {
		prices: sch.pricesAt,
		quotes: !sch.quotesEvery
			? null
			: sch.quotesMarketHours && !open.tase && !open.us
				? 'market-closed'
				: new Date(Math.max(now.getTime(), (last?.getTime() ?? 0) + sch.quotesEvery * 60_000)).toISOString(),
		open,
		h,
		m
	};
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
const tasks: { stop: () => unknown }[] = [];
let pricesTask: { stop: () => unknown } | null = null;

/** the morning load of daily closes at the time from the settings; called again when the time changes */
export function reschedulePrices() {
	pricesTask?.stop();
	const [h, m] = readSchedule(getMarket().sqlite).pricesAt.split(':').map(Number);
	pricesTask = cron.schedule(`${m} ${h} * * *`, () => void runPricesJob().catch((e) => console.error(`prices: ${e}`)), { timezone: TZ, name: 'prices' });
}

/** Stops the schedule: cron timers keep the process alive, and the container must stop on SIGTERM at once. */
export function stopScheduler() {
	for (const t of tasks.splice(0)) t.stop();
	pricesTask?.stop();
	pricesTask = null;
}

export function startScheduler() {
	if (started) return;
	started = true;
	const at = (expr: string, name: string, f: () => unknown) =>
		tasks.push(cron.schedule(expr, () => void Promise.resolve(f()).catch((e) => console.error(`${name}: ${e}`)), { timezone: TZ, name }));
	// daily closes: both exchanges are closed by the Israeli morning (the time is in the settings)
	reschedulePrices();
	// live quotes: checked every minute, run when due by the settings
	at('* * * * *', 'quotes', () => (quotesDue() ? runQuotesJob() : undefined));
	at('30 6 * * 0', 'listings', runListingsJob);
	at('20 8 * * *', 'profiles', runProfilesJob);
	// monthly bars for the model: every night hour, a portion each, until all are fresh
	at('35 0-5 * * *', 'monthly', () => runMonthlyJob());
	// after the morning closes: the first weekday of a quarter is the model's
	at('55 9 * * 1-5', 'model', () => runModelJob());
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
		// the dollar rate (section 18): portfolios need it before the next morning's run
		if (!lastRun('fx')) await runFxJob().catch((e) => console.error(`fx: ${e}`));
		await runProfilesJob().catch((e) => console.error(`profiles: ${e}`));
		try {
			logModel();
		} catch (e) {
			console.error(`model: ${e}`);
		}
		const bApp = lastRun('backup-app');
		if (!bApp || Date.now() - bApp.getTime() > 26 * 3600 * 1000) await runBackupJob('app');
		const bMarket = lastRun('backup-market');
		if (!bMarket || Date.now() - bMarket.getTime() > WEEK) await runBackupJob('market');
	})().catch((e) => console.error(`catch-up: ${e}`));
}
