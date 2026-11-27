import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { composition, setOverride } from '#lib/server/portfolioRisk.js';
import { fundLinks } from '#lib/server/compare.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * T-016: a fund's composition (sectors, countries, industries, top holdings) and where each comes from; owner
 * 27.11.2026: each top holding with its card, and the sector page the fund stands for (XLV → «Здравоохранение»).
 */
export function GET({ params }) {
	const market = getMarket().sqlite;
	const c = composition(getApp().sqlite, market, Number(params.id));
	return json({ ...c, ...fundLinks(market, Number(params.id), c) });
}

/** POST { kind: 'sector' | 'country' | 'industry', weights: { key: percent } } — set by hand; {} goes back to the provider */
export async function POST({ params, request }) {
	try {
		const b = await body(request);
		setOverride(getApp().sqlite, Number(params.id), b.kind, b.weights);
		const market = getMarket().sqlite;
		const c = composition(getApp().sqlite, market, Number(params.id));
		return json({ ...c, ...fundLinks(market, Number(params.id), c) });
	} catch (e) {
		return fail(e);
	}
}
