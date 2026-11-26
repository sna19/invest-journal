import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { momentumView, writeMParams } from '#lib/server/model/momentumService.js';
import { body, fail } from '#lib/server/respond.js';

/** T-017: GET ?lookback=&skip=&top=&rebalance= — the screen with these parameters (not saved); POST { … } — saved */
export function GET({ url }) {
	const over: Record<string, unknown> = {};
	for (const k of ['lookback', 'skip', 'top', 'rebalance', 'years', 'commissionPct', 'taxPct']) if (url.searchParams.has(k)) over[k] = url.searchParams.get(k);
	return json(momentumView(getApp().sqlite, getMarket().sqlite, over));
}

export async function POST({ request }) {
	try {
		return json({ params: writeMParams(getApp().sqlite, await body(request)) });
	} catch (e) {
		return fail(e);
	}
}
