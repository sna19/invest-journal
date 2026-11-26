import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { cancelDecision } from '#lib/server/decisions.js';
import { fail } from '#lib/server/respond.js';

/** Д-19: cancel a decision within 24 hours (an input mistake) */
export function POST({ params }) {
	try {
		return json(cancelDecision(getApp().sqlite, Number(params.id)));
	} catch (e) {
		return fail(e);
	}
}
