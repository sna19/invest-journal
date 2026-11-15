import { error, json } from '@sveltejs/kit';
import { getAppDb } from '#lib/server/db.js';
import { cancelHypothesis } from '#lib/server/journal.js';
import { fail } from '#lib/server/respond.js';

/** POST — cancel an input error, only within 24 hours of saving (section 6). */
export function POST({ params }) {
	try {
		const h = cancelHypothesis(getAppDb(), Number(params.id));
		if (!h) error(404, 'нет такой гипотезы');
		return json(h);
	} catch (e) {
		return fail(e);
	}
}
