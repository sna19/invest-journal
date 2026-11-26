import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { sectorView } from '#lib/server/sector.js';
import { queueSecurity } from '#lib/server/jobs.js';

/** GET ?sector=technology[&industry=Semiconductors][&country=US|IL] — a sector's or an industry's page (26.11.2026) */
export function GET({ url }) {
	const sector = url.searchParams.get('sector');
	const industry = url.searchParams.get('industry');
	const c = url.searchParams.get('country');
	const v = sectorView(getMarket().sqlite, { sector, industry, country: c === 'US' || c === 'IL' ? c : null });
	if (v.etf) queueSecurity(v.etf.id);
	return json(v);
}
