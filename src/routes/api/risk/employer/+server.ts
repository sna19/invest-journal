import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { body } from '#lib/server/respond.js';
import { employerOf, setSetting } from '#lib/server/risk.js';

/** T-023: the employer's share — the job's risk («связь с работой»). GET; PUT { symbol } (empty — none) */
export function GET() {
	return json({ employer: employerOf(getApp().sqlite, getMarket().sqlite) });
}
export async function PUT({ request }) {
	const b = await body(request);
	const sym = String(b.symbol ?? '').trim().toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 12);
	setSetting(getApp().sqlite, 'employer', sym || null);
	return json({ employer: employerOf(getApp().sqlite, getMarket().sqlite) });
}
