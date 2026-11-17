import { error, json } from '@sveltejs/kit';
import { getApp, getAppDb } from '#lib/server/db.js';
import { sourceCard } from '#lib/server/sources.js';

/** GET /api/sources/<id>[?noDefault=1] — the source card (section 9). */
export function GET({ params, url }) {
	const card = sourceCard(getAppDb(), Number(params.id), { noDefault: url.searchParams.get('noDefault') === '1' });
	if (!card) error(404, 'нет такого источника');
	// section 18: the source's automatic portfolio, if it was ever switched on
	const auto = getApp()
		.sqlite.prepare('select id, name, archived_at as archivedAt, auto_amount_ils as amount from portfolios where auto_source_id = ?')
		.get(Number(params.id));
	return json({ ...card, auto: auto ?? null });
}
