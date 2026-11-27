import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { reminders } from '#lib/server/help.js';
import { getSetting, setSetting } from '#lib/server/risk.js';
import { body } from '#lib/server/respond.js';

/** T-019: GET — every topic's «Напоминание» line and whether the screens show them; POST { show } — the setting */
export function GET({ locals }) {
	return json({ show: getSetting(getApp().sqlite, 'show_reminders') !== '0', items: reminders(getApp().db, locals.user?.lang) });
}
export async function POST({ request }) {
	const b = await body(request);
	setSetting(getApp().sqlite, 'show_reminders', b.show === false ? '0' : '1');
	return json({ show: b.show !== false });
}
