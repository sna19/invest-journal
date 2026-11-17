import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { portfolioChart } from '#lib/server/charts.js';

/** GET ?compare=2,3 — the portfolio's return day by day against the chosen virtual ones and the benchmarks. */
export function GET({ params, url }) {
	const compare = (url.searchParams.get('compare') ?? '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0);
	const c = portfolioChart(getApp().sqlite, getMarket().sqlite, Number(params.id), compare);
	if (!c) error(404, 'нет такого портфеля');
	return json(c);
}
