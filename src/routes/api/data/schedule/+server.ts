import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { nextRuns, reschedulePrices } from '#lib/server/jobs.js';
import { ScheduleError, readSchedule, writeSchedule } from '#lib/server/market/quotes.js';
import { body } from '#lib/server/respond.js';

/** GET — the update schedule and the next runs; PATCH { quotesEvery, quotesMarketHours, pricesAt } (owner 19.11.2026). */
export function GET() {
	return json({ ...readSchedule(getMarket().sqlite), next: nextRuns() });
}

export async function PATCH({ request }) {
	try {
		const before = readSchedule(getMarket().sqlite).pricesAt;
		const s = writeSchedule(getMarket().sqlite, await body(request));
		if (s.pricesAt !== before) reschedulePrices();
		return json({ ...s, next: nextRuns() });
	} catch (e) {
		if (e instanceof ScheduleError) return json({ message: e.message }, { status: 400 });
		throw e;
	}
}
