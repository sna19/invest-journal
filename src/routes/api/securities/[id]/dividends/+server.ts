import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { dividendHistory } from '#lib/server/dividends.js';
import { queueSecurities } from '#lib/server/jobs.js';

/** GET — a security's dividends by year with the change against the year before (owner 28.11.2026) */
export function GET({ params }) {
	const m = getMarket().sqlite;
	const id = Number(params.id);
	// without daily history there is no payment history either: loaded in the background
	if (!m.prepare('select 1 from market_prices_daily where security_id = ? limit 1').get(id)) queueSecurities([id]);
	return json(dividendHistory(m, id));
}
