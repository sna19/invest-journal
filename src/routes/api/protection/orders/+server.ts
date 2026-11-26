import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { cancelOrder, placeOrder } from '#lib/server/protection.js';
import { body, fail } from '#lib/server/respond.js';

/** T-021: POST { positionId, type: fixed|trail, stop, limit, trailPct, price, qty } — «Я выставил у брокера»; DELETE ?position= — the order is gone */
export async function POST({ request }) {
	try {
		return json({ id: placeOrder(getApp().sqlite, await body(request)) });
	} catch (e) {
		return fail(e);
	}
}
export function DELETE({ url }) {
	return json({ cancelled: cancelOrder(getApp().sqlite, Number(url.searchParams.get('position'))) });
}
