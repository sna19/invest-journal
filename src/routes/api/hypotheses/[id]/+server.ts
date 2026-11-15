import { error, json } from '@sveltejs/kit';
import { getAppDb } from '#lib/server/db.js';
import { getHypothesis, updateHypothesis } from '#lib/server/journal.js';
import { body, fail } from '#lib/server/respond.js';

const id = (s: string) => {
	const n = Number(s);
	if (!Number.isInteger(n) || n <= 0) error(404, 'нет такой гипотезы');
	return n;
};

export function GET({ params }) {
	const h = getHypothesis(getAppDb(), id(params.id));
	if (!h) error(404, 'нет такой гипотезы');
	return json(h);
}

/** PATCH { note?, tags?, lesson?, closeReason? } — anything else is refused with 409 (section 6). */
export async function PATCH({ params, request }) {
	try {
		const h = updateHypothesis(getAppDb(), id(params.id), await body(request));
		if (!h) error(404, 'нет такой гипотезы');
		return json(h);
	} catch (e) {
		return fail(e);
	}
}

/** Hypotheses are never deleted (section 6). */
export const DELETE = () => json({ message: 'Гипотезы не удаляются; в первые 24 часа можно отменить ошибку ввода' }, { status: 405 });
