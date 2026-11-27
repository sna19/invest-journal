import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { queueSecurities } from '#lib/server/jobs.js';
import { setMap } from '#lib/server/risk.js';

/** GET ?ids=1,2,…&years=2 — the map of ties of any set (owner 27.11.2026, «наборы») */
export function GET({ url }) {
	const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 30);
	if (ids.length < 2) return json({ map: null });
	const map = setMap(getMarket().sqlite, ids, Number(url.searchParams.get('years')) || 2);
	queueSecurities(map.loading);
	return json({ map });
}
