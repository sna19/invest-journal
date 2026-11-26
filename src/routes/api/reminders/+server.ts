import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { addReminder } from '#lib/server/reminders.js';
import { body, fail } from '#lib/server/respond.js';

/** T-032 11г: POST { entryId, condition, date | securityId + level | securityId + days + pct | positionId + pct | hypothesisId, title? } */
export async function POST({ request }) {
	try {
		return json({ id: addReminder(getApp().sqlite, await body(request)) }, { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
