import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { PERIODS, securityChart, type Period } from '#lib/server/charts.js';

/** GET ?period=1M|3M|6M|1Y|5Y|10Y — the security card's chart (section 19): price, benchmark, marks. */
export function GET({ params, url }) {
	const p = url.searchParams.get('period') ?? '1Y';
	const period = (p in PERIODS ? p : '1Y') as Period;
	const c = securityChart(getApp().sqlite, getMarket().sqlite, Number(params.id), period);
	if (!c) error(404, 'нет такой бумаги');
	return json(c);
}
