import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { syncJournal } from '#lib/server/diary.js';
import { savePlan } from '#lib/server/discipline.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * T-015. PUT { kind, thesis, wrongIf, stop, target, reviewDate, noStopReason, reason } — the conditions of a position's
 * trade filled later (a carried-over position) or changed by «Пересмотрел» (then `reason` is required).
 */
export async function PUT({ params, request }) {
	try {
		const r = savePlan(getApp().sqlite, Number(params.id), await body(request));
		// T-032: the thesis or «Пересмотрел» goes to the diary
		syncJournal(getApp().sqlite, getMarket().sqlite);
		return json(r);
	} catch (e) {
		return fail(e);
	}
}
