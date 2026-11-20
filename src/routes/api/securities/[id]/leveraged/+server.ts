import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { leveragedFor } from '#lib/server/leveraged.js';
import { queueProfiles } from '#lib/server/jobs.js';
import { staleProfiles } from '#lib/server/market/profiles.js';

/** GET — ETFs with a daily leverage on the share or against it, and on its industry, sector and indices, with their fees */
export function GET({ params }) {
	const items = leveragedFor(getMarket().sqlite, Number(params.id));
	// the funds' fees come with their profiles: load the missing ones now, the card shows them on the next open
	const missing = staleProfiles(getMarket().sqlite, items.map((x) => x.id));
	if (missing.length) queueProfiles(missing);
	return json({ items, loading: missing.length });
}
