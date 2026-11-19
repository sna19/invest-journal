import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { jobRunning, nextRuns } from '#lib/server/jobs.js';
import { readSchedule } from '#lib/server/market/quotes.js';
import { dataStatus } from '#lib/server/status.js';

/** GET — the «Данные» block of Settings (spec section 14, observability). */
export function GET() {
	return json({ ...dataStatus(getMarket().sqlite, getApp().sqlite), running: ['listings', 'prices', 'history', 'gaps', 'quotes', 'monthly'].filter(jobRunning),
		// the quarterly model's monthly prices: how many shares are loaded of all
		monthly: getMarket().sqlite.prepare(`select (select count(*) from ops_monthly_loads where status = 'ok') as loaded, (select count(*) from ref_securities where (type = 'stock' and active = 1 and manual = 0) or is_benchmark = 1) as total`).get(), schedule: readSchedule(getMarket().sqlite), next: nextRuns() });
}
