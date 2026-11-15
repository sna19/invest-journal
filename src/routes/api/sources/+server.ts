import { json } from '@sveltejs/kit';
import { getAppDb } from '#lib/server/db.js';
import { addSource, listSources } from '#lib/server/journal.js';
import { body, fail } from '#lib/server/respond.js';

export const GET = () => json({ items: listSources(getAppDb()) });

/** POST { name, domain? } — a source that is not in the list yet. */
export async function POST({ request }) {
	const b = await body(request);
	try {
		return json(addSource(getAppDb(), String(b.name ?? ''), b.domain ? String(b.domain) : null), { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
