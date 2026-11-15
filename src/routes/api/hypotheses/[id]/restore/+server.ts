import { error, json } from '@sveltejs/kit';
import { getAppDb } from '#lib/server/db.js';
import { restoreHypothesis } from '#lib/server/journal.js';
import { fail } from '#lib/server/respond.js';

/** POST — «Отменить» on the bar after a cancel: back to open, within the same 24 hours. */
export function POST({ params }) {
	try {
		const h = restoreHypothesis(getAppDb(), Number(params.id));
		if (!h) error(404, 'нет такой гипотезы');
		return json(h);
	} catch (e) {
		return fail(e);
	}
}
