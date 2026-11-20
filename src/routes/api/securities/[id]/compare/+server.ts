import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { compareTable } from '#lib/server/compare.js';
import { benchmarkId } from '#lib/server/portfolio.js';
import { queueSecurity } from '#lib/server/jobs.js';

/** GET — what the security belongs to (sector, industry, indices) and its returns against each (20.11.2026) */
export function GET({ params }) {
	const m = getMarket().sqlite;
	const id = Number(params.id);
	const c = m.prepare(`select e.country from ref_securities s join ref_exchanges e on e.code = s.exchange_code where s.id = ?`).get(id) as { country: string } | undefined;
	const bench = c ? (benchmarkId(m, c.country === 'IL' ? 'benchmark:TA125' : 'benchmark:SPX') ?? null) : null;
	const t = compareTable(m, id, bench);
	// a reference without daily history yet: load it now, the card shows it after the load
	for (const r of t.refs) if (!r.loaded) queueSecurity(r.id);
	return json(t);
}
