import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { body } from '#lib/server/respond.js';
import { marketView } from '#lib/server/portfolio.js';
import { readProfiles } from '#lib/server/market/profiles.js';
import { queueSecurity } from '#lib/server/jobs.js';
import { israelDate } from '#lib/hypothesis.js';

/** GET — the picked securities with what a glance needs: price, the day, 1M / 3M / 1Y, sector, market cap */
export function GET() {
	const app = getApp().sqlite;
	const market = getMarket().sqlite;
	const rows = app.prepare('select security_id as id, origin, added_at as addedAt from shortlist order by added_at desc').all() as { id: number; origin: string | null; addedAt: string }[];
	const m = marketView(market);
	const today = israelDate();
	const prof = readProfiles(market, rows.map((r) => r.id), m.usd(today));
	const sec = market.prepare('select id, symbol, name_en as name, exchange_code as exchange, price_unit as unit from ref_securities where id = ?');
	const at = market.prepare('select date, close from market_prices_daily where security_id = ? and date <= ? order by date desc limit 1');
	const back = (d: number) => new Date(Date.parse(today + 'T12:00:00Z') - d * 86_400_000).toISOString().slice(0, 10);
	const items = rows.map((r) => {
		const s = sec.get(r.id) as { id: number; symbol: string; name: string; exchange: string; unit: string } | undefined;
		const last = at.get(r.id, today) as { date: string; close: number } | undefined;
		if (!last) queueSecurity(r.id);
		const ret = (d: number) => {
			const x = at.get(r.id, back(d)) as { date: string; close: number } | undefined;
			return last && x && x.close > 0 ? Math.round((last.close / x.close - 1) * 10000) / 100 : null;
		};
		const mv = m.dayMove(r.id);
		const p = prof.get(r.id);
		return {
			...r,
			symbol: s?.symbol ?? '?',
			name: s?.name ?? '',
			exchange: s?.exchange ?? '',
			unit: s?.unit ?? 'USD',
			price: mv?.now ?? last?.close ?? null,
			dayPct: mv && mv.prev > 0 ? Math.round((mv.now / mv.prev - 1) * 10000) / 100 : null,
			m1: ret(30),
			m3: ret(91),
			y1: ret(365),
			sector: p?.sector ?? null,
			capUsd: p?.capUsd ?? null
		};
	});
	return json({ items });
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
