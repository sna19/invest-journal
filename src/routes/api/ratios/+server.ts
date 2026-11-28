import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { statsOf } from '#lib/server/market/stats.js';
import { drawdowns, volatility } from '#lib/server/compare.js';
import { atrOf, barsOf } from '#lib/server/protection.js';
import { dividendYields } from '#lib/server/divYield.js';
import { dividendHistory } from '#lib/server/dividends.js';
import { universe } from '#lib/server/model/quarterly.js';

/**
 * GET ?ids=1,2,… — the ratios of the securities (loaded from Yahoo if missing or older than 3 days, 8 per call), with
 * the swings computed here from the daily closes (owner 27.11.2026): the volatility over a year and 3 months (% a
 * year), the day's usual range (ATR 14, % of the price), the drawdown from the year's high now and the year's worst one.
 */
export async function GET({ url }) {
	const ids = (url.searchParams.get('ids') ?? '')
		.split(',')
		.map(Number)
		.filter((x) => Number.isInteger(x) && x > 0)
		.slice(0, 40);
	const market = getMarket().sqlite;
	const m = await statsOf(market, ids);
	const items: Record<number, unknown> = {};
	// owner 28.11.2026: the dividend yield the same everywhere (the screener, the portfolio's «Дивиденды»), and its growth
	const u = universe(market);
	const byId = new Map(u.stocks.map((s) => [s.id, s]));
	const ex = market.prepare('select exchange_code as e from ref_securities where id = ?');
	const dys = dividendYields(market, ids, (id) => byId.get(id), u.lastMonth, (id) => ((ex.get(id) as { e: string } | undefined)?.e === 'TASE' ? 'IL' : 'US'), (id) => {
		const st = m.get(id)?.stats as { dividendYield?: number | null } | null | undefined;
		return st?.dividendYield ?? null;
	});
	for (const id of ids) {
		const v = m.get(id);
		const vol = volatility(market, id);
		const b = barsOf(market, id, 20);
		const atr = atrOf(b, 14);
		const dd = drawdowns(barsOf(market, id, 253).map((x) => x.close));
		const dh = dividendHistory(market, id);
		const dy = dys.get(id);
		const div = {
			dy12: dy === null || dy === undefined ? null : dy / 100,
			divGrowthYears: dh.years.length ? dh.growthYears : null,
			divCagr5: dh.cagr5 === null ? null : dh.cagr5 / 100
		};
		const swings = { ...div, vol1y: vol.vol1y, vol3m: vol.vol3m, atrPct: atr && b.length ? Math.round((atr / b.at(-1)!.close) * 10000) / 10000 : null, ddNow: dd?.now ?? null, ddMax: dd?.max ?? null };
		if (v) items[id] = { ...v, stats: v.stats ? { ...v.stats, ...swings } : null, swings };
		else if (swings.vol1y !== null) items[id] = { stats: null, fetchedAt: null, swings };
	}
	return json({ items });
}
