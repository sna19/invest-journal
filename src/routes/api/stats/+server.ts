import { json } from '@sveltejs/kit';
import { getAppDb } from '#lib/server/db.js';
import { overallStats } from '#lib/server/overall.js';

/** GET /api/stats?noDefault=1 — the «Статистика» screen (spec sections 7 and 9). */
export function GET({ url }) {
	return json(overallStats(getAppDb(), { noDefault: url.searchParams.get('noDefault') === '1' }));
}
