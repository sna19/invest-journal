import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { htmlOf, revisions } from '#lib/server/diary.js';

/** Д-33: every text the entry had, the first one included */
export function GET({ params }) {
	return json({ items: revisions(getApp().sqlite, Number(params.id)).map((r) => ({ ...r, html: htmlOf(r.body, r.format) })) });
}
