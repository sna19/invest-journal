import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { deleteChart, getChart, updateChart } from '#lib/server/savedCharts.js';
import { body, fail } from '#lib/server/respond.js';

/** a saved chart: GET; PUT { name?, config? } — changed; DELETE */
export function GET({ params }) {
	const c = getChart(getApp().sqlite, getMarket().sqlite, Number(params.id));
	if (!c) error(404, 'нет такого графика');
	return json(c);
}
export async function PUT({ params, request }) {
	try {
		return json(updateChart(getApp().sqlite, getMarket().sqlite, Number(params.id), await body(request)));
	} catch (e) {
		return fail(e);
	}
}
export function DELETE({ params }) {
	deleteChart(getApp().sqlite, Number(params.id));
	return json({ ok: true });
}
