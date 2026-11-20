import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { watchedIds } from '#lib/server/jobs.js';

/** GET — the strong moves of the last days among the securities this user follows (T-022, the banner) */
export function GET() {
	const ids = watchedIds(getApp().sqlite);
	if (!ids.length) return json({ items: [] });
	const since = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
	const items = getMarket()
		.sqlite.prepare(
			`select m.security_id as id, s.symbol, m.date, m.move_pct as movePct, m.market_pct as marketPct, m.sector_pct as sectorPct, m.own_pct as ownPct, m.news, m.top_title as topTitle
			   from news_moves m join ref_securities s on s.id = m.security_id
			  where m.security_id in (${ids.map(Number).join(',')}) and m.date >= ? order by m.date desc, abs(m.move_pct) desc limit 10`
		)
		.all(since);
	return json({ items });
}
