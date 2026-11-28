import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { dividendView } from '#lib/server/dividends.js';

/** GET — the portfolio's dividends: received this year by security, the yields, growth and cuts, the next ones (owner 28.11.2026) */
export function GET({ params }) {
	const r = dividendView(getApp().sqlite, getMarket().sqlite, Number(params.id));
	if (!r) error(404, 'нет такого портфеля');
	return json(r);
}
