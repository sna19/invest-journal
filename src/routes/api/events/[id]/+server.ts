import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { editEvent } from '#lib/server/portfolio.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * PATCH { date, qty, price, fee, amount, costTotal, note, confirm } — correct an event in place (owner's request,
 * 18.11.2026); what it was before is kept in event_edits. 409 { confirm: true } — a price to look at again.
 */
export async function PATCH({ params, request }) {
	try {
		return json(editEvent(getApp().sqlite, getMarket().sqlite, Number(params.id), await body(request)));
	} catch (e) {
		return fail(e);
	}
}
