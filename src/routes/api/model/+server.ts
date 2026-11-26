import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { nextQuarter, runModel, universe, type Variant } from '#lib/server/model/quarterly.js';
import { cleanFor, POOL_VARIANTS, poolUniverse, readParams, upcoming, writeParams, type Pool } from '#lib/server/model/service.js';
import { ensureFunds, commoditySymbols } from '#lib/server/model/commodities.js';
import { body } from '#lib/server/respond.js';

/**
 * GET /api/model?variant=A&quarter=1[&k=…] — the preview (T-009): the saved parameters with any overridden by the
 * query, the candidates and the check, without recording anything. PUT { variant, …params } — saves them.
 */
export function GET({ url }) {
	const pool: Pool = url.searchParams.get('pool') === 'commodities' ? 'commodities' : 'stocks';
	const v = (url.searchParams.get('variant') ?? 'A') as Variant;
	if (!POOL_VARIANTS[pool].includes(v)) error(400, `variant ${POOL_VARIANTS[pool].join(' | ')}`);
	const t0 = performance.now();
	const m = getMarket().sqlite;
	const saved = readParams(getApp().sqlite, v, pool);
	const q = Number(url.searchParams.get('quarter') ?? nextQuarter().quarter);
	if (![1, 2, 3, 4].includes(q)) error(400, 'quarter 1–4');
	const over = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'variant' && k !== 'quarter' && k !== 'pool'));
	const params = cleanFor(over, saved, pool);
	// T-031: the commodity funds — the user's list, loaded now if their monthly prices are missing
	const pu = poolUniverse(getApp().sqlite, m, pool, params.years);
	const u = pu.u;
	const ens = pool === 'commodities' ? ensureFunds(m, commoditySymbols(getApp().sqlite)) : null;
	const loading = ens ? { missing: ens.missing, loading: ens.loading } : null;
	const result = u.stocks.length ? runModel(u, v, q, params) : null;
	const app = getApp().sqlite;
	const recorded = app.prepare(`select variant, quarter, hypotheses, recorded_at as at from model_quarters where variant in ('A', 'B', 'C', 'D', 'G') order by quarter desc limit 8`).all();
	const loads = m.prepare(`select count(*) as n, sum(status = 'ok') as ok, max(fetched_at) as at from ops_monthly_loads`).get();
	const due = m.prepare(`select count(*) as n from ref_securities where type = 'stock' and active = 1 and manual = 0`).get() as { n: number };
	return json({
		variant: v,
		pool,
		funds: pu.funds,
		loading,
		saved,
		result,
		upcoming: upcoming(),
		recorded,
		data: { stocks: pool === 'stocks' ? u.stocks.length : universe(m).stocks.length, shares: due.n, loads, sectors: u.stocks.filter((s) => s.sector).length },
		ms: Math.round(performance.now() - t0)
	});
}

export async function PUT({ request }) {
	const b = await body(request);
	const pool: Pool = b.pool === 'commodities' ? 'commodities' : 'stocks';
	const v = String(b.variant ?? '') as Variant;
	if (!POOL_VARIANTS[pool].includes(v)) error(400, `variant ${POOL_VARIANTS[pool].join(' | ')}`);
	const { pool: _p, ...rest } = b;
	void _p;
	return json({ saved: writeParams(getApp().sqlite, v, rest, pool) });
}
