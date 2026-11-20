import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { cleanParams, nextQuarter, runModel, universe, type Variant } from '#lib/server/model/quarterly.js';
import { readParams, upcoming, VARIANTS, writeParams } from '#lib/server/model/service.js';
import { body } from '#lib/server/respond.js';

/**
 * GET /api/model?variant=A&quarter=1[&k=…] — the preview (T-009): the saved parameters with any overridden by the
 * query, the candidates and the check, without recording anything. PUT { variant, …params } — saves them.
 */
export function GET({ url }) {
	const v = (url.searchParams.get('variant') ?? 'A') as Variant;
	if (!VARIANTS.includes(v)) error(400, 'variant A | B | C');
	const t0 = performance.now();
	const m = getMarket().sqlite;
	const u = universe(m);
	const saved = readParams(getApp().sqlite, v);
	const q = Number(url.searchParams.get('quarter') ?? nextQuarter().quarter);
	if (![1, 2, 3, 4].includes(q)) error(400, 'quarter 1–4');
	const over = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'variant' && k !== 'quarter'));
	const params = cleanParams(over, saved);
	const result = u.stocks.length ? runModel(u, v, q, params) : null;
	const app = getApp().sqlite;
	const recorded = app.prepare('select variant, quarter, hypotheses, recorded_at as at from model_quarters order by quarter desc limit 8').all();
	const loads = m.prepare(`select count(*) as n, sum(status = 'ok') as ok, max(fetched_at) as at from ops_monthly_loads`).get();
	const due = m.prepare(`select count(*) as n from ref_securities where type = 'stock' and active = 1 and manual = 0`).get() as { n: number };
	return json({
		variant: v,
		saved,
		result,
		upcoming: upcoming(),
		recorded,
		data: { stocks: u.stocks.length, shares: due.n, loads, sectors: u.stocks.filter((s) => s.sector).length },
		ms: Math.round(performance.now() - t0)
	});
}

export async function PUT({ request }) {
	const b = await body(request);
	const v = String(b.variant ?? '') as Variant;
	if (!VARIANTS.includes(v)) error(400, 'variant A | B | C');
	return json({ saved: writeParams(getApp().sqlite, v, b) });
}
