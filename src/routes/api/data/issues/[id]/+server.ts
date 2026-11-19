import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { runHypothesesStep } from '#lib/server/jobs.js';
import { decideIssue } from '#lib/server/market/decide.js';
import { body } from '#lib/server/respond.js';

/**
 * POST { decision: valid | invalid } — «Цена верна» / «Цена ошибочна» for a jump. The hypotheses step runs at once,
 * so a hypothesis that waited for this day closes now rather than tomorrow morning.
 */
export async function POST({ params, request }) {
	const d = String((await body(request)).decision ?? '');
	if (d !== 'valid' && d !== 'invalid') return json({ message: 'decision: valid | invalid' }, { status: 400 });
	const r = decideIssue(getMarket().sqlite, Number(params.id), d);
	if ('error' in r) return json({ message: r.error }, { status: 409 });
	const h = runHypothesesStep();
	return json({ ...r, closed: h.closed });
}
