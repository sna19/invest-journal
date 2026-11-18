import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { editCash } from '#lib/server/portfolio.js';
import { body, fail } from '#lib/server/respond.js';

/** PATCH { date, amount, toAmount, note } — correct a money record in place; the old values go to event_edits. */
export async function PATCH({ params, request }) {
	try {
		return json({ portfolioId: editCash(getApp().sqlite, getMarket().sqlite, Number(params.id), await body(request)) });
	} catch (e) {
		return fail(e);
	}
}
