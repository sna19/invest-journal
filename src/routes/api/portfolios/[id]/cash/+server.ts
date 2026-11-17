import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { addCash } from '#lib/server/portfolio.js';
import { body, fail } from '#lib/server/respond.js';

/** POST { kind: deposit | withdraw | dividend | fee | tax, date, amount, currency, note, positionId } — the portfolio's money. */
export async function POST({ params, request }) {
	try {
		return json(addCash(getApp().sqlite, getMarket().sqlite, Number(params.id), await body(request)), { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
