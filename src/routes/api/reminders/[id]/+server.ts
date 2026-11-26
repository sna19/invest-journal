import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { closeReminder, historyOfReminder, snooze } from '#lib/server/reminders.js';
import { body, fail } from '#lib/server/respond.js';

/** Д-31: the reminder's history */
export function GET({ params }) {
	return json({ items: historyOfReminder(getApp().sqlite, Number(params.id)) });
}

/** POST { action: 'snooze', how: 'day' | 'week' | 'month' | 'YYYY-MM-DD' } | { action: 'close', conclusion } */
export async function POST({ params, request }) {
	try {
		const b = await body(request);
		const app = getApp().sqlite;
		if (b.action === 'snooze') return json({ until: snooze(app, Number(params.id), b.how) });
		if (b.action === 'close') return json({ entryId: closeReminder(app, getMarket().sqlite, Number(params.id), b.conclusion) });
		return json({ message: 'Неизвестное действие' }, { status: 400 });
	} catch (e) {
		return fail(e);
	}
}
