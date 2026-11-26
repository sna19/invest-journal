import type Database from 'better-sqlite3';
import { liquidity, universe, type Universe } from './model/quarterly.js';
import { israelDate } from '../hypothesis.js';
import type { AppDb } from './db.js';
import { createHypothesis } from './journal.js';
import { setAuto } from './portfolio.js';
import type { Stats } from './market/stats.js';
import { barsOf } from './protection.js';

/**
 * T-034 «Квант-оценка» (owner, 26.11.2026: «собрать в один индикатор рекомендации… графический или цветовой»). As the
 * quant ratings do it: four factors with equal weights — quality, growth, valuation, momentum — each metric turned
 * into its percentile among the shares of the same sector (P/S 8 is average in software and absurd in retail), a
 * factor = the mean of its metrics' percentiles, graded A–F; the total = the mean of the factors, a colour. The trend
 * is a gate, not a term: under its 200-day average a share is at most yellow. Beta is not in it: it sizes a position
 * («Риск», «Защита»), it does not make a share better or worse.
 */

export type Factor = 'quality' | 'growth' | 'valuation' | 'momentum';
export const FACTORS: Factor[] = ['quality', 'growth', 'valuation', 'momentum'];
export type Color = 'green' | 'yellow' | 'red' | 'grey';

type MetricKey = 'operatingMargin' | 'grossMargin' | 'roe' | 'debtToEquity' | 'revenueGrowth' | 'earningsGrowth' | 'forwardPe' | 'ps' | 'evEbitda' | 'peg' | 'mom12';
interface MetricDef {
	key: MetricKey;
	factor: Factor;
	/** a higher value is better */
	up: boolean;
	/** only a positive value is meaningful (a negative P/E or PEG is a loss, not cheapness) */
	positive?: boolean;
	/** left out for banks and insurers: debt is their raw material, EV/EBITDA does not apply */
	notFinancial?: boolean;
}
export const METRICS: MetricDef[] = [
	{ key: 'operatingMargin', factor: 'quality', up: true },
	{ key: 'grossMargin', factor: 'quality', up: true, notFinancial: true },
	{ key: 'roe', factor: 'quality', up: true },
	{ key: 'debtToEquity', factor: 'quality', up: false, positive: true, notFinancial: true },
	{ key: 'revenueGrowth', factor: 'growth', up: true },
	{ key: 'earningsGrowth', factor: 'growth', up: true },
	{ key: 'forwardPe', factor: 'valuation', up: false, positive: true },
	{ key: 'ps', factor: 'valuation', up: false, positive: true },
	{ key: 'evEbitda', factor: 'valuation', up: false, positive: true, notFinancial: true },
	{ key: 'peg', factor: 'valuation', up: false, positive: true },
	{ key: 'mom12', factor: 'momentum', up: true }
];
const FINANCIAL = new Set(['financial_services']);
/** fewer peers with a value than this: the metric is ranked among all the shares of its market instead */
export const MIN_PEERS = 8;

export const grade = (p: number) => (p >= 0.8 ? 'A' : p >= 0.6 ? 'B' : p >= 0.4 ? 'C' : p >= 0.2 ? 'D' : 'F');
export const colorOf = (total: number | null, factors: number, aboveSma: boolean | null): Color => {
	if (total === null || factors < 3) return 'grey';
	const c: Color = total >= 0.65 ? 'green' : total >= 0.35 ? 'yellow' : 'red';
	return c === 'green' && aboveSma === false ? 'yellow' : c;
};

/** the share of the peers' values the value is better than (ties count half) — 0 worst … 1 best */
export function percentile(value: number, peers: number[], up: boolean) {
	if (!peers.length) return null;
	let below = 0;
	let same = 0;
	for (const p of peers) {
		if (p === value) same++;
		else if (up ? p < value : p > value) below++;
	}
	return (below + same / 2) / peers.length;
}

export interface Input {
	id: number;
	sector: string | null;
	market: 'US' | 'IL';
	values: Partial<Record<MetricKey, number | null>>;
}

const usable = (d: MetricDef, sector: string | null, v: number | null | undefined): v is number =>
	typeof v === 'number' && Number.isFinite(v) && !(d.positive && v <= 0) && !(d.notFinancial && sector && FINANCIAL.has(sector));

export interface FactorScore {
	pct: number | null;
	grade: string | null;
	metrics: { key: MetricKey; value: number; pct: number; peers: number; scope: 'sector' | 'market' }[];
}
export interface Score {
	id: number;
	sector: string | null;
	market: 'US' | 'IL' | null;
	color: Color;
	total: number | null;
	factors: Record<Factor, FactorScore>;
	trend: { price: number; sma200: number; above: boolean } | null;
}

/** the scores of `ids` against `all` (the peers: every share with ratios), pure */
export function scoreAll(all: Input[], ids: number[], trend: (id: number) => Score['trend'], outsiders: Input[] = []): Score[] {
	// the peers' values by sector and by market, per metric
	const bySector = new Map<string, number[]>();
	const byMarket = new Map<string, number[]>();
	for (const x of all)
		for (const d of METRICS) {
			const v = x.values[d.key];
			if (!usable(d, x.sector, v)) continue;
			const ks = `${x.sector}|${d.key}`;
			const km = `${x.market}|${d.key}`;
			if (x.sector) (bySector.get(ks) ?? bySector.set(ks, []).get(ks)!).push(v);
			(byMarket.get(km) ?? byMarket.set(km, []).get(km)!).push(v);
		}
	const byId = new Map([...all, ...outsiders].map((x) => [x.id, x]));
	return ids.map((id) => {
		const x = byId.get(id);
		const factors = Object.fromEntries(FACTORS.map((f) => [f, { pct: null, grade: null, metrics: [] }])) as unknown as Record<Factor, FactorScore>;
		if (!x) return { id, sector: null, market: null, color: 'grey' as Color, total: null, factors, trend: trend(id) };
		for (const d of METRICS) {
			const v = x.values[d.key];
			if (!usable(d, x.sector, v)) continue;
			const sec = x.sector ? (bySector.get(`${x.sector}|${d.key}`) ?? []) : [];
			const scope = sec.length >= MIN_PEERS ? 'sector' : 'market';
			const peers = scope === 'sector' ? sec : (byMarket.get(`${x.market}|${d.key}`) ?? []);
			if (peers.length < MIN_PEERS) continue;
			const p = percentile(v, peers, d.up)!;
			factors[d.factor].metrics.push({ key: d.key, value: v, pct: Math.round(p * 1000) / 1000, peers: peers.length, scope });
		}
		let sum = 0;
		let n = 0;
		for (const f of FACTORS) {
			const ms = factors[f].metrics;
			// one metric is enough for growth and momentum; quality and valuation need two
			if (ms.length < (f === 'quality' || f === 'valuation' ? 2 : 1)) continue;
			const p = ms.reduce((a, m) => a + m.pct, 0) / ms.length;
			factors[f].pct = Math.round(p * 1000) / 1000;
			factors[f].grade = grade(p);
			sum += p;
			n++;
		}
		const total = n ? Math.round((sum / n) * 1000) / 1000 : null;
		const t = trend(id);
		return { id, sector: x.sector, market: x.market, color: colorOf(total, n, t ? t.above : null), total, factors, trend: t };
	});
}

// ── the data ─────────────────────────────────────────────────────────────────────────────────────────

/** the 12 months' rise leaving out the last month, from the monthly adjusted closes (the momentum the models use) */
function mom12(u: Universe, s: Universe['stocks'][number]) {
	const i = u.lastMonth - s.start;
	const a = s.adj[i - 12];
	const b = s.adj[i - 1];
	return i >= 12 && a > 0 && b > 0 ? b / a - 1 : null;
}

let cache: { key: string; inputs: Input[] } | null = null;
/** every share of the model's universe with ratios: its sector, market and metric values (cached by the data's state) */
function inputs(market: Database.Database, u: Universe): Input[] {
	const k = (market.prepare('select count(*) || max(fetched_at) as k from ref_security_stats').get() as { k: string | null }).k ?? '';
	const key = `${u.builtAt}|${k}`;
	if (cache?.key === key) return cache.inputs;
	const stats = new Map((market.prepare('select security_id as id, data from ref_security_stats').all() as { id: number; data: string }[]).map((r) => [r.id, r.data]));
	const out: Input[] = [];
	for (const s of u.stocks) {
		const raw = stats.get(s.id);
		const st = raw ? (JSON.parse(raw) as Stats | null) : null;
		const values: Input['values'] = { mom12: mom12(u, s) };
		if (st && st.kind === 'stock') for (const d of METRICS) if (d.key !== 'mom12') values[d.key] = st[d.key as keyof Stats] as number | null;
		// the price ratios of TASE are hidden (Yahoo's agorot over dollars): valuation stays empty
		out.push({ id: s.id, sector: s.sector, market: s.market, values });
	}
	cache = { key, inputs: out };
	return out;
}

/** the price against its 200-day average (daily closes in the current split scale) */
function trendOf(market: Database.Database, id: number): Score['trend'] {
	const b = barsOf(market, id, 200);
	if (b.length < 200) return null;
	const sma = b.reduce((a, x) => a + x.close, 0) / b.length;
	const price = b.at(-1)!.close;
	return { price, sma200: Math.round(sma * 100) / 100, above: price >= sma };
}

/**
 * A share outside the model's universe (no monthly prices yet — owner 27.11.2026: «для всех тикеров»): its sector from
 * its profile, its ratios if loaded, its momentum from the daily closes (12 months less the last ≈ 252 and 21 days back).
 */
function outsider(market: Database.Database, id: number): Input | null {
	const r = market
		.prepare(`select s.type, s.exchange_code as ex, p.sector, p.kind, st.data from ref_securities s left join ref_security_profiles p on p.security_id = s.id left join ref_security_stats st on st.security_id = s.id where s.id = ?`)
		.get(id) as { type: string; ex: string; sector: string | null; kind: string | null; data: string | null } | undefined;
	if (!r || r.type !== 'stock' || (r.kind && r.kind !== 'stock')) return null;
	const st = r.data ? (JSON.parse(r.data) as Stats | null) : null;
	if (st && st.kind !== 'stock') return null;
	const b = barsOf(market, id, 260);
	const a = b.length >= 253 ? b[b.length - 253].close : null;
	const z = b.length >= 22 ? b[b.length - 22].close : null;
	const values: Input['values'] = { mom12: a && z ? z / a - 1 : null };
	if (st) for (const d of METRICS) if (d.key !== 'mom12') values[d.key] = st[d.key as keyof Stats] as number | null;
	return { id, sector: r.sector, market: r.ex === 'TASE' ? 'IL' : 'US', values };
}

/** the scores of the securities (shares; a fund gets nothing — its market is null) */
export function scoresOf(market: Database.Database, ids: number[]): Score[] {
	const u = universe(market);
	const all = inputs(market, u);
	const have = new Set(all.map((x) => x.id));
	const extra = ids.filter((id) => !have.has(id)).map((id) => outsider(market, id)).filter((x): x is Input => !!x);
	// an outsider is ranked among the universe's peers, but is not a peer itself
	return scoreAll(all, ids, (id) => trendOf(market, id), extra);
}

/** the shares among `ids` whose ratios are not loaded yet (or older than a week) — a request loads a few of them */
export function missingStats(market: Database.Database, ids: number[], now = new Date()) {
	const q = market.prepare(`select s.type, st.fetched_at as at from ref_securities s left join ref_security_stats st on st.security_id = s.id where s.id = ?`);
	const week = now.getTime() - 7 * 86_400_000;
	return ids.filter((id) => {
		const r = q.get(id) as { type: string; at: string | null } | undefined;
		return r?.type === 'stock' && (!r.at || Date.parse(r.at) < week);
	});
}

/** the shares whose ratios are missing or older than a week — the nightly load takes them in portions */
export function staleStats(market: Database.Database, limit = 800, now = new Date()) {
	const u = universe(market);
	const at = new Map((market.prepare('select security_id as id, fetched_at as at from ref_security_stats').all() as { id: number; at: string }[]).map((r) => [r.id, Date.parse(r.at)]));
	const week = now.getTime() - 7 * 86_400_000;
	return u.stocks
		.filter((s) => s.sector && (at.get(s.id) ?? 0) < week && s.start <= u.lastMonth - 13)
		.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0))
		.slice(0, limit)
		.map((s) => s.id);
}

// ── the journal: the score as a source, measured like any other ──────────────────────────────────────

export const SCORE_SOURCE = 'Квант-оценка';
const sourceOf = (app: Database.Database) =>
	(app.prepare('select id from sources where name = ?').get(SCORE_SOURCE) as { id: number } | undefined)?.id ??
	Number(app.prepare(`insert into sources (name, kind, market, notes) values (?, 'model', 'any', 'T-034: квант-оценка — 10 лучших зелёных раз в месяц')`).run(SCORE_SOURCE).lastInsertRowid);

/**
 * On a month's first weekdays: the 10 best green shares of the US universe that are liquid (turnover at least $1M a
 * day, price at least $5) become «Рекомендация» hypotheses for 3 months (simulation), and the source's automatic
 * portfolio buys them — so the journal says, on future prices, whether the score beats the market.
 */
export function recordScores(db: AppDb, app: Database.Database, market: Database.Database, now = new Date(), force = false) {
	const today = israelDate(now);
	const month = today.slice(0, 7);
	const out = { month, recorded: 0, skipped: null as string | null };
	if (app.prepare(`select 1 from model_quarters where variant = 'Q' and quarter = ?`).get(month)) return { ...out, skipped: 'already' };
	const wd = new Date(today + 'T12:00:00Z').getUTCDay();
	if (!force && (Number(today.slice(8, 10)) > 5 || wd === 0 || wd === 6)) return { ...out, skipped: 'not the start of a month' };
	const u = universe(market);
	const liquid = u.stocks.filter((s) => {
		if (s.market !== 'US') return false;
		const l = liquidity(s, u.lastMonth, u.usdIls);
		return l.turnoverUsd >= 1_000_000 && l.priceUsd >= 5;
	});
	if (liquid.length < 300) return { ...out, skipped: 'too few shares with data' };
	const best = scoresOf(market, liquid.map((s) => s.id))
		.filter((s) => s.color === 'green' && s.total !== null)
		.sort((a, b) => b.total! - a.total!)
		.slice(0, 10);
	if (!best.length) return { ...out, skipped: 'no green share' };
	const sourceId = sourceOf(app);
	// the method's version: what the score is made of (a change of the method is a new row in the statistics)
	const params = JSON.stringify({ factors: FACTORS, weights: 'equal', metrics: METRICS.map((d) => d.key), gate: 'sma200', green: 0.65, top: 10, months: 3 });
	const versionId =
		(app.prepare(`select id from model_versions where variant = 'Q' and params = ?`).get(params) as { id: number } | undefined)?.id ??
		Number(app.prepare(`insert into model_versions (variant, params, source_id) values ('Q', ?, ?)`).run(params, sourceId).lastInsertRowid);
	const [y, m] = month.split('-').map(Number);
	const horizonDate = new Date(Date.UTC(y, m + 2, 0)).toISOString().slice(0, 10);
	const L = (f: FactorScore) => f.grade ?? '—';
	app.transaction(() => {
		for (const s of best) {
			createHypothesis(
				db,
				market,
				{
					sourceId,
					securityId: s.id,
					signalType: 'recommendation',
					direction: 'long',
					directionSource: 'article',
					thesis: `${month}: квант-оценка ${Math.round(s.total! * 100)} из 100 — качество ${L(s.factors.quality)}, рост ${L(s.factors.growth)}, оценка ${L(s.factors.valuation)}, моментум ${L(s.factors.momentum)}; цена выше SMA200`,
					invalidation: 'Бумага не обгонит рынок за 3 месяца',
					mode: 'sim',
					horizon: 'date',
					horizonDate,
					tags: `квант-оценка, ${month}`
				},
				now,
				{ modelVersionId: versionId }
			);
			out.recorded++;
		}
		app.prepare(`insert into model_quarters (variant, quarter, version_id, hypotheses) values ('Q', ?, ?, ?)`).run(month, versionId, out.recorded);
	})();
	setAuto(app, market, sourceId, true, now);
	return out;
}
