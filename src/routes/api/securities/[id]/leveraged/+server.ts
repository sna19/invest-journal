import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { leveragedFor } from '#lib/server/leveraged.js';

/** GET — ETFs with a daily leverage on the share or against it, and on its industry, sector and indices */
export function GET({ params }) {
	return json({ items: leveragedFor(getMarket().sqlite, Number(params.id)) });
}
