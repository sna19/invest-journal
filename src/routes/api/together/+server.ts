import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { together } from '#lib/server/portfolio.js';

/** GET ?currency=ILS|USD — «Всё вместе» (section 18): the real portfolios in one currency at today's rate. */
export function GET({ url }) {
	return json(together(getApp().sqlite, getMarket().sqlite, url.searchParams.get('currency') === 'USD' ? 'USD' : 'ILS'));
}
