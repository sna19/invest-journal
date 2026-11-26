import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { savePlan } from '#lib/server/discipline.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * T-015. PUT { kind, thesis, wrongIf, stop, target, reviewDate, noStopReason, reason } — the conditions of a position's
 * trade filled later (a carried-over position) or changed by «Пересмотрел» (then `reason` is required).
 */
export async function PUT({ params, request }) {
	try {
		return json(savePlan(getApp().sqlite, Number(params.id), await body(request)));
	} catch (e) {
		return fail(e);
	}
}
