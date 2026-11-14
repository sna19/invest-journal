import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { listingsRunning } from '#lib/server/jobs.js';
import { tickerStats } from '#lib/server/market/search.js';

/** GET /api/tickers — counts by exchange, the last listings runs, whether a run is going on. */
export function GET() {
	return json({ ...tickerStats(getMarket().sqlite), running: listingsRunning() });
}
