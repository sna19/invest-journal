import type Database from 'better-sqlite3';
import { fetchGet, session, type ProfileGet } from './profiles.js';
import { securitiesForPrices } from './prices.js';

/**
 * A security's ratios (owner's request 26.11.2026): valuation, risk, quality, growth, income, analysts — Yahoo's
 * quoteSummary (summaryDetail, defaultKeyStatistics, financialData), kept for 3 days. For a TASE share Yahoo divides a
 * price in agorot by results in dollars, so the price-based ratios are nonsense there (ESLT P/B 2 256): only the
 * ratios without the price are kept for it.
 */

export interface Stats {
	kind: 'stock' | 'fund';
	pe: number | null;
	forwardPe: number | null;
	ps: number | null;
	pb: number | null;
	evEbitda: number | null;
	peg: number | null;
	beta: number | null;
	beta3y: number | null;
	shortFloat: number | null;
	profitMargin: number | null;
	operatingMargin: number | null;
	grossMargin: number | null;
	roe: number | null;
	roa: number | null;
	debtToEquity: number | null;
	currentRatio: number | null;
	revenueGrowth: number | null;
	earningsGrowth: number | null;
	dividendYield: number | null;
	payoutRatio: number | null;
	insiders: number | null;
	institutions: number | null;
	target: number | null;
	targetLow: number | null;
	targetHigh: number | null;
	recommendation: string | null;
	analysts: number | null;
	totalAssets: number | null;
	ytd: number | null;
	threeYear: number | null;
	/** TASE: the price-based ratios are hidden */
	priceRatiosHidden: boolean;
}

const raw = (x: unknown) => (typeof x === 'object' && x && typeof (x as { raw?: unknown }).raw === 'number' ? (x as { raw: number }).raw : null);

export function parseStats(body: string, tase: boolean): Stats | null {
	const r = JSON.parse(body)?.quoteSummary?.result?.[0];
	if (!r) return null;
	const sd = r.summaryDetail ?? {};
	const ks = r.defaultKeyStatistics ?? {};
	const fd = r.financialData ?? {};
	const fund = /fund|etf/i.test(String(ks.legalType ?? '')) || (raw(sd.totalAssets) !== null && raw(fd.profitMargins) === null);
	const p = (x: number | null) => (tase ? null : x);
	return {
		kind: fund ? 'fund' : 'stock',
		pe: p(raw(sd.trailingPE)),
		forwardPe: p(raw(sd.forwardPE) ?? raw(ks.forwardPE)),
		ps: p(raw(sd.priceToSalesTrailing12Months)),
		pb: p(raw(ks.priceToBook)),
		evEbitda: p(raw(ks.enterpriseToEbitda)),
		peg: p(raw(ks.pegRatio)),
		beta: raw(sd.beta) ?? raw(ks.beta),
		beta3y: raw(ks.beta3Year),
		shortFloat: raw(ks.shortPercentOfFloat),
		profitMargin: raw(fd.profitMargins) ?? raw(ks.profitMargins),
		operatingMargin: raw(fd.operatingMargins),
		grossMargin: raw(fd.grossMargins),
		roe: raw(fd.returnOnEquity),
		roa: raw(fd.returnOnAssets),
		debtToEquity: raw(fd.debtToEquity),
		currentRatio: raw(fd.currentRatio),
		revenueGrowth: raw(fd.revenueGrowth),
		earningsGrowth: raw(fd.earningsGrowth),
		dividendYield: raw(sd.dividendYield) ?? raw(sd.yield) ?? raw(ks.yield),
		payoutRatio: raw(sd.payoutRatio),
		insiders: raw(ks.heldPercentInsiders),
		institutions: raw(ks.heldPercentInstitutions),
		target: p(raw(fd.targetMeanPrice)),
		targetLow: p(raw(fd.targetLowPrice)),
		targetHigh: p(raw(fd.targetHighPrice)),
		recommendation: typeof fd.recommendationKey === 'string' && fd.recommendationKey !== 'none' ? fd.recommendationKey : null,
		analysts: raw(fd.numberOfAnalystOpinions),
		totalAssets: raw(sd.totalAssets) ?? raw(ks.totalAssets),
		ytd: raw(ks.ytdReturn),
		threeYear: raw(ks.threeYearAverageReturn),
		priceRatiosHidden: tase
	};
}

const FRESH = 3 * 86_400_000;

/** the stored ratios of the securities, loading the missing or old ones first (a few at a time) */
export async function statsOf(market: Database.Database, ids: number[], opts: { get?: ProfileGet; now?: Date; loadAtMost?: number } = {}): Promise<Map<number, { stats: Stats | null; fetchedAt: string }>> {
	const now = opts.now ?? new Date();
	const get = opts.get ?? fetchGet;
	const row = market.prepare('select data, fetched_at as at from ref_security_stats where security_id = ?');
	const stale = ids.filter((id) => {
		const r = row.get(id) as { at: string } | undefined;
		return !r || now.getTime() - Date.parse(r.at) > FRESH;
	});
	const secs = securitiesForPrices(market, stale.slice(0, opts.loadAtMost ?? 8)).filter((s) => !s.isBenchmark);
	if (secs.length) {
		try {
			const { cookie, crumb } = await session(get);
			const put = market.prepare('insert into ref_security_stats (security_id, data, fetched_at) values (?, ?, ?) on conflict (security_id) do update set data = excluded.data, fetched_at = excluded.fetched_at');
			const tase = market.prepare(`select exchange_code = 'TASE' as t from ref_securities where id = ?`);
			for (const s of secs) {
				const r = await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(s.yahoo)}?modules=summaryDetail,defaultKeyStatistics,financialData&crumb=${encodeURIComponent(crumb)}`, cookie).catch(() => null);
				if (r && (r.status === 200 || r.status === 404)) {
					const st = r.status === 200 ? parseStats(r.body, !!(tase.get(s.id) as { t: number }).t) : null;
					put.run(s.id, JSON.stringify(st), now.toISOString());
				}
			}
		} catch {
			/* the provider did not answer: what is stored is shown */
		}
	}
	const out = new Map<number, { stats: Stats | null; fetchedAt: string }>();
	for (const id of ids) {
		const r = row.get(id) as { data: string; at: string } | undefined;
		if (r) out.set(id, { stats: JSON.parse(r.data), fetchedAt: r.at });
	}
	return out;
}
