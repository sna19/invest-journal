import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
		closeReason: text(),

		/** the quarterly model's version that recorded it (T-009); null — a hypothesis entered by hand */
		modelVersionId: integer()
	},
	(t) => [index('hypotheses_status').on(t.status, t.horizonDate), index('hypotheses_article').on(t.articleId)]
);

// ── Spec section 18 — portfolios: a history of events, positions and returns are computed from it ─────────

export const portfolios = sqliteTable(
	'portfolios',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		name: text().notNull().unique(),
		/** real | virtual */
		kind: text().notNull().default('real'),
		/** USD | ILS — the currency the broker shows the total in; chosen at creation, never changes (section 18) */
		currency: text().notNull().default('ILS'),
		/** the source whose hypotheses this virtual portfolio buys by itself (section 18) */
		autoSourceId: integer().references(() => sources.id),
		/** the sum an automatic portfolio puts into each hypothesis, in the portfolio's currency */
		autoAmountIls: real().notNull().default(10000),
		/**
		 * T-012, a model's portfolio: 1 — «hold if chosen again» (a share chosen for the next quarter is not sold and
		 * bought again), 0 — without the rule (variant C keeps both, to compare)
		 */
		autoHold: integer().notNull().default(1),
		/** for reference only, as the broker shows it («мас лешалем»): entered by hand, not computed */
		taxAccrued: real(),
		sortOrder: integer().notNull().default(0),
		createdAt: now(),
		archivedAt: text()
	},
	(t) => [uniqueIndex('portfolios_auto_source_currency_hold').on(t.autoSourceId, t.currency, t.autoHold)]
);

export const positions = sqliteTable(
	'positions',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		portfolioId: integer()
			.notNull()
			.references(() => portfolios.id),
		// the security — its number in market.db and a copy of what it was called (as in hypotheses)
		securityId: integer().notNull(),
		symbol: text().notNull(),
		securityName: text().notNull(),
		exchangeCode: text().notNull(),
		/** USD | ILS */
		currency: text().notNull(),
		/** USD | ILS | ILA — the unit of prices in the events */
		priceUnit: text().notNull(),
		/** watch | plan_buy | holding | plan_sell | closed — computed from the events, kept for lists */
		stage: text().notNull().default('watch'),
		openedAt: text().notNull(),
		closedAt: text(),
		createdAt: now()
	},
	(t) => [index('positions_portfolio').on(t.portfolioId, t.stage)]
);

export const positionEvents = sqliteTable(
	'position_events',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		positionId: integer()
			.notNull()
			.references(() => positions.id),
		/**
		 * watch | plan_buy | buy | plan_sell | sell | drop | note | reverse;
		 * opening («Перенесено»: a position bought before the portfolio was kept — qty and the price on that day);
		 * basis (the purchase cost of an opening, added later: `price` = average price, or `costTotal`)
		 */
		kind: text().notNull(),
		date: text().notNull(),
		/** buy, sell */
		qty: real(),
		/** buy, sell: the price paid; plan_buy, plan_sell: the wanted price — in the position's price unit */
		price: real(),
		/** USD | ILS — of price, fee and amount */
		currency: text().notNull(),
		fee: real(),
		/** ILS per one unit of `currency` on `date` (1 for ILS) */
		fxRate: real(),
		/** plan_buy: the sum to put in */
		amount: real(),
		/** opening / basis: the whole purchase cost of the position, in the portfolio's currency (as the broker shows it) */
		costTotal: real(),
		note: text(),
		hypothesisId: integer().references(() => hypotheses.id),
		/** T-020: a trade made from a model's candidate card — the model's version (its variant and parameters) */
		modelVersionId: integer(),
		/** reverse: the event it cancels (storno); both stay in the history */
		reversesEventId: integer(),
		/** written by the app (an automatic portfolio), not by a person */
		auto: integer({ mode: 'boolean' }).notNull().default(false),
		/** an input error undone within 24 hours */
		cancelledAt: text(),
		createdAt: now()
	},
	(t) => [index('position_events_position').on(t.positionId, t.date), index('position_events_hypothesis').on(t.hypothesisId)]
);

export const cashEvents = sqliteTable(
	'cash_events',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		portfolioId: integer()
			.notNull()
			.references(() => portfolios.id),
		/** deposit | withdraw | convert | dividend | fee | tax | reverse */
		kind: text().notNull(),
		date: text().notNull(),
		/** always positive; the kind gives the sign (convert: the sum given away) */
		amount: real().notNull(),
		/** USD | ILS */
		currency: text().notNull(),
		/** convert: the sum received and its currency; the deal's rate = amount / toAmount, bank fee included */
		toAmount: real(),
		toCurrency: text(),
		fxRate: real(),
		note: text(),
		/** a dividend or a fee of a position */
		positionId: integer().references(() => positions.id),
		reversesEventId: integer(),
		auto: integer({ mode: 'boolean' }).notNull().default(false),
		cancelledAt: text(),
		createdAt: now()
	},
	(t) => [index('cash_events_portfolio').on(t.portfolioId, t.date)]
);

// ── Spec section 21 — the quarterly model (T-009) ───────────────────────────────────────────────────────────

/** the parameters of each variant as the user set them on the model screen (JSON, see model/quarterly.ts) */
export const modelSettings = sqliteTable('model_settings', {
	/** A | B */
	variant: text().primaryKey(),
	params: text().notNull(),
	updatedAt: now()
});

/**
 * A set of parameters the model recorded hypotheses with: the hypotheses refer to it, and statistics are kept per
 * version — a change of parameters is a new version whose results are not mixed with the earlier ones.
 */
export const modelVersions = sqliteTable('model_versions', {
	id: integer().primaryKey({ autoIncrement: true }),
	variant: text().notNull(),
	params: text().notNull(),
	sourceId: integer()
		.notNull()
		.references(() => sources.id),
	createdAt: now()
});

/** a quarter the model has recorded hypotheses for — once per variant and quarter */
export const modelQuarters = sqliteTable(
	'model_quarters',
	{
		variant: text().notNull(),
		/** 2027-Q1 */
		quarter: text().notNull(),
		versionId: integer()
			.notNull()
			.references(() => modelVersions.id),
		hypotheses: integer().notNull(),
		recordedAt: now()
	},
	(t) => [primaryKey({ columns: [t.variant, t.quarter] })]
);

/**
 * T-012: a model's position carried into the next quarter by «hold if chosen again» — the next hypothesis on the
 * same share takes the position of the one that closed, without a sale and a purchase
 */
export const autoCarries = sqliteTable(
	'auto_carries',
	{
		portfolioId: integer()
			.notNull()
			.references(() => portfolios.id),
		hypothesisId: integer()
			.notNull()
			.references(() => hypotheses.id),
		positionId: integer()
			.notNull()
			.references(() => positions.id),
		fromHypothesisId: integer()
			.notNull()
			.references(() => hypotheses.id),
		createdAt: now()
	},
	(t) => [primaryKey({ columns: [t.portfolioId, t.hypothesisId] })]
);

/** a user's own settings, key → value (T-023: «employer» — the symbol of the employer's share, the job's risk) */
export const userSettings = sqliteTable('user_settings', {
	key: text().primaryKey(),
	value: text().notNull(),
	updatedAt: now()
});

/** T-023: a saved «Что если?» scenario — the securities, the amount and where the money comes from */
export const riskScenarios = sqliteTable('risk_scenarios', {
	id: integer().primaryKey({ autoIncrement: true }),
	portfolioId: integer()
		.notNull()
		.references(() => portfolios.id),
	name: text().notNull(),
	/** JSON: { adds: [{ securityId, symbol }], amountPct, source: 'cash' | positionSecurityId } */
	data: text().notNull(),
	createdAt: now()
});

/**
 * The securities the owner picked (owner's request 26.11.2026): a model's candidate opened from the model is picked by
 * that, any card can be picked with ☆. They stay first in the model's list and are compared on «Отмеченные».
 */
export const shortlist = sqliteTable('shortlist', {
	securityId: integer().primaryKey(),
	/** where it was picked: «модель A Q1», «карточка» */
	origin: text(),
	addedAt: now()
});

// ── T-015 — trade discipline: the exit conditions of a trade, the review at a sale, the owner's rules ──────────

/**
 * The conditions of a position's trade — kept as versions: a purchase, a «Пересмотрел» or a later fill (a carried-over
 * position) adds a row, the newest row is the current one. The row of a purchase points at its event: «доля сделок
 * с условием выхода» is counted on those.
 */
export const tradePlans = sqliteTable(
	'trade_plans',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		positionId: integer()
			.notNull()
			.references(() => positions.id),
		/** the buy / plan_buy event it came with; null — filled or changed later from the card */
		eventId: integer(),
		/** model | hypothesis | own | spec */
		kind: text().notNull(),
		thesis: text(),
		/** «что докажет, что я неправ» */
		wrongIf: text(),
		/** prices in the position's price unit */
		stop: real(),
		target: real(),
		reviewDate: text(),
		/** saved «без стопа»: why — the position gets the mark */
		noStopReason: text(),
		/** «Пересмотрел»: why the conditions changed */
		reason: text(),
		createdAt: now()
	},
	(t) => [index('trade_plans_position').on(t.positionId)]
);

/** The short review at a sale: the reason of the exit and whether the rule was kept */
export const tradeReviews = sqliteTable('trade_reviews', {
	/** the sell event */
	eventId: integer().primaryKey(),
	/** stop | target | model | thesis_broken | changed_mind */
	reason: text().notNull(),
	/** 1 — the rule was kept */
	followed: integer().notNull(),
	createdAt: now()
});

/** «Мои правила»: an editable list; the first three come with the migration */
export const rules = sqliteTable('rules', {
	id: integer().primaryKey({ autoIncrement: true }),
	text: text().notNull(),
	sortOrder: integer().notNull().default(0),
	createdAt: now()
});

/** T-015, Web Push: a device that allowed notifications (the home-screen app on an iPhone, a browser) */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
	endpoint: text().primaryKey(),
	p256dh: text().notNull(),
	auth: text().notNull(),
	/** what the device said it is — to tell the devices apart in the settings */
	device: text(),
	createdAt: now()
});

/** a signal already sent: `<kind>|<position>|<conditions version>` — each is sent once */
export const pushSent = sqliteTable('push_sent', {
	key: text().primaryKey(),
	sentAt: now()
});

// ── T-032 «Дневник и решения» (spec section 23), 11а: the core ──────────────────────────────────────────────────

/** Д-01: everything the owner writes is one entry — a note to a trade, an observation, a thought, a day's record */
export const journalEntries = sqliteTable(
	'journal_entries',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		/** when it was written — for a moved-in old note, its own date */
		createdAt: now(),
		/** note | observation | decision | conclusion */
		kind: text().notNull().default('note'),
		/** the latest revision: markdown (format md) or sanitized HTML (format html, the rich editor) */
		body: text().notNull(),
		/** md | html */
		format: text().notNull().default('md'),
		/** the text without marks — what the search reads */
		bodyText: text().notNull().default(''),
		/** Д-06: a continuation of or an answer to another entry */
		parentEntryId: integer(),
		/** active | archived */
		status: text().notNull().default('active'),
		/** moved in from elsewhere: «event:12», «plan:3», «hyp-note:7» — the move runs once per origin */
		origin: text().unique(),
		updatedAt: now()
	},
	(t) => [index('journal_entries_created').on(t.createdAt), index('journal_entries_parent').on(t.parentEntryId)]
);

/** Д-33: every text of an entry, the first one included — an edit never loses the earlier text */
export const entryRevisions = sqliteTable(
	'entry_revisions',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		entryId: integer()
			.notNull()
			.references(() => journalEntries.id),
		body: text().notNull(),
		format: text().notNull().default('md'),
		createdAt: now()
	},
	(t) => [index('entry_revisions_entry').on(t.entryId)]
);

/**
 * Д-03: what an entry is about. object_type: security (a share, an ETF, an index), sector, industry, portfolio,
 * position, event (a trade), hypothesis, source, model_run («A|2027-Q1»); the id is kept as text.
 */
export const entryLinks = sqliteTable(
	'entry_links',
	{
		entryId: integer()
			.notNull()
			.references(() => journalEntries.id),
		objectType: text().notNull(),
		objectId: text().notNull(),
		isPrimary: integer().notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.entryId, t.objectType, t.objectId] }), index('entry_links_object').on(t.objectType, t.objectId)]
);

/** Д-05, Д-34: the moment frozen at saving, per linked security and portfolio — never changed */
export const entryContext = sqliteTable(
	'entry_context',
	{
		entryId: integer()
			.notNull()
			.references(() => journalEntries.id),
		objectType: text().notNull(),
		objectId: text().notNull(),
		/** JSON */
		data: text().notNull(),
		/** 1 — rebuilt later from the prices of that date (a moved-in old note) */
		restored: integer().notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.entryId, t.objectType, t.objectId] })]
);

/** Д-12: system tags (set by the links) and personal ones */
export const tags = sqliteTable(
	'tags',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		name: text().notNull(),
		/** stocks | etf | indices | sectors | portfolios | candidates | strategies | hypotheses | decisions | risks | comparisons | personal */
		grp: text().notNull(),
		system: integer().notNull().default(0),
		color: text()
	},
	(t) => [uniqueIndex('tags_name_group').on(t.name, t.grp)]
);

export const entryTags = sqliteTable(
	'entry_tags',
	{
		entryId: integer()
			.notNull()
			.references(() => journalEntries.id),
		tagId: integer()
			.notNull()
			.references(() => tags.id)
	},
	(t) => [primaryKey({ columns: [t.entryId, t.tagId] }), index('entry_tags_tag').on(t.tagId)]
);

/**
 * T-032 11б, Д-14 — Д-19: a decision with its own thesis entry. Built over the trade conditions (T-015): a purchase's
 * thesis is the thesis entry, «Пересмотрел» at a signal is a «hold», a sale's review is the conclusion with «Сбылось?».
 * The key fields never change after saving; within 24 hours a decision can be cancelled.
 */
export const decisions = sqliteTable(
	'decisions',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		createdAt: now(),
		/** buy | add | sell | trim | hold | skip | defer */
		type: text().notNull(),
		securityId: integer().notNull(),
		portfolioId: integer(),
		positionId: integer(),
		/** the trade it came with */
		eventId: integer(),
		/** intuition | hypothesis | model | consensus | mixed */
		basis: text().notNull(),
		/** a hypothesis's id, a model run «A|2027-Q1» */
		basisRef: text(),
		thesisEntryId: integer().notNull(),
		/** what is expected: the target, the stop, words */
		expectation: text(),
		reviewDate: text(),
		/** «Сбылось?» at the sale: yes | partly | no | early */
		outcome: text(),
		outcomeAt: text(),
		conclusionEntryId: integer(),
		/** saved with an empty «Почему» — the position is marked «без обоснования» */
		noReason: integer().notNull().default(0),
		/** the trade conditions version it stands on */
		planId: integer(),
		cancelledAt: text(),
		origin: text().unique()
	},
	(t) => [index('decisions_security').on(t.securityId), index('decisions_position').on(t.positionId)]
);
