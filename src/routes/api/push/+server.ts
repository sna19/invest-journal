import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { devices, pushKinds, sendAll, setPushKinds, subscribe, unsubscribe, vapid } from '#lib/server/push.js';
import { body, fail } from '#lib/server/respond.js';

/** T-015 Web Push. GET — the public key, the devices, the kinds of signals sent */
export function GET() {
	const app = getApp().sqlite;
	return json({ publicKey: vapid().publicKey, devices: devices(app).map((d) => ({ endpoint: d.endpoint, device: d.device, createdAt: d.createdAt })), kinds: pushKinds(app) });
}

/** POST { action: 'subscribe', subscription, device } | { action: 'unsubscribe', endpoint } | { action: 'test' } | { action: 'kinds', kinds } */
export async function POST({ request }) {
	try {
		const app = getApp().sqlite;
		const b = await body(request);
		if (b.action === 'subscribe') subscribe(app, getMarket().sqlite, b.subscription, b.device);
		else if (b.action === 'unsubscribe') unsubscribe(app, b.endpoint);
		else if (b.action === 'kinds') setPushKinds(app, b.kinds);
		else if (b.action === 'test') {
			const n = await sendAll(app, { title: 'invest-journal', body: 'Проверка: уведомления работают.', url: '/settings' });
			return json({ sent: n });
		} else return json({ message: 'Неизвестное действие' }, { status: 400 });
		return json({ ok: true, kinds: pushKinds(app), devices: devices(app).length });
	} catch (e) {
		return fail(e);
	}
}
