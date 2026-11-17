import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { reverseEvent } from '#lib/server/portfolio.js';
import { body, fail } from '#lib/server/respond.js';

/** POST { note } — storno: the event leaves the account, both stay in the history. */
export async function POST({ params, request }) {
	try {
		return json({ positionId: reverseEvent(getApp().sqlite, getMarket().sqlite, Number(params.id), (await body(request)).note) });
	} catch (e) {
		return fail(e);
	}
}
