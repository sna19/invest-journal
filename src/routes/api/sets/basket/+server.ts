import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { basket } from '#lib/server/basket.js';

/** GET ?ids=1,2,…&years=1 — the set bought equally at the start of the period, against the index (owner 27.11.2026) */
export function GET({ url }) {
	const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 30);
	const y = Number(url.searchParams.get('years'));
	return json(basket(getMarket().sqlite, ids, [1, 3, 5].includes(y) ? y : 1));
}
