import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { startError } from '#lib/server/start.js';

/** Used by the deploy script and Docker HEALTHCHECK: 200 only if both data files are readable. */
export function GET() {
	const failed = startError();
	if (failed) return json({ ok: false, built: __BUILD_TIME__, error: failed }, { status: 503 });
	try {
		getApp().sqlite.prepare('select 1').get();
		getMarket().sqlite.prepare('select 1').get();
		return json({ ok: true, built: __BUILD_TIME__ });
	} catch (e) {
		return json({ ok: false, built: __BUILD_TIME__, error: String(e) }, { status: 503 });
	}
}
