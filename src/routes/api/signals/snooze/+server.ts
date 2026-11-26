import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { snoozeSignal } from '#lib/server/reminders.js';
import { body, fail } from '#lib/server/respond.js';

/** POST { key: 'stop|12|34', how } — a trade discipline's signal snoozed like a reminder */
export async function POST({ request }) {
	try {
		const b = await body(request);
		return json({ until: snoozeSignal(getApp().sqlite, b.key, b.how) });
	} catch (e) {
		return fail(e);
	}
}
