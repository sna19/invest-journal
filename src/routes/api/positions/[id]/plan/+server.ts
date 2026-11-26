import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { decideHold, syncDecisions, underSignal } from '#lib/server/decisions.js';
import { savePlan } from '#lib/server/discipline.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * T-015. PUT { kind, thesis, wrongIf, stop, target, reviewDate, noStopReason, reason } — the conditions of a position's
 * trade filled later (a carried-over position) or changed by «Пересмотрел» (then `reason` is required).
 */
export async function PUT({ params, request }) {
	try {
		const app = getApp().sqlite;
		const market = getMarket().sqlite;
		const id = Number(params.id);
		// T-032 11б: «Пересмотрел» while a signal stands is a decision «держать»
		const signalled = underSignal(app, market, id);
		const r = savePlan(app, id, await body(request));
		if (r.reviewed && signalled && r.noteEventId) decideHold(app, market, id, r.noteEventId);
		syncDecisions(app, market);
		return json(r);
	} catch (e) {
		return fail(e);
	}
}
