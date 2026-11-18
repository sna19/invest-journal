import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { exportPortfolio } from '#lib/server/portfolio.js';

/** GET — the portfolio as JSON for an AI adviser: totals, positions with their history, money, hypotheses. */
export function GET({ params }) {
	const x = exportPortfolio(getApp().sqlite, getMarket().sqlite, Number(params.id));
	if (!x) error(404, 'нет такого портфеля');
	return json(x);
}
