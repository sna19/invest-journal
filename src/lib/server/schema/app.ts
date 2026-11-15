import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * app.db — the journal: sources, articles, hypotheses and help texts. Nothing here can be rebuilt from
 * elsewhere, so this file is backed up daily. No foreign keys into market.db: a hypothesis keeps the
 * security's number and a copy of its ticker and name (spec section 14).
 */

const now = () =>
	text()
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

/** Spec section 8 — help texts, loaded from help/<key>.md at start; the files are the source. */
export const helpTopics = sqliteTable('help_topics', {
	key: text().primaryKey(),
	title: text().notNull(),
	bodyMd: text().notNull(),
	updatedAt: now()
});

/** Spec sections 3 and 17 — a publication, analyst or channel whose usefulness is measured. */
export const sources = sqliteTable('sources', {
	id: integer().primaryKey({ autoIncrement: true }),
	name: text().notNull().unique(),
	/** globes.co.il — a link from this domain (or its subdomain) picks the source */
	domain: text().unique(),
	/** publication | analyst | channel | own */
	kind: text().notNull().default('publication'),
	/** IL | US | any */
	market: text().notNull().default('any'),
	notes: text(),
	createdAt: now()
});

export const articles = sqliteTable(
	'articles',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		sourceId: integer()
			.notNull()
			.references(() => sources.id),
		/** the analyst or house whose call it is, not the journalist who retells it (section 17) */
		author: text(),
		/** null for an own idea */
		url: text(),
		title: text(),
		publishedAt: text(),
		readAt: text().notNull(),
		note: text(),
		createdAt: now()
	},
	(t) => [index('articles_url').on(t.url), index('articles_source').on(t.sourceId)]
);

export const hypotheses = sqliteTable(
	'hypotheses',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		articleId: integer()
			.notNull()
			.references(() => articles.id),

		// the security — its number in market.db and a copy of what it was called at the time
		securityId: integer().notNull(),
		symbol: text().notNull(),
		securityName: text().notNull(),
		exchangeCode: text().notNull(),
		currency: text().notNull(),
		/** USD | ILS | ILA — the unit of entry, exit and target prices */
		priceUnit: text().notNull(),

		// entered by the user; locked after saving (section 6)
		/** recommendation | target | opinion | news (section 17) */
		signalType: text().notNull(),
		/** long | short */
		direction: text().notNull(),
		/** article | mine — «news» is always «mine» */
		directionSource: text().notNull(),
		thesis: text().notNull(),
		/** optional (section 17); calibration uses only filled ones */
		confidencePct: integer(),
		invalidation: text().notNull(),
		/** sim | real; sim by default */
		mode: text().notNull().default('sim'),
		horizonDate: text().notNull(),
		/** article | default (3 months when the article names no term) */
		horizonSource: text().notNull(),
		targetPrice: real(),
		amount: real(),

		// editable at any time
		tags: text(),
		note: text(),

		// fixed by the app when saving; the price comes with stage 3 («ожидает цену» until then)
		createdAt: now(),
		entryDate: text().notNull(),
		entryPrice: real(),
		benchmarkId: integer().notNull(),
		benchmarkSymbol: text().notNull(),
		benchmarkEntry: real(),
		/** the trading day whose close is the entry: the first one from entry_date (section 6) */
		entryPriceDate: text(),

		// the current result of an open hypothesis, refreshed by the daily job
		lastDate: text(),
		lastPrice: real(),
		benchmarkLast: real(),
		currentReturnPct: real(),
		currentBenchmarkReturnPct: real(),
		currentExcessPct: real(),
		/** why an open hypothesis whose term has come is not closed yet, and the price problem it waits for */
		waitReason: text(),
		waitIssueId: integer(),

		// fixed by the app when closing
		/** open | closed | closed_early | cancelled */
		status: text().notNull().default('open'),
		exitDate: text(),
		exitPrice: real(),
		benchmarkExit: real(),
		returnPct: real(),
		benchmarkReturnPct: real(),
		excessPct: real(),
		/** hit | miss */
		outcome: text(),
		cancelledAt: text(),

		// written by the user after closing
		lesson: text(),
		closeReason: text()
	},
	(t) => [index('hypotheses_status').on(t.status, t.horizonDate), index('hypotheses_article').on(t.articleId)]
);
