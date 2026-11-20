import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { portfolioReport } from '#lib/server/report.js';

/** GET — the portfolio's report: the months and the closed trades (owner's request 20.11.2026) */
export function GET({ params }) {
	const r = portfolioReport(getApp().sqlite, getMarket().sqlite, Number(params.id));
	if (!r) error(404, 'нет такого портфеля');
	return json(r);
}
