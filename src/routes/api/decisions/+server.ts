import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { decideOther } from '#lib/server/decisions.js';
import { body, fail } from '#lib/server/respond.js';

/** T-032 11б: POST { type: 'skip' | 'defer', securityId, portfolioId?, basis, basisRef?, why, reviewDate } — «Не покупаю» / «Отложить» */
export async function POST({ request }) {
	try {
		return json({ id: decideOther(getApp().sqlite, getMarket().sqlite, await body(request)) }, { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
