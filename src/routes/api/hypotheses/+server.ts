import { json } from '@sveltejs/kit';
import { getAppDb, getMarket } from '#lib/server/db.js';
import { queueSecurity } from '#lib/server/jobs.js';
import { spark } from '#lib/server/results.js';
import { israelDate } from '#lib/hypothesis.js';
import { createHypothesis, listHypotheses, type ListFilter } from '#lib/server/journal.js';
import { body, fail } from '#lib/server/respond.js';
import type { HypothesisInput } from '#lib/hypothesis.js';

/** GET /api/hypotheses?status=open|closed|all&mode=sim|real|all&market=us|il|all&defaultHorizon=1 */
export function GET({ url }) {
	const p = url.searchParams;
	const pick = <T extends string>(k: string, ok: T[]) => (ok.includes(p.get(k) as T) ? (p.get(k) as T) : undefined);
	const f: ListFilter = {
		status: pick('status', ['open', 'closed', 'all']),
		mode: pick('mode', ['sim', 'real', 'all']),
		market: pick('market', ['us', 'il', 'all']),
		defaultHorizon: p.get('defaultHorizon') === '1'
	};
	const m = getMarket().sqlite;
	const today = israelDate();
	// the small chart: security against benchmark from the entry to the exit (or today), both from 100
	const items = listHypotheses(getAppDb(), f).map((r) => ({
		...r,
		spark: r.h.entryPriceDate ? spark(m, r.h.securityId, r.h.benchmarkId, r.h.entryPriceDate, r.h.exitDate ?? today) : null
	}));
	const last = m
		.prepare(`select max(finished_at) as at from ops_ingest_runs where job = 'prices' and status in ('ok', 'suspicious')`)
		.get() as { at: string | null };
	const late = !!last.at && Date.now() - Date.parse(last.at) > 48 * 3600 * 1000;
	return json({ items, late, lastPricesAt: last.at });
}

/** POST — a new hypothesis (sections 2, 6, 17); 400 with field errors. */
export async function POST({ request }) {
	try {
		const h = createHypothesis(getAppDb(), getMarket().sqlite, (await body(request)) as HypothesisInput);
		// ring 1: a new security's history is queued at its first hypothesis (spec section 14)
		queueSecurity(h.securityId);
		return json(h, { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
