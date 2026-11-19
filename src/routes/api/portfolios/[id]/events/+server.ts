import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { addEvent } from '#lib/server/portfolio.js';
import { queueSecurity, runProfilesJob } from '#lib/server/jobs.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * POST { securityId | positionId, kind, date, qty, price, fee, amount, note, hypothesisId, confirm } — an event of a
 * position; the first one for a security opens the position. 409 { confirm: true } — a price to look at again.
 */
export async function POST({ params, request }) {
	try {
		const app = getApp().sqlite;
		const input = { ...(await body(request)), portfolioId: Number(params.id) };
		// one transaction: a refused event leaves no empty position behind
		const r = app.transaction(() => addEvent(app, getMarket().sqlite, input))();
		// section 14 ring 1: a security that came into a portfolio gets its price history
		const sid = (input as { securityId?: unknown }).securityId;
		if (sid) queueSecurity(Number(sid));
		// and its profile (sector, industry, …) for the allocation block
		if (sid) void runProfilesJob().catch((e) => console.error(`profiles: ${e}`));
		return json(r, { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
