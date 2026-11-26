import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { listRules, saveRule } from '#lib/server/discipline.js';
import { body, fail } from '#lib/server/respond.js';

/** T-015 «Мои правила»: GET — the list; POST { id?, text } — add or change; POST { id, move: 'up' | 'down' } — order */
export function GET() {
	return json({ items: listRules(getApp().sqlite) });
}

export async function POST({ request }) {
	try {
		return json({ items: saveRule(getApp().sqlite, await body(request)) });
	} catch (e) {
		return fail(e);
	}
}
