import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { signalsBlock } from '#lib/server/reminders.js';
import { ensureYearReminder } from '#lib/server/portfolioRisk.js';

/** Д-29: the block «Сигналы» — the fired reminders and the trade discipline's signals, not snoozed */
export function GET() {
	// T-016 (7): in December — «итог года» among the signals
	ensureYearReminder(getApp().sqlite, getMarket().sqlite);
	return json(signalsBlock(getApp().sqlite, getMarket().sqlite));
}
