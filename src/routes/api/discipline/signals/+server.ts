import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { liveSignals } from '#lib/server/reminders.js';

/** T-015: the signals of the held positions — stop broken, target reached, review date, a model's quarter over */
export function GET() {
	return json({ items: liveSignals(getApp().sqlite, getMarket().sqlite) });
}
