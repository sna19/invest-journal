import { error, json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { marketView } from '#lib/server/portfolio.js';
import { attribution, collect, listNews, peersOf, secOf, setPeers } from '#lib/server/news/service.js';
import { body } from '#lib/server/respond.js';

/** the card's «Новости» (T-022): the day move split, the news of the share, its sector and market, its strong days */
function view(id: number, days: number, date?: string) {
	const m = getMarket().sqlite;
	const s = secOf(m, id);
	if (!s) error(404, 'нет такой бумаги');
	const mv = marketView(m);
	const moves = m
		.prepare(`select date, move_pct as movePct, atr_pct as atrPct, market_pct as marketPct, sector_pct as sectorPct, own_pct as ownPct, news from news_moves where security_id = ? order by date desc limit 30`)
		.all(id);
	const fetched = m.prepare(`select max(fetched_at) as at from news_fetches where key like ?`).get(`%|${id}|%`) as { at: string | null };
	return {
		attribution: attribution(m, id, (x) => mv.dayMove(x), date),
		items: listNews(m, id, days),
		peers: peersOf(m, s).map((p) => p.symbol),
		moves,
		fetchedAt: fetched.at
	};
}

/** GET ?days=30[&date=…] — what is stored; the first open with nothing stored collects at once */
export async function GET({ params, url }) {
	const id = Number(params.id);
	const days = Math.min(Number(url.searchParams.get('days')) || 30, 365);
	const date = url.searchParams.get('date') ?? undefined;
	const m = getMarket().sqlite;
	const any = m.prepare('select 1 from news_links where security_id = ? limit 1').get(id);
	if (!any) await collect(m, id).catch(() => null);
	return json(view(id, days, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined));
}

/** POST — «Что происходит?»: collect now (each feed at most every 10 minutes) */
export async function POST({ params, url }) {
	const id = Number(params.id);
	const r = await collect(getMarket().sqlite, id, { minutes: 10 });
	return json({ ...view(id, Math.min(Number(url.searchParams.get('days')) || 30, 365)), added: r.added, errors: r.errors });
}

/** PUT { peers: "AMD,AVGO" | null } — the neighbours of the share's sector circle (null — the five largest again) */
export async function PUT({ params, request }) {
	const b = await body(request);
	setPeers(getMarket().sqlite, Number(params.id), b.peers === null ? null : String(b.peers ?? ''));
	return json(view(Number(params.id), 30));
}
