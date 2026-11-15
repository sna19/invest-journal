import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { closeEarly } from '#lib/server/results.js';
import { body } from '#lib/server/respond.js';

/** POST { reason } — early close by hand (section 6): fixed on the last trading day up to today. */
export async function POST({ params, request }) {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'нет такой гипотезы');
	const r = closeEarly(getApp().sqlite, getMarket().sqlite, id, String((await body(request)).reason ?? ''));
	if ('error' in r) return json({ message: r.error }, { status: 409 });
	return json(r);
}
