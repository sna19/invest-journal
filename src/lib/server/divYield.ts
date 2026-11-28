import type Database from 'better-sqlite3';
import type { Series } from './model/quarterly.js';

/**
 * Owner 28.11.2026: the dividend yield of 12 months computed the same way for both exchanges — from the monthly prices:
 * the return with the dividends (adjusted closes) over the return of the price alone. Yahoo's own yield is missing for
 * many shares and mixes agorot and dollars on TASE. Over 25% or under 0 — a split in the closes, not a dividend.
 */
export function dividendYield12(s: Series | undefined, last: number): number | null {
	if (!s) return null;
	const i = last - s.start;
	const j = i - 12;
	if (j < 0 || i >= s.adj.length) return null;
	const tr = s.adj[i] / s.adj[j];
	const pr = s.close[i] / s.close[j];
	if (!(tr > 0) || !(pr > 0)) return null;
	const y = tr / pr - 1;
	return y < -0.001 || y > 0.25 ? null : Math.max(0, Math.round(y * 10000) / 100);
}

/**
 * The 12 months' dividend yield, % — the best source first: the payments themselves (the daily history's dividends
 * over the last close), then the monthly prices (US only: Yahoo's monthly adjclose on TASE leaves the dividends out),
 * then Yahoo's own yield. Owner 28.11.2026: the Israeli candidates came out with ~0% by the monthly prices alone.
 */
export function dividendYields(
	market: Database.Database,
	ids: number[],
	series: (id: number) => Series | undefined,
	lastMonth: number,
	marketOf: (id: number) => 'US' | 'IL',
	stats: (id: number) => number | null,
	today = new Date()
): Map<number, number | null> {
	const yearAgo = new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
	const paid = new Map(
		(
			market
				.prepare(
					`select d.security_id as id, sum(d.amount) as s,
					        (select close from market_prices_daily p where p.security_id = d.security_id order by date desc limit 1) as close,
					        (select min(date) from market_prices_daily p where p.security_id = d.security_id) as first
					   from market_corporate_actions d where d.kind = 'dividend' and d.amount > 0 and d.ex_date > ? group by d.security_id`
				)
				.all(yearAgo) as { id: number; s: number; close: number | null; first: string | null }[]
		)
			// a year of daily history behind it, or the sum may miss payments
			.filter((r) => r.close && r.first && r.first <= yearAgo)
			.map((r) => [r.id, Math.round((r.s / r.close!) * 10000) / 100] as const)
	);
	const out = new Map<number, number | null>();
	for (const id of ids) {
		const p = paid.get(id);
		if (p !== undefined && p > 0 && p < 30) {
			out.set(id, p);
			continue;
		}
		const m = marketOf(id) === 'US' ? dividendYield12(series(id), lastMonth) : null;
		if (m !== null && m > 0) {
			out.set(id, m);
			continue;
		}
		const s = stats(id);
		out.set(id, s !== null && s > 0 && s < 0.3 ? Math.round(s * 10000) / 100 : m);
	}
	return out;
}
