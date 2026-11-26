import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { laggards, nextQuarter, trendTable, type TrendRow, type Variant } from '#lib/server/model/quarterly.js';
import { cleanFor, POOL_VARIANTS, poolUniverse, readParams, type Pool } from '#lib/server/model/service.js';

const cache = new Map<string, TrendRow[]>();

/**
 * GET /api/model/trend?variant=A&quarter=1[&k=…] — T-018: the table «trend filter × trend exit» (all years, without
 * peeking, placebo) and «do the laggards catch up?» (past candidates of A and B). The parameters as in /api/model.
 */
export function GET({ url }) {
	const pool: Pool = url.searchParams.get('pool') === 'commodities' ? 'commodities' : 'stocks';
	const v = (url.searchParams.get('variant') ?? 'A') as Variant;
	if (!POOL_VARIANTS[pool].includes(v)) error(400, 'variant');
	const q = Number(url.searchParams.get('quarter') ?? nextQuarter().quarter);
	if (![1, 2, 3, 4].includes(q)) error(400, 'quarter 1–4');
	const t0 = performance.now();
	const over = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'variant' && k !== 'quarter' && k !== 'pool'));
	const p = cleanFor(over, readParams(getApp().sqlite, v, pool), pool);
	const u = poolUniverse(getApp().sqlite, getMarket().sqlite, pool, p.years).u;
	// the table does not depend on the filter and exit chosen: they are its rows
	const key = `${u.builtAt}|${pool}|${u.stocks.length}|${v}|${q}|${JSON.stringify({ ...p, trendFilter: '', trendExit: '' })}`;
	let table = cache.get(key);
	if (!table && u.stocks.length) {
		table = trendTable(u, v, q, p);
		cache.set(key, table);
		if (cache.size > 40) cache.delete(cache.keys().next().value!);
	}
	return json({ table: table ?? [], laggards: u.stocks.length && pool === 'stocks' ? laggards(u, { ...readParams(getApp().sqlite, 'A'), lagThreshold: p.lagThreshold }) : null, ms: Math.round(performance.now() - t0) });
}
