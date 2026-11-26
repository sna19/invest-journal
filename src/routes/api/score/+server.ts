import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { scoresOf } from '#lib/server/score.js';

/** T-034: GET ?ids=1,2,… — the quant score of each security: its colour, the factors' grades with their metrics, the trend */
export function GET({ url }) {
	const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 200);
	return json({ items: Object.fromEntries(scoresOf(getMarket().sqlite, ids).map((s) => [s.id, s])) });
}
