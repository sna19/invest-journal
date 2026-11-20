import type Database from 'better-sqlite3';
import { securitiesForPrices } from './prices.js';

/**
 * Security profiles (owner's request 19.11.2026: the portfolio's allocation by sector and other measures).
 * Yahoo's quoteSummary gives a company's sector, industry, country and market cap, and a fund's sector weights;
 * it needs a session cookie and a «crumb» (fc.yahoo.com → /v1/test/getcrumb). A profile is refreshed after 30
 * days; T-021: refreshed weekly (the market cap moves with the price), one the provider does not know too.
 */

/** sector keys as in a fund's sector weights; a company's «Real Estate» becomes «realestate» like there */
export const sectorKey = (s: string) => {
	const k = s.trim().toLowerCase().replace(/\s+/g, '_');
	return k === 'real_estate' ? 'realestate' : k;
};

export interface Profile {
	kind: 'stock' | 'etf' | 'none';
	sector: string | null;
	industry: string | null;
	country: string | null;
	marketCap: number | null;
	capCurrency: string | null;
	fundCategory: string | null;
	sectorWeights: Record<string, number> | null;
	/** a fund's annual fee, a fraction */
	expenseRatio: number | null;
}

const num = (x: unknown) => (typeof x === 'object' && x && typeof (x as { raw?: unknown }).raw === 'number' ? (x as { raw: number }).raw : null);

export function parseProfile(body: string): Profile {
	const r = JSON.parse(body)?.quoteSummary?.result?.[0];
	const none: Profile = { kind: 'none', sector: null, industry: null, country: null, marketCap: null, capCurrency: null, fundCategory: null, sectorWeights: null, expenseRatio: null };
	if (!r) return none;
	const type = String(r.price?.quoteType ?? r.quoteType?.quoteType ?? '').toUpperCase();
	const a = r.assetProfile ?? {};
	if (type === 'ETF' || type === 'MUTUALFUND' || r.fundProfile) {
		const w: Record<string, number> = {};
		for (const o of r.topHoldings?.sectorWeightings ?? []) {
			for (const [k, v] of Object.entries(o)) {
				const x = num(v);
				if (x && x > 0) w[sectorKey(k)] = x;
			}
		}
		const fees = r.fundProfile?.feesExpensesInvestment ?? {};
		const er = num(fees.annualReportExpenseRatio) ?? num(fees.netExpRatio) ?? num(r.summaryDetail?.expenseRatio);
		return { ...none, kind: 'etf', fundCategory: r.fundProfile?.categoryName ?? null, sectorWeights: Object.keys(w).length ? w : null, expenseRatio: er !== null && er >= 0 && er < 0.2 ? er : null };
	}
	if (!a.sector && !a.industry && !num(r.price?.marketCap)) return none;
	return {
		kind: 'stock',
		sector: a.sector ? sectorKey(a.sector) : null,
		industry: a.industry ?? null,
		country: a.country ?? null,
		marketCap: num(r.price?.marketCap),
		capCurrency: r.price?.currency ?? null,
		fundCategory: null,
		sectorWeights: null,
		expenseRatio: null
	};
}

/** a GET with cookies (Yahoo's session); tests pass their own */
export type ProfileGet = (url: string, cookie?: string) => Promise<{ status: number; body: string; cookies: string[] }>;

const UA = 'Mozilla/5.0';
export const fetchGet: ProfileGet = async (url, cookie) => {
	const r = await fetch(url, { headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
	return { status: r.status, body: await r.text(), cookies: r.headers.getSetCookie?.() ?? [] };
};

export async function session(get: ProfileGet) {
	const first = await get('https://fc.yahoo.com/');
	const cookie = first.cookies.map((c) => c.split(';')[0]).join('; ');
	const c = await get('https://query1.finance.yahoo.com/v1/test/getcrumb', cookie);
	if (c.status !== 200 || !c.body || c.body.includes('<')) throw new Error(`Yahoo crumb: ${c.status}`);
	return { cookie, crumb: c.body.trim() };
}

const DAY = 24 * 3600 * 1000;

/** the securities among `ids` whose profile is missing or old */
export function staleProfiles(market: Database.Database, ids: number[], now = new Date()): number[] {
	const row = market.prepare('select kind, fetched_at as at from ref_security_profiles where security_id = ?');
	return ids.filter((id) => {
		const r = row.get(id) as { kind: string; at: string } | undefined;
		if (!r) return true;
		const age = now.getTime() - Date.parse(r.at);
		// the market cap moves with the price: a week (T-021); a fund's weights and the unknown — a week too
		return age > 7 * DAY;
	});
}

export interface ProfilesSummary {
	securities: number;
	updated: number;
	none: number;
	errors: string[];
}

export async function loadProfiles(
	market: Database.Database,
	ids: number[],
	opts: { get?: ProfileGet; now?: Date; pause?: number } = {}
): Promise<ProfilesSummary> {
	const now = opts.now ?? new Date();
	const get = opts.get ?? fetchGet;
	const secs = securitiesForPrices(market, staleProfiles(market, ids, now)).filter((s) => !s.isBenchmark);
	const s: ProfilesSummary = { securities: secs.length, updated: 0, none: 0, errors: [] };
	if (!secs.length) return s;
	const { cookie, crumb } = await session(get);
	const put = market.prepare(
		`insert into ref_security_profiles (security_id, kind, sector, industry, country, market_cap, cap_currency, fund_category, sector_weights, expense_ratio, fetched_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 on conflict (security_id) do update set kind = excluded.kind, sector = excluded.sector, industry = excluded.industry, country = excluded.country,
		   market_cap = excluded.market_cap, cap_currency = excluded.cap_currency, fund_category = excluded.fund_category,
		   sector_weights = excluded.sector_weights, expense_ratio = excluded.expense_ratio, fetched_at = excluded.fetched_at`
	);
	for (const sec of secs) {
		try {
			const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sec.yahoo)}?modules=assetProfile,price,topHoldings,fundProfile&crumb=${encodeURIComponent(crumb)}`;
			const r = await get(url, cookie);
			if (r.status !== 200 && r.status !== 404) throw new Error(`${r.status}`);
			const p = r.status === 404 ? parseProfile('{}') : parseProfile(r.body);
			put.run(sec.id, p.kind, p.sector, p.industry, p.country, p.marketCap, p.capCurrency, p.fundCategory, p.sectorWeights ? JSON.stringify(p.sectorWeights) : null, p.expenseRatio, now.toISOString());
			if (p.kind === 'none') s.none++;
			else s.updated++;
		} catch (e) {
			s.errors.push(`${sec.symbol}: ${e instanceof Error ? e.message : e}`);
		}
		if (opts.pause !== 0) await new Promise((r) => setTimeout(r, opts.pause ?? 300));
	}
	return s;
}

export interface ProfileView {
	/** stock | etf from the exchange list */
	type: string;
	/** stock | etf | none — what the provider said; null — not loaded yet */
	kind: 'stock' | 'etf' | 'none' | null;
	sector: string | null;
	industry: string | null;
	country: string | null;
	/** market cap in dollars */
	capUsd: number | null;
	fundCategory: string | null;
	sectorWeights: Record<string, number> | null;
}

/** profiles of `ids` for the portfolio screen; `usdIls` brings a shekel market cap to dollars */
export function readProfiles(market: Database.Database, ids: number[], usdIls: number | null): Map<number, ProfileView> {
	if (!ids.length) return new Map();
	const rows = market
		.prepare(
			`select s.id, s.type, p.kind, p.sector, p.industry, p.country, p.market_cap as cap, p.cap_currency as cur, p.fund_category as cat, p.sector_weights as w
			   from ref_securities s left join ref_security_profiles p on p.security_id = s.id where s.id in (${ids.map(Number).join(',')})`
		)
		.all() as { id: number; type: string; kind: ProfileView['kind']; sector: string | null; industry: string | null; country: string | null; cap: number | null; cur: string | null; cat: string | null; w: string | null }[];
	const usd = (cap: number | null, cur: string | null) => {
		if (cap === null) return null;
		if (!cur || cur === 'USD') return cap;
		if (!usdIls) return null;
		// a TASE quote is in agorot, but Yahoo gives its market cap in shekels (checked on ESLT.TA, 19.11.2026)
		return cur === 'ILA' || cur === 'ILS' ? cap / usdIls : null;
	};
	return new Map(
		rows.map((r) => [r.id, { type: r.type, kind: r.kind, sector: r.sector, industry: r.industry, country: r.country, capUsd: usd(r.cap, r.cur), fundCategory: r.cat, sectorWeights: r.w ? JSON.parse(r.w) : null }])
	);
}
