import type Database from 'better-sqlite3';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
	directionSourceFor,
	horizonFor,
	israelDate,
	normalizeUrl,
	parseTags,
	toNumber,
	validate,
	type Errors,
	type HypothesisInput
} from '../hypothesis.js';
import type { AppDb } from './db.js';
import { articles, hypotheses, sources } from './schema/app.js';

/** Spec sections 2, 3, 6, 9 and 17 — the journal: sources, articles and hypotheses. */

export class InputError extends Error {
	constructor(public errors: Errors) {
		super(Object.values(errors)[0] ?? 'Ошибка ввода');
	}
}

export class LockedError extends Error {}

/** «www.barrons.com», «m.globes.co.il» → the source whose domain is a suffix of the host. */
export function sourceForUrl(db: AppDb, url: string | null | undefined) {
	const u = normalizeUrl(url);
	if (!u) return null;
	const host = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
	const all = db.select().from(sources).all().filter((s) => s.domain);
	return (
		all
			.filter((s) => host === s.domain || host.endsWith('.' + s.domain))
			.sort((a, b) => b.domain!.length - a.domain!.length)[0] ?? null
	);
}

export const listSources = (db: AppDb) => db.select().from(sources).orderBy(sql`${sources.kind} = 'own'`, sources.name).all();

export function addSource(db: AppDb, name: string, domain?: string | null) {
	const n = name.trim();
	if (!n) throw new InputError({ sourceId: 'Название источника' });
	const d = domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
	const found = db.select().from(sources).where(eq(sources.name, n)).get();
	if (found) return found;
	return db.insert(sources).values({ name: n, domain: d }).returning().get();
}

/** Authors typed before, the source's own first (section 17: autocomplete). */
export function listAuthors(db: AppDb, sourceId?: number) {
	return (
		db
			.select({ author: articles.author, n: sql<number>`count(*)`, mine: sql<number>`max(${articles.sourceId} = ${sourceId ?? -1})` })
			.from(articles)
			.where(sql`${articles.author} is not null and ${articles.author} <> ''`)
			.groupBy(articles.author)
			.orderBy(desc(sql`max(${articles.sourceId} = ${sourceId ?? -1})`), desc(sql`count(*)`))
			.limit(50)
			.all() as { author: string }[]
	).map((r) => r.author);
}

interface SecurityRow {
	id: number;
	symbol: string;
	name_en: string;
	exchange_code: string;
	currency: string;
	price_unit: string;
	active: number;
	country: string;
}

/** The security as it is now in market.db, and the benchmark of its market (section 5). */
function securityAndBenchmark(market: Database.Database, id: number) {
	const s = market
		.prepare(
			`select s.id, s.symbol, s.name_en, s.exchange_code, s.currency, s.price_unit, s.active, e.country
			   from ref_securities s join ref_exchanges e on e.code = s.exchange_code where s.id = ?`
		)
		.get(id) as SecurityRow | undefined;
	if (!s) return null;
	const key = s.country === 'IL' ? 'benchmark:TA125' : 'benchmark:SPX';
	const b = market
		.prepare(
			`select s.id, s.symbol from ref_provider_symbols p join ref_securities s on s.id = p.security_id
			  where p.provider_code = 'seed' and p.provider_symbol = ?`
		)
		.get(key) as { id: number; symbol: string };
	return { s, b };
}

export function createHypothesis(db: AppDb, market: Database.Database, input: HypothesisInput, now = new Date()) {
	const today = israelDate(now);
	const errors = validate(input, today);
	const found = input.securityId ? securityAndBenchmark(market, Number(input.securityId)) : null;
	if (input.securityId && !found) errors.securityId = 'Такой бумаги нет в базе';
	else if (found && !found.s.active) errors.securityId = 'Бумаги больше нет в списках биржи';
	if (found && found.s.exchange_code === 'INDEX_US') errors.securityId = 'Индекс — это бенчмарк, выберите акцию или ETF';
	const source = input.sourceId ? db.select().from(sources).where(eq(sources.id, Number(input.sourceId))).get() : null;
	if (input.sourceId && !source) errors.sourceId = 'Такого источника нет';
	if (Object.keys(errors).length) throw new InputError(errors);

	const url = normalizeUrl(input.url);
	const { horizonDate, horizonSource } = horizonFor(input.horizon, input.horizonDate, today);
	const { s, b } = found!;

	return db.transaction((tx) => {
		// one article can give several hypotheses — one per ticker (section 2)
		let article = input.articleId ? tx.select().from(articles).where(eq(articles.id, Number(input.articleId))).get() : undefined;
		if (article && article.sourceId !== source!.id) article = undefined;
		if (!article && url) {
			article = tx
				.select()
				.from(articles)
				.where(and(eq(articles.url, url), eq(articles.sourceId, source!.id)))
				.get();
		}
		const author = input.author?.trim() || null;
		if (!article) {
			article = tx
				.insert(articles)
				.values({ sourceId: source!.id, url, title: input.articleTitle?.trim() || null, author, readAt: today })
				.returning()
				.get();
		} else if ((author && !article.author) || (input.articleTitle && !article.title)) {
			article = tx
				.update(articles)
				.set({ author: article.author ?? author, title: article.title ?? (input.articleTitle?.trim() || null) })
				.where(eq(articles.id, article.id))
				.returning()
				.get();
		}
		const tags = parseTags(input.tags);
		return tx
			.insert(hypotheses)
			.values({
				articleId: article!.id,
				securityId: s.id,
				symbol: s.symbol,
				securityName: s.name_en,
				exchangeCode: s.exchange_code,
				currency: s.currency,
				priceUnit: s.price_unit,
				signalType: input.signalType!,
				direction: input.direction!,
				// T-007: an own idea has no article to take the direction from
				directionSource: source!.kind === 'own' ? 'mine' : directionSourceFor(input.signalType, input.directionSource),
				thesis: input.thesis!.trim(),
				confidencePct: toNumber(input.confidencePct),
				invalidation: input.invalidation!.trim(),
				mode: input.mode === 'real' ? 'real' : 'sim',
				horizonDate,
				horizonSource,
				targetPrice: toNumber(input.targetPrice),
				amount: toNumber(input.amount),
				tags: tags.length ? tags.join(', ') : null,
				// entry: the close of the first trading day from today — filled by the stage 3 job
				entryDate: today,
				benchmarkId: b.id,
				benchmarkSymbol: b.symbol
			})
			.returning()
			.get();
	});
}

export interface ListFilter {
	status?: 'open' | 'closed' | 'all';
	mode?: 'sim' | 'real' | 'all';
	market?: 'us' | 'il' | 'all';
	/** only hypotheses whose term was set by default (section 17) */
	defaultHorizon?: boolean;
}

const card = {
	h: hypotheses,
	sourceId: sources.id,
	sourceName: sources.name,
	sourceKind: sources.kind,
	author: articles.author,
	url: articles.url,
	title: articles.title
};

export function listHypotheses(db: AppDb, f: ListFilter = {}) {
	const where = [];
	if (f.status === 'open') where.push(eq(hypotheses.status, 'open'));
	else if (f.status === 'closed') where.push(sql`${hypotheses.status} in ('closed', 'closed_early')`);
	else where.push(sql`${hypotheses.status} <> 'cancelled'`);
	if (f.mode === 'sim' || f.mode === 'real') where.push(eq(hypotheses.mode, f.mode));
	if (f.market === 'il') where.push(eq(hypotheses.exchangeCode, 'TASE'));
	else if (f.market === 'us') where.push(sql`${hypotheses.exchangeCode} <> 'TASE'`);
	if (f.defaultHorizon) where.push(eq(hypotheses.horizonSource, 'default'));
	return db
		.select(card)
		.from(hypotheses)
		.innerJoin(articles, eq(articles.id, hypotheses.articleId))
		.innerJoin(sources, eq(sources.id, articles.sourceId))
		.where(and(...where))
		.orderBy(sql`${hypotheses.status} = 'open' desc`, hypotheses.horizonDate, desc(hypotheses.id))
		.all();
}

export function getHypothesis(db: AppDb, id: number) {
	return (
		db
			.select(card)
			.from(hypotheses)
			.innerJoin(articles, eq(articles.id, hypotheses.articleId))
			.innerJoin(sources, eq(sources.id, articles.sourceId))
			.where(eq(hypotheses.id, id))
			.get() ?? null
	);
}

/** What may change after saving (section 6): notes and tags; the lesson and close reason after closing. */
export const EDITABLE = ['note', 'tags', 'lesson', 'closeReason'] as const;

export function updateHypothesis(db: AppDb, id: number, patch: Record<string, unknown>) {
	const h = db.select().from(hypotheses).where(eq(hypotheses.id, id)).get();
	if (!h) return null;
	const locked = Object.keys(patch).filter((k) => !(EDITABLE as readonly string[]).includes(k));
	if (locked.length) throw new LockedError(`Эти поля после сохранения не меняются: ${locked.join(', ')}`);
	const closed = h.status === 'closed' || h.status === 'closed_early';
	if (!closed && (patch.lesson !== undefined || patch.closeReason !== undefined))
		throw new LockedError('Вывод и причина закрытия пишутся после закрытия гипотезы');
	const text = (v: unknown, max: number) => {
		if (v === null || v === undefined) return null;
		const s = String(v).trim();
		if (s.length > max) throw new InputError({ form: `Не длиннее ${max} знаков` });
		return s || null;
	};
	const set: Partial<typeof hypotheses.$inferInsert> = {};
	if ('note' in patch) set.note = text(patch.note, 2000);
	if ('tags' in patch) {
		const t = parseTags(text(patch.tags, 200));
		set.tags = t.length ? t.join(', ') : null;
	}
	if ('lesson' in patch) set.lesson = text(patch.lesson, 2000);
	if ('closeReason' in patch) set.closeReason = text(patch.closeReason, 500);
	if (!Object.keys(set).length) return h;
	return db.update(hypotheses).set(set).where(eq(hypotheses.id, id)).returning().get();
}

const DAY = 24 * 3600 * 1000;

/** An input error is cancelled within 24 hours of saving (section 6); the database refuses later ones too. */
export function cancelHypothesis(db: AppDb, id: number, now = new Date()) {
	const h = db.select().from(hypotheses).where(eq(hypotheses.id, id)).get();
	if (!h) return null;
	if (h.status === 'cancelled') return h;
	if (h.status !== 'open') throw new LockedError('Закрытую гипотезу отменить нельзя');
	if (now.getTime() - Date.parse(h.createdAt) > DAY) throw new LockedError('Отменить можно только в первые 24 часа после записи');
	return db
		.update(hypotheses)
		.set({ status: 'cancelled', cancelledAt: now.toISOString() })
		.where(eq(hypotheses.id, id))
		.returning()
		.get();
}

/** «Отменить» on the 5-second bar after a cancel: back to open, only while the 24 hours last. */
export function restoreHypothesis(db: AppDb, id: number, now = new Date()) {
	const h = db.select().from(hypotheses).where(eq(hypotheses.id, id)).get();
	if (!h) return null;
	if (h.status !== 'cancelled') return h;
	if (now.getTime() - Date.parse(h.createdAt) > DAY) throw new LockedError('Прошло больше 24 часов');
	return db
		.update(hypotheses)
		.set({ status: 'open', cancelledAt: null })
		.where(and(eq(hypotheses.id, id), isNull(hypotheses.exitDate)))
		.returning()
		.get();
}
