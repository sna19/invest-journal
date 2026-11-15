import { error, json } from '@sveltejs/kit';
import { getAppDb } from '#lib/server/db.js';
import { sourceCard } from '#lib/server/sources.js';

/** GET /api/sources/<id>[?noDefault=1] — the source card (section 9). */
export function GET({ params, url }) {
	const card = sourceCard(getAppDb(), Number(params.id), { noDefault: url.searchParams.get('noDefault') === '1' });
	if (!card) error(404, 'нет такого источника');
	return json(card);
}
