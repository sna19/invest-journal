import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { composition, setOverride } from '#lib/server/portfolioRisk.js';
import { body, fail } from '#lib/server/respond.js';

/** T-016: a fund's composition (sectors, countries, industries, top holdings) and where each comes from */
export function GET({ params }) {
	return json(composition(getApp().sqlite, getMarket().sqlite, Number(params.id)));
}

/** POST { kind: 'sector' | 'country' | 'industry', weights: { key: percent } } — set by hand; {} goes back to the provider */
export async function POST({ params, request }) {
	try {
		const b = await body(request);
		setOverride(getApp().sqlite, Number(params.id), b.kind, b.weights);
		return json(composition(getApp().sqlite, getMarket().sqlite, Number(params.id)));
	} catch (e) {
		return fail(e);
	}
}
