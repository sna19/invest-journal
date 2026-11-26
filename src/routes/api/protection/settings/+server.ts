import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { brokerOf, PDEFAULTS, protectionStats, readPParams, writePParams } from '#lib/server/protection.js';
import { body, fail } from '#lib/server/respond.js';

/** T-021: the formula's coefficients, the broker's name (kept in the database), the «Статистика» numbers */
export function GET() {
	const app = getApp().sqlite;
	return json({ params: readPParams(app), defaults: PDEFAULTS, broker: brokerOf(app), stats: protectionStats(app) });
}
export async function POST({ request }) {
	try {
		return json(writePParams(getApp().sqlite, await body(request)));
	} catch (e) {
		return fail(e);
	}
}
