import type Database from 'better-sqlite3';
import { marked } from 'marked';
import { israelDate, type Errors } from '../hypothesis.js';
import { SECTORS } from '../allocation.js';
import { InputError } from './journal.js';
import { benchmarkId, marketView, portfolioView } from './portfolio.js';
import { compareRefs } from './compare.js';
import { plainText, sanitize } from './richtext.js';

/**
 * T-032 «Дневник и решения» (spec section 23), 11а — the core. Everything the owner writes is one entry (Д-01) with a
 * kind (Д-02), links to any objects (Д-03), the frozen moment of every linked security and portfolio (Д-05, Д-34),
 * chains (Д-06), revisions (Д-33), tags (Д-12) and full-text search (Д-10). An entry about a share is seen upwards —
 * in its sector, its indices, the portfolios it is or was in, the model runs it was a candidate of — marked «через
 * AAPL» (Д-04); never downwards.
 */

export const KINDS = ['note', 'observation', 'decision', 'conclusion'] as const;
export type Kind = (typeof KINDS)[number];
export const LINK_TYPES = ['security', 'sector', 'industry', 'portfolio', 'position', 'event', 'hypothesis', 'source', 'model_run'] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export interface Link {
	type: LinkType;
	id: string;
	primary?: boolean;
}

const r2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const daysBefore = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);

// ── the moment (Д-05) ────────────────────────────────────────────────────────────────────────────────────

type MV = ReturnType<typeof marketView>;

/**
 * A security at a date (or now): the price, its unit, the change for the day and the month, the market's month and the
 * share against it, its weight in the portfolios that hold it. A score of the quarterly model and the consensus are
 * not kept yet (no data for them) — the fields stay null.
 */
export function securityMoment(app: Database.Database, market: Database.Database, m: MV, id: number, date: string | null) {
	const s = market.prepare('select id, symbol, name_en as name, exchange_code as exchange, price_unit as unit, type from ref_securities where id = ?').get(id) as
		| { id: number; symbol: string; name: string; exchange: string; unit: string; type: string }
		| undefined;
	if (!s) return null;
	const live = date === null ? m.dayMove(id) : null;
	const at = date ?? israelDate();
	const last = live ? { date: live.date, close: live.now } : (() => {
		const p = market.prepare('select date, close from market_prices_daily where security_id = ? and date <= ? order by date desc limit 1').get(id, at) as { date: string; close: number } | undefined;
		return p ?? null;
	})();
	const prev = last ? (live ? live.prev : (market.prepare('select close from market_prices_daily where security_id = ? and date < ? order by date desc limit 1').get(id, last.date) as { close: number } | undefined)?.close ?? null) : null;
	const monthAgo = last ? m.price(id, daysBefore(last.date, 30)) : null;
	const bench = benchmarkId(market, s.exchange === 'TASE' ? 'benchmark:TA125' : 'benchmark:SPX');
	const bNow = bench && last ? m.price(bench, last.date) : null;
	const bThen = bench && last ? m.price(bench, daysBefore(last.date, 30)) : null;
	const monthPct = last && monthAgo ? (last.close / monthAgo - 1) * 100 : null;
	const benchMonthPct = bNow && bThen ? (bNow / bThen - 1) * 100 : null;
	return {
		symbol: s.symbol,
		name: s.name,
		unit: s.unit,
		price: last?.close ?? null,
		priceDate: last?.date ?? null,
		dayPct: r2(last && prev ? (last.close / prev - 1) * 100 : null),
		monthPct: r2(monthPct),
		benchMonthPct: r2(benchMonthPct),
		vsBenchMonth: r2(monthPct !== null && benchMonthPct !== null ? monthPct - benchMonthPct : null),
		benchId: bench ?? null,
		benchPrice: bNow,
		weights: date === null ? weightsOf(app, market, id) : null,
		score: null,
		consensus: null
	};
}

function weightsOf(app: Database.Database, market: Database.Database, securityId: number) {
	const ports = app
		.prepare(`select distinct s.portfolio_id as id from positions s join portfolios p on p.id = s.portfolio_id where s.security_id = ? and s.stage in ('holding', 'plan_sell') and p.archived_at is null`)
		.all(securityId) as { id: number }[];
	return ports.flatMap((p) => {
		const v = portfolioView(app, market, p.id);
		const pos = v?.positions.find((x) => x.securityId === securityId && x.qty > 0);
		return v && pos ? [{ portfolio: v.portfolio.name, pct: r2(pos.weight) }] : [];
	});
}

/** a portfolio now: its value, the day, the return since it is kept (time-weighted) */
export function portfolioMoment(app: Database.Database, market: Database.Database, id: number) {
	const v = portfolioView(app, market, id);
	if (!v) return null;
	return { name: v.portfolio.name, currency: v.summary.currency, value: r2(v.summary.value), dayPct: r2(v.summary.day?.pct ?? null), twrPct: r2(v.summary.twrPct) };
}

function freeze(app: Database.Database, market: Database.Database, m: MV, entryId: number, links: Link[], date: string | null) {
	const put = app.prepare('insert or ignore into entry_context (entry_id, object_type, object_id, data, restored) values (?, ?, ?, ?, ?)');
	for (const l of links) {
		if (l.type === 'security') {
			const x = securityMoment(app, market, m, Number(l.id), date);
			if (x) put.run(entryId, 'security', l.id, JSON.stringify(x), date ? 1 : 0);
		} else if (l.type === 'portfolio') {
			// a past day of a portfolio is not rebuilt: only the name is kept for a moved-in note
			const x = date ? { name: (app.prepare('select name from portfolios where id = ?').get(Number(l.id)) as { name: string } | undefined)?.name ?? '' } : portfolioMoment(app, market, Number(l.id));
			if (x) put.run(entryId, 'portfolio', l.id, JSON.stringify(x), date ? 1 : 0);
		}
	}
}

// ── tags (Д-12) ──────────────────────────────────────────────────────────────────────────────────────────

export const TAG_GROUPS = ['stocks', 'etf', 'indices', 'sectors', 'portfolios', 'candidates', 'strategies', 'hypotheses', 'decisions', 'risks', 'comparisons', 'personal'] as const;
const GROUP_COLOR: Record<string, string> = {
	stocks: '#2a78d6',
	etf: '#0e9488',
	indices: '#7a5af5',
	sectors: '#c2410c',
	portfolios: '#15803d',
	candidates: '#b45309',
	strategies: '#4d7c0f',
	hypotheses: '#be185d',
	decisions: '#1d4ed8',
	risks: '#b91c1c',
	comparisons: '#475569'
};
const PERSONAL = ['#9333ea', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#ca8a04'];

function tagId(app: Database.Database, name: string, grp: string, system: boolean) {
	const has = app.prepare('select id from tags where name = ? and grp = ?').get(name, grp) as { id: number } | undefined;
	if (has) return has.id;
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
	const color = GROUP_COLOR[grp] ?? PERSONAL[Math.abs(h) % PERSONAL.length];
	return (app.prepare('insert into tags (name, grp, system, color) values (?, ?, ?, ?) returning id').get(name, grp, system ? 1 : 0, color) as { id: number }).id;
}

/** the system tags a link gives: the share's symbol in «акции», «ETF» or «индексы», the sector, the portfolio… */
function systemTags(app: Database.Database, market: Database.Database, l: Link): [string, string][] {
	if (l.type === 'security') {
		const s = market.prepare('select symbol, type from ref_securities where id = ?').get(Number(l.id)) as { symbol: string; type: string } | undefined;
		return s ? [[s.symbol, s.type === 'etf' ? 'etf' : s.type === 'index' ? 'indices' : 'stocks']] : [];
	}
	if (l.type === 'sector') return [[SECTORS[l.id]?.[0] ?? l.id, 'sectors']];
	if (l.type === 'industry') return [[l.id, 'sectors']];
	if (l.type === 'portfolio') {
		const p = app.prepare('select name from portfolios where id = ?').get(Number(l.id)) as { name: string } | undefined;
		return p ? [[p.name, 'portfolios']] : [];
	}
	if (l.type === 'hypothesis') return [['гипотезы', 'hypotheses']];
	if (l.type === 'model_run') {
		const [v, q] = l.id.split('|');
		return [[`модель ${v} ${q ?? ''}`.trim(), 'candidates']];
	}
	return [];
}

// ── writing ──────────────────────────────────────────────────────────────────────────────────────────────

export interface EntryInput {
	kind?: unknown;
	body?: unknown;
	/** md (default: old notes, tests) | html (the rich editor) */
	format?: unknown;
	links?: unknown;
	tags?: unknown;
	parentId?: unknown;
}

function cleanLinks(v: unknown): Link[] {
	if (!Array.isArray(v)) return [];
	const out: Link[] = [];
	for (const x of v as { type?: unknown; id?: unknown; primary?: unknown }[]) {
		if (!(LINK_TYPES as readonly string[]).includes(String(x?.type)) || x.id === undefined || x.id === null || String(x.id) === '') continue;
		const l = { type: x.type as LinkType, id: String(x.id).slice(0, 120), primary: !!x.primary };
		if (!out.some((y) => y.type === l.type && y.id === l.id)) out.push(l);
	}
	// a position stands for its security and portfolio too — the moment and the inheritance need them
	return out;
}

function expandLinks(app: Database.Database, links: Link[]): Link[] {
	const out = [...links];
	const add = (l: Link) => !out.some((y) => y.type === l.type && y.id === l.id) && out.push(l);
	for (const l of links)
		if (l.type === 'position') {
			const p = app.prepare('select security_id as s, portfolio_id as p from positions where id = ?').get(Number(l.id)) as { s: number; p: number } | undefined;
			if (p) (add({ type: 'security', id: String(p.s) }), add({ type: 'portfolio', id: String(p.p) }));
		} else if (l.type === 'hypothesis') {
			const h = app.prepare('select security_id as s from hypotheses where id = ?').get(Number(l.id)) as { s: number } | undefined;
			if (h) add({ type: 'security', id: String(h.s) });
		}
	return out;
}

const personalTags = (v: unknown) =>
	Array.isArray(v)
		? [...new Set(v.map((t) => String(t).trim().replace(/^#/, '').slice(0, 40)).filter(Boolean))]
		: [];

/** the text of an entry as kept: sanitized HTML from the rich editor, or markdown; and its words for the search */
function textOf(body: unknown, format: unknown) {
	const raw = typeof body === 'string' ? body.trim().slice(0, 60000) : '';
	if (format === 'html') {
		const html = sanitize(raw);
		return { body: html, format: 'html' as const, text: plainText(html) };
	}
	return { body: raw, format: 'md' as const, text: raw };
}

/**
 * A new entry. `at` — a moved-in old note's own time: its moment is rebuilt from the prices of that date, marked
 * «восстановлено». `origin` — where it came from, so a move runs once.
 */
export function addEntry(app: Database.Database, market: Database.Database, input: EntryInput, opts: { at?: string; origin?: string } = {}) {
	const { body, format, text } = textOf(input.body, input.format);
	const kind = (KINDS as readonly string[]).includes(String(input.kind)) ? (input.kind as Kind) : 'note';
	if (!text) throw new InputError({ body: 'Текст записи' } as Errors);
	const parentId = input.parentId ? Number(input.parentId) : null;
	if (parentId && !app.prepare('select 1 from journal_entries where id = ?').get(parentId)) throw new InputError({ parentId: 'Нет такой записи' } as Errors);
	const links = expandLinks(app, cleanLinks(input.links));
	const m = marketView(market);
	return app.transaction(() => {
		if (opts.origin && app.prepare('select 1 from journal_entries where origin = ?').get(opts.origin)) return null;
		const at = opts.at ?? new Date().toISOString();
		const e = app
			.prepare(`insert into journal_entries (created_at, kind, body, format, body_text, parent_entry_id, origin, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?) returning id`)
			.get(at, kind, body, format, text, parentId, opts.origin ?? null, at) as { id: number };
		app.prepare('insert into entry_revisions (entry_id, body, format, created_at) values (?, ?, ?, ?)').run(e.id, body, format, at);
		const link = app.prepare('insert or ignore into entry_links (entry_id, object_type, object_id, is_primary) values (?, ?, ?, ?)');
		for (const l of links) link.run(e.id, l.type, l.id, l.primary ? 1 : 0);
		// a note written just now (a «Заметка» in the card) gets the live moment; an old one — rebuilt for its date
		const old = opts.at && Date.now() - Date.parse(opts.at) > 6 * 3600_000;
		freeze(app, market, m, e.id, links, old ? opts.at!.slice(0, 10) : null);
		const tag = app.prepare('insert or ignore into entry_tags (entry_id, tag_id) values (?, ?)');
		for (const l of links) for (const [name, grp] of systemTags(app, market, l)) tag.run(e.id, tagId(app, name, grp, true));
		for (const t of personalTags(input.tags)) tag.run(e.id, tagId(app, t, 'personal', false));
		return e.id;
	})();
}

/** Д-33: an edit is a new revision; the links, the tags and the moment stay */
export function editEntry(app: Database.Database, id: number, input: { body?: unknown; format?: unknown; kind?: unknown; tags?: unknown }) {
	const e = app.prepare('select id, body, kind from journal_entries where id = ?').get(id) as { id: number; body: string; kind: string } | undefined;
	if (!e) throw new InputError({ id: 'Нет такой записи' } as Errors);
	return app.transaction(() => {
		if (typeof input.body === 'string') {
			const { body, format, text } = textOf(input.body, input.format);
			if (!text) throw new InputError({ body: 'Текст записи' } as Errors);
			if (body !== e.body) {
				const now = new Date().toISOString();
				app.prepare('update journal_entries set body = ?, format = ?, body_text = ?, updated_at = ? where id = ?').run(body, format, text, now, id);
				app.prepare('insert into entry_revisions (entry_id, body, format, created_at) values (?, ?, ?, ?)').run(id, body, format, now);
			}
		}
		if ((KINDS as readonly string[]).includes(String(input.kind))) app.prepare('update journal_entries set kind = ? where id = ?').run(input.kind, id);
		if (input.tags !== undefined) {
			app.prepare(`delete from entry_tags where entry_id = ? and tag_id in (select id from tags where system = 0)`).run(id);
			const tag = app.prepare('insert or ignore into entry_tags (entry_id, tag_id) values (?, ?)');
			for (const t of personalTags(input.tags)) tag.run(id, tagId(app, t, 'personal', false));
		}
		return id;
	})();
}

export function revisions(app: Database.Database, id: number) {
	return app.prepare('select id, body, format, created_at as createdAt from entry_revisions where entry_id = ? order by id').all(id) as { id: number; body: string; format: string; createdAt: string }[];
}

/** Д-35: «удалить» is the archive; back from it any time */
export function setArchived(app: Database.Database, id: number, archived: boolean) {
	app.prepare('update journal_entries set status = ? where id = ?').run(archived ? 'archived' : 'active', id);
}

/** Д-35: deleting for good — the word typed, a copy of the journal made first; its answers lose the parent only */
export function deleteEntry(app: Database.Database, id: number, word: unknown, backup?: (tag: string) => string) {
	if (String(word ?? '').trim().toUpperCase() !== 'УДАЛИТЬ') throw new InputError({ word: 'Наберите слово УДАЛИТЬ' } as Errors);
	if (!app.prepare('select 1 from journal_entries where id = ?').get(id)) throw new InputError({ id: 'Нет такой записи' } as Errors);
	const file = backup?.(`before-delete-entry-${id}`) ?? null;
	app.transaction(() => {
		for (const t of ['entry_revisions', 'entry_links', 'entry_context', 'entry_tags']) app.prepare(`delete from ${t} where entry_id = ?`).run(id);
		app.prepare('update journal_entries set parent_entry_id = null where parent_entry_id = ?').run(id);
		app.prepare('delete from journal_entries where id = ?').run(id);
	})();
	return { backup: file };
}

// ── reading: scope, inheritance, filters (Д-04, Д-07 — Д-10) ───────────────────────────────────────────────

export interface Scope {
	type: LinkType;
	id: string;
}

/** «security:12» → the scope of a place */
export function scopeOf(v: string | null): Scope | null {
	if (!v) return null;
	const i = v.indexOf(':');
	const type = v.slice(0, i);
	return (LINK_TYPES as readonly string[]).includes(type) && i > 0 ? { type: type as LinkType, id: v.slice(i + 1) } : null;
}

/**
 * The entries a place shows: linked to it directly, and — upwards — those of the securities that belong to it, with the
 * security that brought each (`via`). `inherit` false — the direct ones only («включая записи бумаг» off).
 */
function scopeMatch(app: Database.Database, market: Database.Database, scope: Scope, inherit: boolean) {
	const direct = app.prepare('select entry_id as e from entry_links where object_type = ? and object_id = ?').all(scope.type, scope.id) as { e: number }[];
	const via = new Map<number, string>(); // entry → «AAPL»
	const ids = new Set(direct.map((x) => x.e));
	if (!inherit) return { ids, via };
	const linkedSecs = (app.prepare(`select distinct cast(object_id as integer) as id from entry_links where object_type = 'security'`).all() as { id: number }[]).map((x) => x.id);
	let belongs: (sid: number) => boolean = () => false;
	if (scope.type === 'sector' || scope.type === 'industry') {
		const col = scope.type === 'sector' ? 'sector' : 'industry';
		const q = market.prepare(`select 1 from ref_security_profiles where security_id = ? and ${col} = ?`);
		belongs = (sid) => !!q.get(sid, scope.id);
	} else if (scope.type === 'security') {
		const target = Number(scope.id);
		const t = market.prepare('select type from ref_securities where id = ?').get(target) as { type: string } | undefined;
		// a share inherits nothing; an ETF or an index sees the shares it is the benchmark or a reference of
		if (t && t.type !== 'stock') {
			const bench = (sid: number) => {
				const e = (market.prepare('select exchange_code as x from ref_securities where id = ?').get(sid) as { x: string } | undefined)?.x;
				return benchmarkId(market, e === 'TASE' ? 'benchmark:TA125' : 'benchmark:SPX');
			};
			belongs = (sid) => sid !== target && (bench(sid) === target || compareRefs(market, sid).some((r) => r.id === target));
		}
	} else if (scope.type === 'portfolio') {
		const q = app.prepare('select 1 from positions where portfolio_id = ? and security_id = ?');
		belongs = (sid) => !!q.get(Number(scope.id), sid);
	} else if (scope.type === 'model_run') {
		const secs = new Set(modelRunSecurities(app, scope.id));
		belongs = (sid) => secs.has(sid);
	} else if (scope.type === 'source') {
		// a source sees the entries of its hypotheses — «через №12»
		const hs = app
			.prepare(`select h.id from hypotheses h join articles a on a.id = h.article_id where a.source_id = ?`)
			.all(Number(scope.id)) as { id: number }[];
		const q = app.prepare(`select entry_id as e from entry_links where object_type = 'hypothesis' and object_id = ?`);
		for (const h of hs) for (const r of q.all(String(h.id)) as { e: number }[]) if (!ids.has(r.e)) (ids.add(r.e), via.set(r.e, `№${h.id}`));
	}
	const sym = market.prepare('select symbol from ref_securities where id = ?');
	const ofSec = app.prepare(`select entry_id as e from entry_links where object_type = 'security' and object_id = ?`);
	for (const sid of linkedSecs) {
		if (!belongs(sid)) continue;
		const s = (sym.get(sid) as { symbol: string } | undefined)?.symbol ?? String(sid);
		for (const r of ofSec.all(String(sid)) as { e: number }[]) if (!ids.has(r.e)) (ids.add(r.e), via.set(r.e, s));
	}
	return { ids, via };
}

/** the securities a model run («A|2027-Q1») recorded as candidates */
export function modelRunSecurities(app: Database.Database, run: string): number[] {
	const [variant, quarter] = run.split('|');
	const q = app.prepare('select version_id as v from model_quarters where variant = ? and quarter = ?').get(variant, quarter) as { v: number } | undefined;
	if (!q || !quarter) return [];
	const [y, qq] = quarter.split('-Q').map(Number);
	const start = new Date(Date.UTC(y, (qq - 1) * 3 - 1, 1)).toISOString().slice(0, 10);
	const end = new Date(Date.UTC(y, qq * 3, 0)).toISOString().slice(0, 10);
	return (app.prepare('select distinct security_id as s from hypotheses where model_version_id = ? and entry_date between ? and ?').all(q.v, start, end) as { s: number }[]).map((x) => x.s);
}

export interface Filters {
	scope?: Scope | null;
	inherit?: boolean;
	kind?: string | null;
	/** «personal» — not about decisions; «decisions» — decisions only */
	only?: string | null;
	tags?: number[];
	from?: string | null;
	to?: string | null;
	/** 'all' — about any hypothesis, or a hypothesis's id */
	hyp?: string | null;
	q?: string | null;
	archived?: boolean;
	/** the cursor: entries older than this one */
	before?: number | null;
	limit?: number;
}

/** turns words into an FTS5 query: each word as a prefix, all of them required */
function ftsQuery(q: string) {
	const words = q.match(/[\p{L}\p{N}]+/gu) ?? [];
	return words.map((w) => `"${w}"*`).join(' ');
}

export function listEntries(app: Database.Database, market: Database.Database, f: Filters) {
	const where: string[] = [];
	const args: unknown[] = [];
	let via = new Map<number, string>();
	if (f.scope) {
		const s = scopeMatch(app, market, f.scope, f.inherit !== false);
		via = s.via;
		if (!s.ids.size) return { items: [], next: null };
		where.push(`e.id in (${[...s.ids].join(',')})`);
	}
	where.push(f.archived ? `e.status = 'archived'` : `e.status = 'active'`);
	// a chain shows under its first entry (Д-06): answers are not in the feed by themselves
	if (!f.q) where.push('e.parent_entry_id is null');
	if (f.kind && (KINDS as readonly string[]).includes(f.kind)) (where.push('e.kind = ?'), args.push(f.kind));
	if (f.only === 'decisions') where.push(`e.kind = 'decision'`);
	if (f.only === 'personal') where.push(`e.kind <> 'decision' and not exists (select 1 from entry_links l where l.entry_id = e.id and l.object_type = 'event')`);
	for (const t of f.tags ?? []) (where.push('exists (select 1 from entry_tags t where t.entry_id = e.id and t.tag_id = ?)'), args.push(t));
	if (f.from) (where.push('e.created_at >= ?'), args.push(f.from));
	if (f.to) (where.push('e.created_at < ?'), args.push(daysBefore(f.to, -1)));
	if (f.hyp === 'all') where.push(`exists (select 1 from entry_links l where l.entry_id = e.id and l.object_type = 'hypothesis')`);
	else if (f.hyp) (where.push(`exists (select 1 from entry_links l where l.entry_id = e.id and l.object_type = 'hypothesis' and l.object_id = ?)`), args.push(String(f.hyp)));
	if (f.q && ftsQuery(f.q)) (where.push('e.id in (select rowid from journal_fts where journal_fts match ?)'), args.push(ftsQuery(f.q)));
	if (f.before) (where.push('(e.created_at, e.id) < (select created_at, id from journal_entries where id = ?)'), args.push(f.before));
	const limit = Math.min(Math.max(f.limit ?? 30, 1), 100);
	const rows = app
		.prepare(
			`select e.id, e.created_at as createdAt, e.updated_at as updatedAt, e.kind, e.body, e.format, e.parent_entry_id as parentId, e.status, e.origin
			   from journal_entries e where ${where.join(' and ')} order by e.created_at desc, e.id desc limit ?`
		)
		.all(...args, limit + 1) as Row[];
	const more = rows.length > limit;
	const items = describe(app, market, rows.slice(0, limit), via);
	return { items, next: more ? items.at(-1)!.id : null };
}

interface Row {
	id: number;
	createdAt: string;
	updatedAt: string;
	kind: Kind;
	body: string;
	format: string;
	parentId: number | null;
	status: string;
	origin: string | null;
}

export interface EntryView extends Row {
	html: string;
	via: string | null;
	links: { type: LinkType; id: string; isPrimary: number; label: string }[];
	tags: unknown[];
	context: { type: string; id: string; restored: boolean; then: unknown; now: unknown }[];
	revisions: number;
	decision: unknown;
	answers: EntryView[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** what a feed shows: a rich text as it was kept (sanitized at saving), a markdown one rendered */
export const htmlOf = (body: string, format: string) => (format === 'html' ? sanitize(body) : render(body));

/** the owner's markdown, safe: no HTML of its own, links only to http(s) */
export function render(md: string) {
	const html = marked.parse(esc(md), { async: false, breaks: true }) as string;
	return html.replace(/<a href="(?!https?:)[^"]*"/g, '<a').replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=');
}

/** the entries with their links (named), tags, moment then → now, answers and the revision count */
function describe(app: Database.Database, market: Database.Database, rows: Row[], via: Map<number, string>) {
	const m = marketView(market);
	const nowCache = new Map<string, unknown>();
	const linksQ = app.prepare('select object_type as type, object_id as id, is_primary as isPrimary from entry_links where entry_id = ?');
	const tagsQ = app.prepare('select t.id, t.name, t.grp, t.system, t.color from entry_tags x join tags t on t.id = x.tag_id where x.entry_id = ? order by t.system desc, t.name');
	const ctxQ = app.prepare('select object_type as type, object_id as id, data, restored from entry_context where entry_id = ?');
	const kidsQ = app.prepare(`select id, created_at as createdAt, kind, body, format from journal_entries where parent_entry_id = ? and status = 'active' order by created_at, id`);
	const revQ = app.prepare('select count(*) as n from entry_revisions where entry_id = ?');
	// 11б: the decision whose thesis the entry is
	const decQ = app.prepare(
		`select id, type, basis, basis_ref as basisRef, expectation, review_date as reviewDate, outcome, no_reason as noReason, cancelled_at as cancelledAt, created_at as createdAt from decisions where thesis_entry_id = ?`
	);
	const one = (r: Row, deep: boolean): EntryView => {
		const links = (linksQ.all(r.id) as { type: LinkType; id: string; isPrimary: number }[]).map((l) => ({ ...l, label: labelOf(app, market, l.type, l.id) }));
		const ctx = (ctxQ.all(r.id) as { type: string; id: string; data: string; restored: number }[]).map((c) => {
			const then = JSON.parse(c.data);
			const key = `${c.type}:${c.id}`;
			if (!nowCache.has(key)) nowCache.set(key, c.type === 'security' ? securityMoment(app, market, m, Number(c.id), null) : portfolioMoment(app, market, Number(c.id)));
			return { type: c.type, id: c.id, restored: !!c.restored, then, now: nowCache.get(key) };
		});
		return {
			...r,
			html: htmlOf(r.body, r.format),
			via: via.get(r.id) ?? null,
			links,
			tags: tagsQ.all(r.id),
			context: ctx,
			revisions: (revQ.get(r.id) as { n: number }).n,
			decision: (() => {
				const d = decQ.get(r.id) as { createdAt: string; cancelledAt: string | null } | undefined;
				return d ? { ...d, canCancel: !d.cancelledAt && Date.now() - Date.parse(d.createdAt) < 24 * 3600_000 } : null;
			})(),
			answers: deep ? (kidsQ.all(r.id) as Row[]).map((k) => one(k, true)) : []
		};
	};
	return rows.map((r) => one(r, true));
}

/** a link's name for the screen: AAPL, «Технологии», «Blink», «Гипотеза №12», «Модель A Q1 2027» */
export function labelOf(app: Database.Database, market: Database.Database, type: string, id: string): string {
	if (type === 'security') return (market.prepare('select symbol from ref_securities where id = ?').get(Number(id)) as { symbol: string } | undefined)?.symbol ?? `#${id}`;
	if (type === 'sector') return SECTORS[id]?.[0] ?? id;
	if (type === 'industry') return id;
	if (type === 'portfolio') return (app.prepare('select name from portfolios where id = ?').get(Number(id)) as { name: string } | undefined)?.name ?? `#${id}`;
	if (type === 'position') {
		const p = app.prepare('select s.symbol, p.name from positions s join portfolios p on p.id = s.portfolio_id where s.id = ?').get(Number(id)) as { symbol: string; name: string } | undefined;
		return p ? `${p.symbol} · ${p.name}` : `#${id}`;
	}
	if (type === 'hypothesis') return `Гипотеза №${id}`;
	if (type === 'source') return (app.prepare('select name from sources where id = ?').get(Number(id)) as { name: string } | undefined)?.name ?? `#${id}`;
	if (type === 'model_run') {
		const [v, q] = id.split('|');
		return `Модель ${v} ${q?.replace('-', ' ') ?? ''}`.trim();
	}
	if (type === 'event') return `Сделка #${id}`;
	return id;
}

/** Д-13: the tags of a place with their counts, frequent first */
export function tagCloud(app: Database.Database, market: Database.Database, scope: Scope | null, inherit = true) {
	let ids: number[] | null = null;
	if (scope) ids = [...scopeMatch(app, market, scope, inherit).ids];
	if (ids && !ids.length) return [];
	return app
		.prepare(
			`select t.id, t.name, t.grp, t.system, t.color, count(*) as n from entry_tags x join tags t on t.id = x.tag_id join journal_entries e on e.id = x.entry_id
			  where e.status = 'active' ${ids ? `and e.id in (${ids.join(',')})` : ''} group by t.id order by n desc, t.name`
		)
		.all() as { id: number; name: string; grp: string; system: number; color: string; n: number }[];
}

// ── moving the old notes in (spec 23: «существующие заметки и тезисы переносятся в дневник с исходными датами») ────

/**
 * Runs at start and after a new event or trade conditions: the notes of position events («Заметка», a note to a buy or
 * a sale, «Пересмотрел»), the theses of trade conditions and the notes of hypotheses become entries with their own dates
 * and links; the moment is rebuilt from the prices of that date and marked «восстановлено». Each moves once.
 */
export function syncJournal(app: Database.Database, market: Database.Database) {
	let n = 0;
	const done = app.prepare('select 1 from journal_entries where origin = ?');
	const evs = app
		.prepare(
			`select e.id, e.kind, e.date, e.note, e.created_at as createdAt, e.position_id as positionId, e.hypothesis_id as hypothesisId
			   from position_events e join positions s on s.id = e.position_id join portfolios p on p.id = s.portfolio_id
			  where e.note is not null and trim(e.note) <> '' and e.cancelled_at is null and e.auto = 0 and p.auto_source_id is null`
		)
		.all() as { id: number; kind: string; date: string; note: string; createdAt: string; positionId: number; hypothesisId: number | null }[];
	for (const e of evs) {
		if (done.get(`event:${e.id}`)) continue;
		const review = e.kind === 'note' && e.note.startsWith('Пересмотрел');
		const links: Link[] = [{ type: 'position', id: String(e.positionId), primary: true }];
		if (e.kind !== 'note') links.push({ type: 'event', id: String(e.id) });
		if (e.hypothesisId) links.push({ type: 'hypothesis', id: String(e.hypothesisId) });
		const at = e.date === e.createdAt.slice(0, 10) ? e.createdAt : `${e.date}T12:00:00.000Z`;
		if (addEntry(app, market, { kind: review ? 'observation' : 'note', body: e.note, links }, { at, origin: `event:${e.id}` })) n++;
	}
	const plans = app
		.prepare(
			`select t.id, t.position_id as positionId, t.event_id as eventId, t.thesis, t.wrong_if as wrongIf, t.created_at as createdAt
			   from trade_plans t where t.thesis is not null and trim(t.thesis) <> '' and t.reason is null`
		)
		.all() as { id: number; positionId: number; eventId: number | null; thesis: string; wrongIf: string | null; createdAt: string }[];
	for (const t of plans) {
		if (done.get(`plan:${t.id}`)) continue;
		const body = t.wrongIf ? `Тезис: ${t.thesis}\n\nНеправ, если: ${t.wrongIf}` : `Тезис: ${t.thesis}`;
		const links: Link[] = [{ type: 'position', id: String(t.positionId), primary: true }, ...(t.eventId ? [{ type: 'event' as const, id: String(t.eventId) }] : [])];
		if (addEntry(app, market, { kind: 'note', body, links, tags: ['тезис'] }, { at: t.createdAt, origin: `plan:${t.id}` })) n++;
	}
	const hyps = app.prepare(`select id, note, created_at as createdAt from hypotheses where note is not null and trim(note) <> ''`).all() as { id: number; note: string; createdAt: string }[];
	for (const h of hyps) {
		if (done.get(`hyp-note:${h.id}`)) continue;
		if (addEntry(app, market, { kind: 'note', body: h.note, links: [{ type: 'hypothesis', id: String(h.id), primary: true }] }, { at: h.createdAt, origin: `hyp-note:${h.id}` })) n++;
	}
	return n;
}
