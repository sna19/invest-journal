import cron from 'node-cron';
import { getMarket, rawDir } from './db.js';
import { makeFetcher } from './market/http.js';
import { nasdaqTrader } from './market/nasdaqtrader.js';
import { runListings, type RunSummary } from './market/pipeline.js';
import { tase } from './market/tase.js';

/**
 * Background jobs (spec sections 10 and 14): node-cron inside the app, Israel time, plus the «Обновить»
 * button. A missed run is caught up at start. Each run is written to ops_ingest_runs.
 */
const TZ = 'Asia/Jerusalem';
const WEEK = 7 * 24 * 3600 * 1000;

let listings: Promise<RunSummary[]> | null = null;

export const listingsRunning = () => listings !== null;

/** Weekly listings of both markets; a second call while running joins the first. */
export function runListingsJob(): Promise<RunSummary[]> {
	if (listings) return listings;
	const db = getMarket().db;
	const get = makeFetcher();
	listings = (async () => {
		const out: RunSummary[] = [];
		for (const adapter of [nasdaqTrader, tase]) {
			const s = await runListings(db, adapter, { get, rawDir });
			console.log(`listings ${s.provider}: ${s.status} received ${s.received}, +${s.added}, ~${s.updated}, -${s.deactivated}${s.error ? ' ' + s.error : ''}`);
			out.push(s);
		}
		return out;
	})().finally(() => (listings = null));
	return listings;
}

/**
 * The oldest of the providers' last good listings runs: if any provider has not loaded for a week (or never),
 * the job is due. null — some provider never loaded.
 */
export function lastListings(): Date | null {
	const sqlite = getMarket().sqlite;
	let oldest: Date | null = new Date(8.64e15);
	for (const provider of ['nasdaqtrader', 'tase']) {
		const r = sqlite
			.prepare(`select max(finished_at) as at from ops_ingest_runs where job = 'listings' and provider_code = ? and status in ('ok', 'suspicious')`)
			.get(provider) as { at: string | null };
		if (!r.at) return null;
		const d = new Date(r.at);
		if (d < oldest!) oldest = d;
	}
	return oldest;
}

let started = false;

export function startScheduler() {
	if (started) return;
	started = true;
	// Sunday morning in Israel: both lists are fresh after the weekend
	cron.schedule('30 6 * * 0', () => void runListingsJob(), { timezone: TZ, name: 'listings' });
	const last = lastListings();
	if (!last || Date.now() - last.getTime() > WEEK) {
		console.log(`listings: ${last ? 'missed run since ' + last.toISOString() : 'never loaded'} — catching up`);
		void runListingsJob();
	}
}
