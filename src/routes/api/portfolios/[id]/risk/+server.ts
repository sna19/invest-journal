import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { queueSecurity } from '#lib/server/jobs.js';
import { employerOf, riskView } from '#lib/server/risk.js';

/**
 * GET ?years=2&add=1,2,3 (id «all» — all real portfolios together, in shekels) — T-023: the portfolio's risk map, and what the simulator needs for the tried securities
 * (up to 3). A security without daily history is put in the load queue; the screen asks again later.
 */
export function GET({ params, url }) {
	const add = (url.searchParams.get('add') ?? '')
		.split(',')
		.map(Number)
		.filter((x) => Number.isInteger(x) && x > 0)
		// the «Что если?» screen tries up to 3; a set (owner 27.11.2026) — up to 12
		.slice(0, 12);
	const r = riskView(getApp().sqlite, getMarket().sqlite, params.id === 'all' ? 'all' : Number(params.id), { years: Number(url.searchParams.get('years')) || 2, add });
	if (!r) error(404, 'нет такого портфеля');
	for (const id of r.loading) queueSecurity(id);
	return json({ ...r, employer: employerOf(getApp().sqlite, getMarket().sqlite)?.symbol ?? null });
}
