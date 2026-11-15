import { json } from '@sveltejs/kit';
import { getAppDb } from '#lib/server/db.js';
import { sourceTable } from '#lib/server/sources.js';

/** GET /api/sources/stats[?noDefault=1] — the «Источники» table (sections 7 and 17). */
export function GET({ url }) {
	return json({ items: sourceTable(getAppDb(), { noDefault: url.searchParams.get('noDefault') === '1' }) });
}
