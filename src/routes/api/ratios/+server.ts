import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { statsOf } from '#lib/server/market/stats.js';

/** GET ?ids=1,2,… — the ratios of the securities (loaded from Yahoo if missing or older than 3 days, 8 per call) */
export async function GET({ url }) {
	const ids = (url.searchParams.get('ids') ?? '')
		.split(',')
		.map(Number)
		.filter((x) => Number.isInteger(x) && x > 0)
		.slice(0, 40);
	const m = await statsOf(getMarket().sqlite, ids);
	return json({ items: Object.fromEntries([...m].map(([id, v]) => [id, v])) });
}
