import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { cancelEvent } from '#lib/server/portfolio.js';
import { fail } from '#lib/server/respond.js';

/** POST — undo an event entered less than 24 hours ago (an input error). */
export function POST({ params }) {
	try {
		return json({ positionId: cancelEvent(getApp().sqlite, getMarket().sqlite, Number(params.id)) });
	} catch (e) {
		return fail(e);
	}
}
