import type Database from 'better-sqlite3';
import { israelDate } from '../../hypothesis.js';
import type { AppDb } from '../db.js';
import { createHypothesis } from '../journal.js';
import { setAuto } from '../portfolio.js';
import { cleanParams, DEFAULTS, nextQuarter, runModel, universe, type Params, type Result, type Variant } from './quarterly.js';

/**
 * The quarterly model in a user's journal (T-009): each variant is a source of its own, so the journal compares
 * them on future data; on the first trading day of a quarter the variant records its candidates as hypotheses
 * (type «Рекомендация», horizon — the quarter's end, mode «симуляция») and its automatic portfolio buys them.
 * The parameters the hypotheses were recorded with are a version; a hypothesis refers to it.
 */

export const VARIANTS: Variant[] = ['A', 'B'];
export const SOURCE_NAME: Record<Variant, string> = { A: 'Квартальная схема', B: 'Квартальная схема — против рынка' };

export function readParams(app: Database.Database, v: Variant): Params {
	const r = app.prepare('select params from model_settings where variant = ?').get(v) as { params: string } | undefined;
	return r ? cleanParams(JSON.parse(r.params)) : { ...DEFAULTS };
}

export function writeParams(app: Database.Database, v: Variant, input: Record<string, unknown>): Params {
	const p = cleanParams(input, readParams(app, v));
	app.prepare(
		`insert into model_settings (variant, params, updated_at) values (?, ?, ?)
		 on conflict (variant) do update set params = excluded.params, updated_at = excluded.updated_at`
	).run(v, JSON.stringify(p), new Date().toISOString());
	return p;
}

/** the variant's source; created on first use, kind «model» */
export function sourceOf(app: Database.Database, v: Variant): number {
	const name = SOURCE_NAME[v];
	const r = app.prepare('select id from sources where name = ?').get(name) as { id: number } | undefined;
	if (r) return r.id;
	return Number(app.prepare(`insert into sources (name, kind, market, notes) values (?, 'model', 'any', ?)`).run(name, 'T-009: модель «Квартальная схема»').lastInsertRowid);
}

/** the version with exactly these parameters, or a new one */
function versionOf(app: Database.Database, v: Variant, p: Params, sourceId: number): number {
	const json = JSON.stringify(p);
	const r = app.prepare('select id from model_versions where variant = ? and params = ?').get(v, json) as { id: number } | undefined;
	if (r) return r.id;
	return Number(app.prepare('insert into model_versions (variant, params, source_id) values (?, ?, ?)').run(v, json, sourceId).lastInsertRowid);
}

/** the version of the variant's saved parameters now — a trade from a candidate's card refers to it (T-020) */
export function modelVersionNow(app: Database.Database, v: Variant): number {
	return versionOf(app, v, readParams(app, v), sourceOf(app, v));
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
	const what = v === 'A' ? 'росла' : r.params.compareWith === 'sector' ? 'обгоняла свой сектор' : 'обгоняла рынок';
	return `Q${r.quarter}: ${what} в ${c.up} из ${r.years.length} лет (${r.years[0]}–${r.years.at(-1)}); среднее ${fmt(c.mean)}, медиана ${fmt(c.median)}, худший год ${fmt(c.worst)}`;
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
export function recordQuarter(db: AppDb, app: Database.Database, market: Database.Database, v: Variant, now = new Date(), force = false): RecordResult {
	const today = israelDate(now);
	const { year, quarter } = quarterOf(today);
	const key = quarterKey(year, quarter);
	const out: RecordResult = { variant: v, quarter: key, recorded: 0, skipped: null };
	if (app.prepare('select 1 from model_quarters where variant = ? and quarter = ?').get(v, key)) return { ...out, skipped: 'already' };
	const day = Number(today.slice(8, 10));
	const month = Number(today.slice(5, 7));
	const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
	if (!force && ((month - 1) % 3 !== 0 || day > 10 || weekday === 0 || weekday === 6)) return { ...out, skipped: 'not the start of a quarter' };
	const u = universe(market);
	if (u.stocks.length < 500) return { ...out, skipped: 'monthly prices are not loaded yet' };
	const p = readParams(app, v);
	const r = runModel(u, v, quarter, p);
	if (r.forYear !== year) return { ...out, skipped: `the data end before ${key}` };
	const sourceId = sourceOf(app, v);
	const versionId = versionOf(app, v, p, sourceId);
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
					thesis: thesisOf(v, r, c),
					invalidation: v === 'A' ? 'Бумага не обгонит бенчмарк к концу квартала' : 'Бумага не обгонит рынок к концу квартала',
					mode: 'sim',
					horizon: 'date',
					horizonDate,
					tags: `модель ${v}, ${key}`
				},
				now,
				{ modelVersionId: versionId }
			);
			out.recorded++;
		}
		app.prepare('insert into model_quarters (variant, quarter, version_id, hypotheses) values (?, ?, ?, ?)').run(v, key, versionId, out.recorded);
	})();
	// the variant's virtual portfolio: its automatic portfolio buys every hypothesis on a rise
	setAuto(app, market, sourceId, true, now);
	return out;
}

/** whether the candidates of the next quarter are to be shown in advance: from two weeks before it */
export function upcoming(now = new Date()) {
	const n = nextQuarter(now);
	const start = Date.UTC(n.year, (n.quarter - 1) * 3, 1);
	const days = Math.ceil((start - now.getTime()) / 86_400_000);
	return { ...n, key: quarterKey(n.year, n.quarter), days, ready: days <= 14 };
}
