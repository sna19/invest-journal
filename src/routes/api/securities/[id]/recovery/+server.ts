import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { recoveryOf } from '#lib/server/recovery.js';

/** GET ?since=YYYY-MM-DD — the price's state after a fall (owner 27.11.2026, «Разбор просадки») */
export function GET({ params, url }) {
	const since = url.searchParams.get('since');
	return json(recoveryOf(getMarket().sqlite, Number(params.id), since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null));
}
