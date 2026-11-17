import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { setAuto } from '#lib/server/portfolio.js';
import { body, fail } from '#lib/server/respond.js';

/** POST { on } — the source's automatic virtual portfolio (section 18): made and filled at once, or archived. */
export async function POST({ params, request }) {
	try {
		return json({ portfolio: setAuto(getApp().sqlite, getMarket().sqlite, Number(params.id), !!(await body(request)).on) });
	} catch (e) {
		return fail(e);
	}
}
