import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { cleanParams, costRun, universe, type CostRun, type Variant } from '#lib/server/model/quarterly.js';
import { readParams, SOURCE_NAME, VARIANTS } from '#lib/server/model/service.js';

/** the last answers: the same parameters on the same data are not counted again */
const cache = new Map<string, CostRun>();

/**
 * GET /api/model/costs?variant=A[&k=…] — T-012: the variant's portfolio over the last 12 quarters before and after
 * the fee and the tax, with «hold if chosen again» and without; the turnover. The parameters as in /api/model.
 */
export function GET({ url }) {
	const v = (url.searchParams.get('variant') ?? 'A') as Variant;
	if (!VARIANTS.includes(v)) error(400, 'variant A | B | C');
	const t0 = performance.now();
	const u = universe(getMarket().sqlite);
	const over = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'variant' && k !== 'quarter'));
	const params = cleanParams(over, readParams(getApp().sqlite, v));
	const key = `${u.builtAt}|${v}|${JSON.stringify(params)}`;
	let run = cache.get(key);
	if (!run && u.stocks.length) {
		run = costRun(u, v, params);
		cache.set(key, run);
		if (cache.size > 30) cache.delete(cache.keys().next().value!);
	}
	// the variant's automatic portfolios — they are kept with the same fee, tax and rule from the first quarter on
	const ports = getApp()
		.sqlite.prepare(
			`select p.id, p.name, p.auto_hold as hold from portfolios p join sources s on s.id = p.auto_source_id
			  where s.kind = 'model' and s.name = ? and p.archived_at is null order by p.auto_hold desc, p.currency desc`
		)
		.all(SOURCE_NAME[v]);
	return json({ variant: v, costs: run ?? null, portfolios: ports, ms: Math.round(performance.now() - t0) });
}
