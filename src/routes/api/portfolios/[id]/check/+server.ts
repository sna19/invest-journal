import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { checkPurchase } from '#lib/server/portfolioRisk.js';

/** T-016: GET ?security=&amount=(in the portfolio's currency)&kind= — the warnings of a purchase: the job's industry over its limit, the speculation over its budget */
export function GET({ params, url }) {
	const p = url.searchParams;
	return json({ items: checkPurchase(getApp().sqlite, getMarket().sqlite, Number(params.id), Number(p.get('security')), Number(p.get('amount')), p.get('kind')) });
}
