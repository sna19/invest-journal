import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { BUCKETS, byLowerBound, horizonBucket, score, split, type Score } from '../stats.js';
import type { AppDb } from './db.js';
import { articles, hypotheses, sources } from './schema/app.js';

/** Spec sections 7, 9 and 17 — the «Источники» table and the source card. */

export interface StatsFilter {
	/** leave out hypotheses whose term was set by default (section 17) */
	noDefault?: boolean;
}

function rows(db: AppDb, f: StatsFilter, sourceId?: number) {
	const where = [ne(hypotheses.status, 'cancelled')];
	if (f.noDefault) where.push(ne(hypotheses.horizonSource, 'default'));
	if (sourceId) where.push(eq(articles.sourceId, sourceId));
	return db
		.select({
			id: hypotheses.id,
			sourceId: articles.sourceId,
			articleId: articles.id,
			author: articles.author,
			status: hypotheses.status,
			signalType: hypotheses.signalType,
			outcome: hypotheses.outcome,
			excessPct: hypotheses.excessPct,
			mode: hypotheses.mode,
			entryDate: hypotheses.entryDate,
			horizonDate: hypotheses.horizonDate
		})
		.from(hypotheses)
		.innerJoin(articles, eq(articles.id, hypotheses.articleId))
		.where(and(...where))
		.all();
}

type Row = ReturnType<typeof rows>[number];

function parts(list: Row[]) {
	const s = split(list);
	return {
		score: score(s.rated),
		news: score(s.news),
		early: score(s.early),
		open: list.filter((r) => r.status === 'open').length
	};
}

export interface SourceRow {
	id: number;
	name: string;
	kind: string;
	articles: number;
	open: number;
	score: Score;
	news: Score;
	early: Score;
}

/** Every source with its rating, sorted by the lower bound of the interval (section 7). */
export function sourceTable(db: AppDb, f: StatsFilter = {}): SourceRow[] {
	const all = rows(db, f);
	const nArticles = new Map(
		(db
			.select({ id: articles.sourceId, n: sql<number>`count(distinct ${articles.id})` })
			.from(articles)
			.innerJoin(hypotheses, and(eq(hypotheses.articleId, articles.id), ne(hypotheses.status, 'cancelled')))
			.groupBy(articles.sourceId)
			.all() as { id: number; n: number }[]).map((r) => [r.id, r.n])
	);
	return db
		.select()
		.from(sources)
		.all()
		.map((s) => ({ id: s.id, name: s.name, kind: s.kind, articles: nArticles.get(s.id) ?? 0, ...parts(all.filter((r) => r.sourceId === s.id)) }))
		.sort((a, b) => byLowerBound(a, b) || b.open - a.open || a.name.localeCompare(b.name));
}

const TYPES: Record<string, string> = { recommendation: 'Рекомендация', target: 'Целевая цена', opinion: 'Мнение', news: 'Новость' };

/** The card: the same numbers, broken down by signal type, author, term and mode; the articles below. */
export function sourceCard(db: AppDb, id: number, f: StatsFilter = {}) {
	const src = db.select().from(sources).where(eq(sources.id, id)).get();
	if (!src) return null;
	const list = rows(db, f, id);
	const group = <K extends string>(key: (r: Row) => K, label: (k: K) => string) => {
		const m = new Map<K, Row[]>();
		for (const r of list) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
		return [...m.entries()].map(([k, rs]) => ({ key: k, label: label(k), ...parts(rs) })).sort(byLowerBound);
	};
	// by type: each type on its own, «news» included, as the card shows all of them
	const byType = Object.keys(TYPES)
		.map((t) => {
			const rs = list.filter((r) => r.signalType === t);
			const closed = rs.filter((r) => r.status === 'closed');
			return { key: t, label: TYPES[t], score: score(closed), open: rs.filter((r) => r.status === 'open').length, rated: t !== 'news' };
		})
		.filter((t) => t.score.n || t.open);
	const arts = db
		.select({
			a: articles,
			h: {
				id: hypotheses.id,
				symbol: hypotheses.symbol,
				direction: hypotheses.direction,
				signalType: hypotheses.signalType,
				status: hypotheses.status,
				outcome: hypotheses.outcome,
				excessPct: hypotheses.excessPct,
				currentExcessPct: hypotheses.currentExcessPct,
				horizonDate: hypotheses.horizonDate,
				horizonSource: hypotheses.horizonSource,
				entryPrice: hypotheses.entryPrice
			}
		})
		.from(articles)
		.innerJoin(hypotheses, and(eq(hypotheses.articleId, articles.id), ne(hypotheses.status, 'cancelled')))
		.where(and(eq(articles.sourceId, id), f.noDefault ? ne(hypotheses.horizonSource, 'default') : sql`1 = 1`))
		.orderBy(desc(articles.readAt), desc(articles.id), hypotheses.id)
		.all();
	const byArticle = new Map<number, { article: typeof articles.$inferSelect; hypotheses: (typeof arts)[number]['h'][] }>();
	for (const r of arts) {
		const e = byArticle.get(r.a.id) ?? { article: r.a, hypotheses: [] };
		e.hypotheses.push(r.h);
		byArticle.set(r.a.id, e);
	}
	return {
		source: src,
		...parts(list),
		articles: [...byArticle.values()],
		byType,
		byAuthor: group(
			(r) => (r.author?.trim() || '—') as string,
			(k) => (k === '—' ? 'Без автора' : k)
		),
		byHorizon: group(
			(r) => horizonBucket(r.entryDate, r.horizonDate),
			(k) => BUCKETS[k]
		),
		byMode: group(
			(r) => r.mode as 'sim' | 'real',
			(k) => (k === 'real' ? 'Реальные деньги' : 'Симуляция')
		)
	};
}
