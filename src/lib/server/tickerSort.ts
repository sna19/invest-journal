import type Database from 'better-sqlite3';
import { universe, type Series } from './model/quarterly.js';
import { scoresOf } from './score.js';
import type { SecurityHit } from './market/search.js';

/**
 * Owner 28.11.2026: the «Тикеры» list sorted not only by market cap — by the quant score (green first: what is worth
 * a look), the year's and 3 months' return, P/E, P/S, dividends, revenue growth, beta; down or up. Empty values go
 * last either way. The score of thousands of shares is costly (the trend needs 200 daily closes each): kept 6 hours (the scores change once a day).
 */
export const SORTS = ['cap', 'score', 'y1', 'm3', 'pe', 'ps', 'div', 'growth', 'beta'] as const;
export type SortKey = (typeof SORTS)[number];

const COLOR_RANK: Record<string, number> = { green: 3, yellow: 2, red: 1 };
export type ScoreBrief = { v: number; color: string; total: number; above: boolean | null };
let scoreCache: { at: number; map: Map<number, ScoreBrief | null> } | null = null;

/** the quant score of many shares, remembered 6 hours (the screener and the sorted list share it) */
export function scoreMap(market: Database.Database, ids: number[]) {
	if (!scoreCache || Date.now() - scoreCache.at > 6 * 3600_000) scoreCache = { at: Date.now(), map: new Map() };
	const need = ids.filter((id) => !scoreCache!.map.has(id));
	if (need.length)
	{
		// the shares without a score are remembered too: most of the list has none, and they cost the same to find
		for (const id of need) scoreCache.map.set(id, null);
		for (const s of scoresOf(market, need)) {
			// green above yellow above red, inside a colour — by the total; grey and no score — none
			if (s.total === null || s.color === 'grey') continue;
			scoreCache.map.set(s.id, { v: (COLOR_RANK[s.color] ?? 0) * 10 + s.total, color: s.color, total: s.total, above: s.trend ? s.trend.above : null });
		}
	}
	return scoreCache.map;
}

const back = (s: Series | undefined, last: number, n: number) => {
	if (!s) return null;
	const at = (i: number) => {
		const j = i - s.start;
		return j >= 0 && j < s.adj.length && s.adj[j] > 0 ? s.adj[j] : NaN;
	};
	const x = at(last) / at(last - n) - 1;
	return Number.isFinite(x) ? Math.round(x * 1000) / 10 : null;
};

/** the hits sorted by `key`, with the value each was sorted by */
export function sortHits(market: Database.Database, hits: SecurityHit[], key: SortKey, desc: boolean) {
	let value: (h: SecurityHit) => number | null;
	if (key === 'cap') value = (h) => h.capUsd;
	else if (key === 'score') {
		const m = scoreMap(market, hits.filter((h) => h.type === 'stock').map((h) => h.id));
		value = (h) => m.get(h.id)?.v ?? null;
	} else if (key === 'y1' || key === 'm3') {
		const u = universe(market);
		const byId = new Map(u.stocks.map((s) => [s.id, s]));
		value = (h) => back(byId.get(h.id), u.lastMonth, key === 'y1' ? 12 : 3);
	} else {
		const path = { pe: '$.pe', ps: '$.ps', div: '$.dividendYield', growth: '$.revenueGrowth', beta: '$.beta' }[key];
		const q = market.prepare(`select json_extract(data, '${path}') as v from ref_security_stats where security_id = ?`);
		const vals = new Map(hits.map((h) => [h.id, (q.get(h.id) as { v: number | null } | undefined)?.v ?? null]));
		// a negative P/E or P/S (a loss) says nothing about cheapness, a P/E under 1 is a data glitch: left out of the order
		value = (h) => {
			const v = vals.get(h.id);
			return typeof v !== 'number' || (key === 'pe' && v < 1) || (key === 'ps' && v <= 0) ? null : v;
		};
	}
	const withV = hits.map((h) => ({ h, v: value(h) }));
	withV.sort((a, b) => {
		if (a.v === null || b.v === null) return a.v === b.v ? 0 : a.v === null ? 1 : -1;
		return desc ? b.v - a.v : a.v - b.v;
	});
	const sm = key === 'score' ? scoreCache?.map : null;
	return withV.map(({ h, v }) => ({ ...h, sortValue: key === 'score' ? (sm?.get(h.id)?.total ?? null) : v }));
}
