import { error, json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { helpTopic } from '#lib/server/help.js';

/** GET /api/help/<key> — title and HTML of a help topic (spec section 8). */
export function GET({ params }) {
	const t = helpTopic(getApp().db, params.key);
	if (!t) error(404, 'нет такой темы справки');
	return json(t);
}
