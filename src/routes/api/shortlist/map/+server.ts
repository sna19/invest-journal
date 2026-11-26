import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { queueSecurity } from '#lib/server/jobs.js';
import { setMap } from '#lib/server/risk.js';

/** GET ?years=2 — the map of ties of the picked securities (equal weights, weekly returns in dollars) */
export function GET({ url }) {
	const ids = (getApp().sqlite.prepare('select security_id as id from shortlist order by added_at desc').all() as { id: number }[]).map((r) => r.id).slice(0, 30);
	if (ids.length < 2) return json({ map: null });
	const map = setMap(getMarket().sqlite, ids, Number(url.searchParams.get('years')) || 2);
	for (const id of map.loading) queueSecurity(id);
	return json({ map });
}
