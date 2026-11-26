import type Database from 'better-sqlite3';
import { israelDate } from '../../hypothesis.js';
import type { AppDb } from '../db.js';
import { createHypothesis } from '../journal.js';
import { setAuto } from '../portfolio.js';
import { recordQuarterEntry } from '../snapshots.js';
import { cleanParams, DEFAULTS, nextQuarter, runModel, universe, type Params, type Result, type Universe, type Variant } from './quarterly.js';
import { commodityUniverse, readFunds } from './commodities.js';

/** T-031: the model runs on the shares or on the commodity funds — separate variants, sources and parameters */
export type Pool = 'stocks' | 'commodities';
export const POOL_VARIANTS: Record<Pool, Variant[]> = { stocks: ['A', 'B', 'C', 'G', 'D'], commodities: ['A', 'B'] };
/** the key of a variant in model_settings, model_versions and model_quarters: A … for the shares, cA, cB for commodities */
export const keyOf = (v: Variant, pool: Pool = 'stocks') => (pool === 'commodities' ? `c${v}` : v);
export const poolOfKey = (key: string): { variant: Variant; pool: Pool } => (key.startsWith('c') ? { variant: key.slice(1) as Variant, pool: 'commodities' } : { variant: key as Variant, pool: 'stocks' });
const COMMODITY_DEFAULTS: Params = { ...DEFAULTS, count: 3 };
/** commodities: no caps by size, B is always over the broad fund */
const forPool = (p: Params, pool: Pool): Params => (pool === 'commodities' ? { ...p, capGroups: [], compareWith: 'market' } : p);
export const cleanFor = (input: Record<string, unknown>, base: Params, pool: Pool) => forPool(cleanParams(input, base), pool);

/** the universe of a pool: the shares as loaded, or the commodity funds of the user's list (and their table) */
export function poolUniverse(app: Database.Database, market: Database.Database, pool: Pool, years = 10): { u: Universe; funds: ReturnType<typeof commodityUniverse>['rows'] | null } {
	const u = universe(market);
	if (pool === 'stocks') return { u, funds: null };
	const { funds, bench } = readFunds(app);
	const c = commodityUniverse(u, market, funds, bench, years);
	return { u: c.u, funds: c.rows };
}

/**
 * The quarterly model in a user's journal (T-009): each variant is a source of its own, so the journal compares
 * them on future data; on the first trading day of a quarter the variant records its candidates as hypotheses
 * (type «Рекомендация», horizon — the quarter's end, mode «симуляция») and its automatic portfolio buys them.
 * The parameters the hypotheses were recorded with are a version; a hypothesis refers to it.
 */

export const VARIANTS: Variant[] = ['A', 'B', 'C', 'G', 'D'];
export const SOURCE_NAME: Record<Variant, string> = { A: 'Квартальная схема', B: 'Квартальная схема — против рынка', C: 'Квартальная схема — оценка', D: 'Квартальная схема — против своего тренда', G: 'Квартальная схема — с причиной' };
export const COMMODITY_SOURCE: Partial<Record<Variant, string>> = { A: 'Квартальная — сырьё, А', B: 'Квартальная — сырьё, Б' };
export const sourceName = (v: Variant, pool: Pool = 'stocks') => (pool === 'commodities' ? COMMODITY_SOURCE[v]! : SOURCE_NAME[v]);

export function readParams(app: Database.Database, v: Variant, pool: Pool = 'stocks'): Params {
	const r = app.prepare('select params from model_settings where variant = ?').get(keyOf(v, pool)) as { params: string } | undefined;
	const base = pool === 'commodities' ? COMMODITY_DEFAULTS : DEFAULTS;
	return forPool(r ? cleanParams(JSON.parse(r.params), base) : { ...base }, pool);
}

export function writeParams(app: Database.Database, v: Variant, input: Record<string, unknown>, pool: Pool = 'stocks'): Params {
	const p = cleanFor(input, readParams(app, v, pool), pool);
	app.prepare(
		`insert into model_settings (variant, params, updated_at) values (?, ?, ?)
		 on conflict (variant) do update set params = excluded.params, updated_at = excluded.updated_at`
	).run(keyOf(v, pool), JSON.stringify(p), new Date().toISOString());
	return p;
}

/** the variant's source; created on first use, kind «model» */
export function sourceOf(app: Database.Database, v: Variant, pool: Pool = 'stocks'): number {
	const name = sourceName(v, pool);
	const r = app.prepare('select id from sources where name = ?').get(name) as { id: number } | undefined;
	if (r) return r.id;
	return Number(app.prepare(`insert into sources (name, kind, market, notes) values (?, 'model', 'any', ?)`).run(name, pool === 'commodities' ? 'T-031: квартальная модель на сырьевых фондах' : 'T-009: модель «Квартальная схема»').lastInsertRowid);
}

/** the version with exactly these parameters, or a new one */
function versionOf(app: Database.Database, v: Variant, p: Params, sourceId: number, pool: Pool = 'stocks'): number {
	const json = JSON.stringify(p);
	const key = keyOf(v, pool);
	const r = app.prepare('select id from model_versions where variant = ? and params = ?').get(key, json) as { id: number } | undefined;
	if (r) return r.id;
	return Number(app.prepare('insert into model_versions (variant, params, source_id) values (?, ?, ?)').run(key, json, sourceId).lastInsertRowid);
}

/** the version of the variant's saved parameters now — a trade from a candidate's card refers to it (T-020) */
export function modelVersionNow(app: Database.Database, v: Variant, pool: Pool = 'stocks'): number {
	return versionOf(app, v, readParams(app, v, pool), sourceOf(app, v, pool), pool);
}

export const quarterKey = (year: number, q: number) => `${year}-Q${q}`;

/** the last day of a quarter: 2027-Q1 → 2027-03-31 */
export const quarterLastDay = (year: number, q: number) => new Date(Date.UTC(year, q * 3, 0)).toISOString().slice(0, 10);

/** the quarter a date is in */
export function quarterOf(date: string) {
	const [y, m] = date.split('-').map(Number);
	return { year: y, quarter: Math.floor((m - 1) / 3) + 1 };
}

const fmt = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1).replace('.', ',')}%`;

export function thesisOf(v: Variant, r: Result, c: Result['candidates'][number]) {
	const what = v === 'A' ? 'росла' : v === 'D' ? 'была лучше своего обычного квартала' : r.params.compareWith === 'sector' ? 'обгоняла свой сектор' : 'обгоняла рынок';
	const score = (v === 'C' || v === 'G') && c.score !== null ? `балл ${c.score.toFixed(2).replace('.', ',')}; ` : '';
	return `Q${r.quarter}: ${score}${what} в ${c.up} из ${r.years.length} лет (${r.years[0]}–${r.years.at(-1)}); среднее ${fmt(c.mean)}, медиана ${fmt(c.median)}, худший год ${fmt(c.worst)}`;
}

export interface RecordResult {
	variant: Variant;
	quarter: string;
	recorded: number;
	skipped: string | null;
}

/**
 * Records the variant's candidates for the quarter of `now` — once per quarter; only in its first 10 days and on
 * a weekday (the entry is the close of the first trading day from the record date). `force` — for tests.
 */
export function recordQuarter(db: AppDb, app: Database.Database, market: Database.Database, v: Variant, now = new Date(), force = false, pool: Pool = 'stocks'): RecordResult {
	const today = israelDate(now);
	const { year, quarter } = quarterOf(today);
	const key = quarterKey(year, quarter);
	const vk = keyOf(v, pool);
	const out: RecordResult = { variant: v, quarter: key, recorded: 0, skipped: null };
	if (app.prepare('select 1 from model_quarters where variant = ? and quarter = ?').get(vk, key)) return { ...out, skipped: 'already' };
	const day = Number(today.slice(8, 10));
	const month = Number(today.slice(5, 7));
	const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
	if (!force && ((month - 1) % 3 !== 0 || day > 10 || weekday === 0 || weekday === 6)) return { ...out, skipped: 'not the start of a quarter' };
	const p = readParams(app, v, pool);
	const { u } = poolUniverse(app, market, pool, p.years);
	if (u.stocks.length < (pool === 'commodities' ? 3 : 500)) return { ...out, skipped: 'monthly prices are not loaded yet' };
	const r = runModel(u, v, quarter, p);
	if (r.forYear !== year) return { ...out, skipped: `the data end before ${key}` };
	const sourceId = sourceOf(app, v, pool);
	const versionId = versionOf(app, v, p, sourceId, pool);
	const horizonDate = quarterLastDay(year, quarter);
	app.transaction(() => {
		for (const c of r.candidates) {
			createHypothesis(
				db,
				market,
				{
					sourceId,
					securityId: c.id,
					signalType: 'recommendation',
					direction: 'long',
					directionSource: 'article',
					thesis: (pool === 'commodities' ? 'Сырьё. ' : '') + thesisOf(v, r, c),
					invalidation: v === 'A' ? 'Бумага не обгонит бенчмарк к концу квартала' : 'Бумага не обгонит рынок к концу квартала',
					mode: 'sim',
					horizon: 'date',
					horizonDate,
					tags: pool === 'commodities' ? `модель сырьё ${v}, ${key}` : `модель ${v}, ${key}`
				},
				now,
				{ modelVersionId: versionId }
			);
			out.recorded++;
		}
		app.prepare('insert into model_quarters (variant, quarter, version_id, hypotheses) values (?, ?, ?, ?)').run(vk, key, versionId, out.recorded);
	})();
	// the variant's virtual portfolio: its automatic portfolio buys every hypothesis on a rise
	setAuto(app, market, sourceId, true, now);
	// T-032 Д-26: a diary entry with the candidates' snapshot, and «разбор квартала» at its end
	try {
		recordQuarterEntry(app, market, {
			variant: pool === 'commodities' ? `сырьё ${v}` : v,
			quarter: key,
			versionId,
			params: p,
			years: r.years.length,
			quarterEnd: horizonDate,
			candidates: r.candidates.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, sector: c.sector, mean: c.mean, median: c.median, worst: c.worst, up: c.up, score: c.score }))
		});
	} catch (e) {
		console.error(`model ${v} ${key}: diary entry: ${e}`);
	}
	return out;
}

/** whether the candidates of the next quarter are to be shown in advance: from two weeks before it */
export function upcoming(now = new Date()) {
	const n = nextQuarter(now);
	const start = Date.UTC(n.year, (n.quarter - 1) * 3, 1);
	const days = Math.ceil((start - now.getTime()) / 86_400_000);
	return { ...n, key: quarterKey(n.year, n.quarter), days, ready: days <= 14 };
}
