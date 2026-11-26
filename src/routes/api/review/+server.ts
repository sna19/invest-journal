import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { honestReview, periodOf } from '#lib/server/honest.js';

/** Д-44: GET ?period=month | quarter | all — «Честный разбор» */
export function GET({ url }) {
	const p = url.searchParams.get('period');
	return json(honestReview(getApp().sqlite, getMarket().sqlite, periodOf(p === 'quarter' || p === 'all' ? p : 'month')));
}
