import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { cleanParams, laggards, nextQuarter, trendTable, universe, type TrendRow, type Variant } from '#lib/server/model/quarterly.js';
import { readParams, VARIANTS } from '#lib/server/model/service.js';

const cache = new Map<string, TrendRow[]>();

/**
 * GET /api/model/trend?variant=A&quarter=1[&k=…] — T-018: the table «trend filter × trend exit» (all years, without
 * peeking, placebo) and «do the laggards catch up?» (past candidates of A and B). The parameters as in /api/model.
 */
export function GET({ url }) {
	const v = (url.searchParams.get('variant') ?? 'A') as Variant;
	if (!VARIANTS.includes(v)) error(400, 'variant A | B | C | D');
	const q = Number(url.searchParams.get('quarter') ?? nextQuarter().quarter);
	if (![1, 2, 3, 4].includes(q)) error(400, 'quarter 1–4');
	const t0 = performance.now();
	const u = universe(getMarket().sqlite);
	const over = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'variant' && k !== 'quarter'));
	const p = cleanParams(over, readParams(getApp().sqlite, v));
	// the table does not depend on the filter and exit chosen: they are its rows
	const key = `${u.builtAt}|${v}|${q}|${JSON.stringify({ ...p, trendFilter: '', trendExit: '' })}`;
	let table = cache.get(key);
	if (!table && u.stocks.length) {
		table = trendTable(u, v, q, p);
		cache.set(key, table);
		if (cache.size > 40) cache.delete(cache.keys().next().value!);
	}
	return json({ table: table ?? [], laggards: u.stocks.length ? laggards(u, { ...readParams(getApp().sqlite, 'A'), lagThreshold: p.lagThreshold }) : null, ms: Math.round(performance.now() - t0) });
}
