import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { saveReview } from '#lib/server/portfolioRisk.js';
import { body, fail } from '#lib/server/respond.js';

/** T-016 «Разбор позиций»: POST { thesis, wouldBuy, exit } */
export async function POST({ params, request }) {
	try {
		return json(saveReview(getApp().sqlite, getMarket().sqlite, Number(params.id), await body(request)));
	} catch (e) {
		return fail(e);
	}
}
