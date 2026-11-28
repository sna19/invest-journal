import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { countriesView } from '#lib/server/countries.js';
import { queueProfiles, queueSecurities } from '#lib/server/jobs.js';

/** GET — the country and regional funds with their returns, momentum, trend, risk, yield, P/E and fee (owner 28.11.2026) */
export async function GET() {
	const m = getMarket().sqlite;
	const v = await countriesView(m);
	// a fund without daily history: loaded in the background; its fee from the profile
	if (v.missing.length) queueSecurities(v.missing);
	queueProfiles(v.rows.filter((r) => r.fee === null).map((r) => r.id));
	return json(v);
}
