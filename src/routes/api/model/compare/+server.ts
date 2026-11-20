import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { costRun, nextQuarter, runModel, universe } from '#lib/server/model/quarterly.js';
import { readParams, VARIANTS } from '#lib/server/model/service.js';

const cache = new Map<string, unknown>();

/**
 * GET /api/model/compare?quarter=1 — T-018 (13): the variants side by side with their saved parameters: how many
 * passed, the placebo, the check without peeking against all shares, the portfolio after costs (12 quarters).
 */
export function GET({ url }) {
	const q = Number(url.searchParams.get('quarter') ?? nextQuarter().quarter);
	if (![1, 2, 3, 4].includes(q)) error(400, 'quarter 1–4');
	const u = universe(getMarket().sqlite);
	if (!u.stocks.length) return json({ items: [] });
	const app = getApp().sqlite;
	const items = VARIANTS.map((v) => {
		const p = readParams(app, v);
		const key = `${u.builtAt}|${v}|${q}|${JSON.stringify(p)}`;
		let row = cache.get(key);
		if (!row) {
			const r = runModel(u, v, q, p);
			const walk = r.walk.filter((w) => w.pickedMean !== null && w.allMean !== null);
			const c = costRun(u, v, p);
			row = {
				variant: v,
				passed: r.passed,
				candidates: r.candidates.length,
				placebo: { real: r.placebo.real, mean: r.placebo.mean, share: r.placebo.share, verdict: r.placebo.verdict },
				walkVsAll: walk.length ? Math.round((walk.reduce((a, w) => a + w.pickedMean! - w.allMean!, 0) / walk.length) * 100) / 100 : null,
				gross: c.gross,
				afterCosts: c.hold.cagr
			};
			cache.set(key, row);
			if (cache.size > 40) cache.delete(cache.keys().next().value!);
		}
		return row;
	});
	return json({ quarter: q, items });
}
