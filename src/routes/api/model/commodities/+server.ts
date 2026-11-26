import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { DEFAULT_FUNDS, GROUPS, readFunds, writeFunds } from '#lib/server/model/commodities.js';
import { body, fail } from '#lib/server/respond.js';

/** T-031: the list of commodity funds (symbol, group, twin) and the broad fund of variant B */
export function GET() {
	return json({ ...readFunds(getApp().sqlite), groups: GROUPS, defaults: DEFAULT_FUNDS });
}
export async function POST({ request }) {
	try {
		return json(writeFunds(getApp().sqlite, await body(request)));
	} catch (e) {
		return fail(e);
	}
}
