import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { aboutOf } from '#lib/server/market/about.js';

/** «О компании»: what the company (or the fund) does — the provider's summary and its Russian translation, the site, staff, seat */
export async function GET({ params }) {
	return json({ about: await aboutOf(getMarket().sqlite, Number(params.id)) });
}
