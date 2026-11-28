import type Database from 'better-sqlite3';
import { statsOf } from './market/stats.js';
type Get = NonNullable<Parameters<typeof statsOf>[2]>['get'];
import { splitScale } from './market/splits.js';

/**
 * Owner 28.11.2026: «страновые ETF — ещё один способ инвестировать; хочу найти страны, в которые выгодно инвестировать
 * на следующий год». The country (and regional) funds listed in the US, each with what a choice of a country needs:
 * the returns over 1, 3, 6 and 12 months, the momentum 12−1 (the year less its last month — what the country momentum
 * model ranks by), the trend (over its 200-day average), the swings and the year's worst drawdown, the dividend yield,
 * the fund's P/E (how dear the country's market is), its fee and size. All from the daily prices; the funds without
 * them yet are queued and come in a few minutes.
 */
export const COUNTRY_ETFS: [symbol: string, country: string, region: string][] = [
	['SPY', 'United States', 'na'],
	['EWC', 'Canada', 'na'],
	['EWW', 'Mexico', 'latam'],
	['EWZ', 'Brazil', 'latam'],
	['ECH', 'Chile', 'latam'],
	['EPU', 'Peru', 'latam'],
	['ARGT', 'Argentina', 'latam'],
	['GXG', 'Colombia', 'latam'],
	['EWU', 'United Kingdom', 'eu'],
	['EWG', 'Germany', 'eu'],
	['EWQ', 'France', 'eu'],
	['EWI', 'Italy', 'eu'],
	['EWP', 'Spain', 'eu'],
	['EWL', 'Switzerland', 'eu'],
	['EWN', 'Netherlands', 'eu'],
	['EWD', 'Sweden', 'eu'],
	['EDEN', 'Denmark', 'eu'],
	['ENOR', 'Norway', 'eu'],
	['EFNL', 'Finland', 'eu'],
	['EWK', 'Belgium', 'eu'],
	['EWO', 'Austria', 'eu'],
	['EIRL', 'Ireland', 'eu'],
	['GREK', 'Greece', 'eu'],
	['EPOL', 'Poland', 'eu'],
	['TUR', 'Turkey', 'me'],
	['EIS', 'Israel', 'il'],
	['KSA', 'Saudi Arabia', 'me'],
	['QAT', 'Qatar', 'me'],
	['UAE', 'United Arab Emirates', 'me'],
	['EZA', 'South Africa', 'af'],
	['EWJ', 'Japan', 'asia'],
	['EWY', 'South Korea', 'asia'],
	['EWT', 'Taiwan', 'asia'],
	['MCHI', 'China', 'asia'],
	['EWH', 'Hong Kong', 'asia'],
	['INDA', 'India', 'asia'],
	['EWS', 'Singapore', 'asia'],
	['EWM', 'Malaysia', 'asia'],
	['THD', 'Thailand', 'asia'],
	['EIDO', 'Indonesia', 'asia'],
	['EPHE', 'Philippines', 'asia'],
	['VNM', 'Vietnam', 'asia'],
	['EWA', 'Australia', 'oc'],
	['ENZL', 'New Zealand', 'oc'],
	// regions
	['VGK', 'Europe', 'region'],
	['EFA', 'Developed ex-US', 'region'],
	['EEM', 'Emerging markets', 'region'],
	['AAXJ', 'Asia ex-Japan', 'region'],
	['ILF', 'Latin America', 'region'],
	['ACWI', 'World', 'region']
];

const US = ['NYSE', 'NASDAQ', 'NYSE_AMERICAN', 'NYSE_ARCA', 'CBOE_BZX'];

export function countryFundIds(market: Database.Database): { id: number; symbol: string; country: string; region: string }[] {
	const q = market.prepare(`select id from ref_securities where symbol = ? and exchange_code in (${US.map(() => '?').join(',')}) and active = 1 order by id limit 1`);
	return COUNTRY_ETFS.map(([symbol, country, region]) => ({ symbol, country, region, id: (q.get(symbol, ...US) as { id: number } | undefined)?.id ?? 0 })).filter((x) => x.id);
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export async function countriesView(market: Database.Database, today = new Date(), get?: Get) {
	const funds = countryFundIds(market);
	const ids = funds.map((f) => f.id);
	// the ratios (P/E, size, yields) — a few loaded a call, the rest next time
	const st = await statsOf(market, ids, { loadAtMost: 6, get, now: today });
	const fee = market.prepare('select expense_ratio as e from ref_security_profiles where security_id = ?');
	const closes = market.prepare('select date, close from market_prices_daily where security_id = ? and date >= ? order by date');
	const divs = market.prepare(`select ex_date as date, amount from market_corporate_actions where security_id = ? and kind = 'dividend' and amount > 0 and ex_date > ?`);
	const from = new Date(today.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
	const yearAgo = new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
	const missing: number[] = [];
	const rows = funds.map((f) => {
		const scale = splitScale(market, f.id);
		const c = (closes.all(f.id, from) as { date: string; close: number }[]).map((x) => ({ date: x.date, v: x.close / scale(x.date) }));
		const s = st.get(f.id)?.stats ?? null;
		const base = { ...f, fee: (fee.get(f.id) as { e: number | null } | undefined)?.e ?? null, pe: s?.pe ?? null, assets: s?.totalAssets ?? null, threeYear: s?.threeYear ?? null };
		if (c.length < 230) {
			missing.push(f.id);
			return { ...base, loaded: false, price: null, m1: null, m3: null, m6: null, y1: null, mom: null, trend: null, vol: null, dd: null, dy: null };
		}
		const last = c.at(-1)!.v;
		const back = (n: number) => (c.length > n ? r1((last / c[c.length - 1 - n].v - 1) * 100) : null);
		const sma200 = c.slice(-200).reduce((n, x) => n + x.v, 0) / 200;
		// the momentum 12−1: the year's return less the last month (21 trading days)
		const mom = c.length > 252 ? r1((c[c.length - 22].v / c[c.length - 253].v - 1) * 100) : null;
		const yr = c.slice(-252);
		const rets = yr.slice(1).map((x, i) => Math.log(x.v / yr[i].v));
		const mean = rets.reduce((n, x) => n + x, 0) / rets.length;
		const vol = r1(Math.sqrt(rets.reduce((n, x) => n + (x - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100);
		let peak = -Infinity;
		let dd = 0;
		for (const x of yr) {
			peak = Math.max(peak, x.v);
			dd = Math.min(dd, x.v / peak - 1);
		}
		const paid = (divs.all(f.id, yearAgo) as { amount: number }[]).reduce((n, x) => n + x.amount, 0);
		return {
			...base,
			loaded: true,
			price: last,
			m1: back(21),
			m3: back(63),
			m6: back(126),
			y1: back(252),
			mom,
			trend: last > sma200,
			vol,
			dd: r1(dd * 100),
			dy: paid > 0 ? Math.round((paid / last) * 1000) / 10 : null
		};
	});
	// the momentum's rank among the loaded ones: 1 — the strongest
	const ranked = rows.filter((r) => r.mom !== null).sort((a, b) => b.mom! - a.mom!);
	const rank = new Map(ranked.map((r, i) => [r.id, i + 1]));
	return { rows: rows.map((r) => ({ ...r, rank: rank.get(r.id) ?? null })), ranked: ranked.length, missing };
}
