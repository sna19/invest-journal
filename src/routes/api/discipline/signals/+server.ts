import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { signals } from '#lib/server/discipline.js';

/** T-015: the signals of the held positions — stop broken, target reached, review date, a model's quarter over */
export function GET() {
	return json({ items: signals(getApp().sqlite, getMarket().sqlite) });
}
