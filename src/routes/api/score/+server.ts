import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { statsOf } from '#lib/server/market/stats.js';
import { missingStats, scoresOf } from '#lib/server/score.js';

/**
 * T-034: GET ?ids=1,2,… — the quant score of each security: its colour, the factors' grades with their metrics, the
 * trend. Shares whose ratios are not loaded yet get them now, a few per request (the rest — on the next look or at night).
 */
export async function GET({ url }) {
	const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 200);
	const m = getMarket().sqlite;
	const missing = missingStats(m, ids);
	if (missing.length) await statsOf(m, missing.slice(0, 6), { loadAtMost: 6 }).catch(() => null);
	return json({ items: Object.fromEntries(scoresOf(m, ids).map((s) => [s.id, s])) });
}
