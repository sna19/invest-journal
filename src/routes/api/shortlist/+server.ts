import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { body } from '#lib/server/respond.js';
import { queueSecurities } from '#lib/server/jobs.js';
import { setItems } from '#lib/server/setItems.js';

/** GET — the picked securities with what a glance needs: price, the day, 1M / 3M / 1Y, sector, market cap */
export function GET() {
	const rows = getApp().sqlite.prepare('select security_id as id, origin, added_at as addedAt from shortlist order by added_at desc').all() as { id: number; origin: string | null; addedAt: string }[];
	const r = setItems(getMarket().sqlite, rows);
	queueSecurities(r.missing);
	return json({ items: r.items });
}

/** PUT { securityId, on, origin } — pick or unpick */
export async function PUT({ request }) {
	const b = await body(request);
	const id = Number(b.securityId);
	const app = getApp().sqlite;
	if (!Number.isInteger(id) || id <= 0) return json({ ok: false }, { status: 400 });
	if (b.on === false) app.prepare('delete from shortlist where security_id = ?').run(id);
	else app.prepare('insert or ignore into shortlist (security_id, origin) values (?, ?)').run(id, typeof b.origin === 'string' ? b.origin.slice(0, 60) : null);
	return json({ ok: true });
}
