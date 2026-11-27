import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { chartsWith, createChart, listCharts } from '#lib/server/savedCharts.js';
import { body, fail } from '#lib/server/respond.js';

/** owner 27.11.2026, saved charts: GET — all (?security=id — those it takes part in); POST { name, securityId, config } — a new one */
export function GET({ url }) {
	const sec = Number(url.searchParams.get('security'));
	return json({ items: sec ? chartsWith(getApp().sqlite, getMarket().sqlite, sec) : listCharts(getApp().sqlite, getMarket().sqlite) });
}
export async function POST({ request }) {
	try {
		return json(createChart(getApp().sqlite, getMarket().sqlite, await body(request)));
	} catch (e) {
		return fail(e);
	}
}
