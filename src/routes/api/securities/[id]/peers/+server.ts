import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { peersOf } from '#lib/server/compare.js';
import { queueSecurities } from '#lib/server/jobs.js';

/** GET ?with=1,2 — the shares to compare a security with on its chart (its industry, its sector, the ones asked for) */
export function GET({ params, url }) {
	const extra = (url.searchParams.get('with') ?? '')
		.split(',')
		.map(Number)
		.filter((x) => Number.isInteger(x) && x > 0)
		.slice(0, 10);
	const r = peersOf(getMarket().sqlite, Number(params.id), extra);
	// a peer without daily history: loaded in the background, its line and correlation come after
	queueSecurities(r.peers.filter((p) => !p.loaded && (p.same !== 'sector' || extra.includes(p.id))).map((p) => p.id));
	return json(r);
}
