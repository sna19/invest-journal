import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { signalsBlock } from '#lib/server/reminders.js';

/** Д-29: the block «Сигналы» — the fired reminders and the trade discipline's signals, not snoozed */
export function GET() {
	return json(signalsBlock(getApp().sqlite, getMarket().sqlite));
}
