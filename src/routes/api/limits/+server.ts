import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { jobIndustry, limits, setLimits } from '#lib/server/portfolioRisk.js';
import { body, fail } from '#lib/server/respond.js';

/** T-016: the limits — the job's industry share, the speculation budget and its loss — and the job's industry */
export function GET() {
	const j = jobIndustry(getApp().sqlite, getMarket().sqlite);
	return json({ ...limits(getApp().sqlite), employer: j?.employer ?? null, industry: j?.label ?? null });
}
export async function POST({ request }) {
	try {
		return json(setLimits(getApp().sqlite, await body(request)));
	} catch (e) {
		return fail(e);
	}
}
