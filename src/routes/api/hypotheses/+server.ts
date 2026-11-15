import { json } from '@sveltejs/kit';
import { getAppDb, getMarket } from '#lib/server/db.js';
import { createHypothesis, listHypotheses, type ListFilter } from '#lib/server/journal.js';
import { body, fail } from '#lib/server/respond.js';
import type { HypothesisInput } from '#lib/hypothesis.js';

/** GET /api/hypotheses?status=open|closed|all&mode=sim|real|all&market=us|il|all&defaultHorizon=1 */
export function GET({ url }) {
	const p = url.searchParams;
	const pick = <T extends string>(k: string, ok: T[]) => (ok.includes(p.get(k) as T) ? (p.get(k) as T) : undefined);
	const f: ListFilter = {
		status: pick('status', ['open', 'closed', 'all']),
		mode: pick('mode', ['sim', 'real', 'all']),
		market: pick('market', ['us', 'il', 'all']),
		defaultHorizon: p.get('defaultHorizon') === '1'
	};
	return json({ items: listHypotheses(getAppDb(), f) });
}

/** POST — a new hypothesis (sections 2, 6, 17); 400 with field errors. */
export async function POST({ request }) {
	try {
		const h = createHypothesis(getAppDb(), getMarket().sqlite, (await body(request)) as HypothesisInput);
		return json(h, { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
