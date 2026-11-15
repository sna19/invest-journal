import { json } from '@sveltejs/kit';
import { getAppDb } from '#lib/server/db.js';
import { listAuthors } from '#lib/server/journal.js';

/** GET /api/authors?sourceId= — authors typed before, this source's first (section 17). */
export function GET({ url }) {
	const id = Number(url.searchParams.get('sourceId'));
	return json({ items: listAuthors(getAppDb(), Number.isInteger(id) && id > 0 ? id : undefined) });
}
