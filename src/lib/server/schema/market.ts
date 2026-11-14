import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * market.db — market data (spec section 14). Table groups by prefix: ref_* (reference), ops_* (service);
 * market_* (prices) comes with stage 3. This file can be rebuilt from /raw, so it holds no journal data.
 */

const now = () =>
	text()
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

// ── ref ────────────────────────────────────────────────────────────────────────

export const exchanges = sqliteTable('ref_exchanges', {
	/** NASDAQ, NYSE, NYSE_AMERICAN, NYSE_ARCA, CBOE_BZX, TASE, INDEX_US */
	code: text().primaryKey(),
	name: text().notNull(),
	country: text().notNull(),
	currency: text().notNull(),
	timezone: text().notNull()
});

export const securities = sqliteTable(
	'ref_securities',
	{
		/** permanent internal number: does not change when the ticker changes */
		id: integer().primaryKey({ autoIncrement: true }),
		exchangeCode: text()
			.notNull()
			.references(() => exchanges.code),
		/** stock | etf | index */
		type: text().notNull(),
		/** current ticker (history in ref_security_symbols) — kept here for search */
		symbol: text().notNull(),
		nameEn: text().notNull(),
		nameHe: text(),
		isin: text(),
		currency: text().notNull(),
		/** USD | ILS | ILA (agorot) */
		priceUnit: text().notNull(),
		listedAt: text(),
		delistedAt: text(),
		active: integer({ mode: 'boolean' }).notNull().default(true),
		isBenchmark: integer({ mode: 'boolean' }).notNull().default(false),
		/** lower-case «symbol name_en name_he» for the search field */
		search: text().notNull(),
		updatedAt: now()
	},
	(t) => [index('ref_securities_symbol').on(t.symbol), index('ref_securities_exchange').on(t.exchangeCode, t.active)]
);

export const securitySymbols = sqliteTable(
	'ref_security_symbols',
	{
		securityId: integer()
			.notNull()
			.references(() => securities.id),
		symbol: text().notNull(),
		validFrom: text().notNull(),
		/** null while the ticker is current */
		validTo: text()
	},
	(t) => [primaryKey({ columns: [t.securityId, t.validFrom] })]
);

export const providerSymbols = sqliteTable(
	'ref_provider_symbols',
	{
		securityId: integer()
			.notNull()
			.references(() => securities.id),
		/** nasdaqtrader | tase | yahoo */
		providerCode: text().notNull(),
		providerSymbol: text().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.securityId, t.providerCode] }),
		uniqueIndex('ref_provider_symbols_lookup').on(t.providerCode, t.providerSymbol)
	]
);

export const tradingDays = sqliteTable(
	'ref_trading_days',
	{
		exchangeCode: text().notNull(),
		date: text().notNull()
	},
	(t) => [primaryKey({ columns: [t.exchangeCode, t.date] })]
);

// ── ops ────────────────────────────────────────────────────────────────────────

export const providers = sqliteTable('ops_providers', {
	code: text().primaryKey(),
	name: text().notNull(),
	/** listings | prices | actions — comma-separated */
	dataKind: text().notNull(),
	/** requests per second, a soft limit */
	rateLimit: integer(),
	enabled: integer({ mode: 'boolean' }).notNull().default(true),
	priority: integer().notNull().default(0)
});

export const ingestRuns = sqliteTable(
	'ops_ingest_runs',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		/** listings | prices | actions | history | gaps */
		job: text().notNull(),
		providerCode: text().notNull(),
		startedAt: now(),
		finishedAt: text(),
		/** running | ok | suspicious | error */
		status: text().notNull().default('running'),
		rowsReceived: integer().notNull().default(0),
		rowsAdded: integer().notNull().default(0),
		rowsUpdated: integer().notNull().default(0),
		error: text()
	},
	(t) => [index('ops_ingest_runs_job').on(t.job, t.startedAt)]
);

export const ingestTasks = sqliteTable(
	'ops_ingest_tasks',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		job: text().notNull(),
		securityId: integer().notNull(),
		periodFrom: text().notNull(),
		periodTo: text().notNull(),
		/** queued | running | done | failed */
		status: text().notNull().default('queued'),
		attempts: integer().notNull().default(0),
		lastError: text(),
		updatedAt: now()
	},
	(t) => [index('ops_ingest_tasks_status').on(t.status, t.job)]
);

export const rawFiles = sqliteTable('ops_raw_files', {
	id: integer().primaryKey({ autoIncrement: true }),
	runId: integer()
		.notNull()
		.references(() => ingestRuns.id),
	providerCode: text().notNull(),
	/** path under RAW_DIR */
	path: text().notNull(),
	sha256: text().notNull(),
	bytes: integer().notNull(),
	createdAt: now()
});

export const qualityIssues = sqliteTable(
	'ops_quality_issues',
	{
		id: integer().primaryKey({ autoIncrement: true }),
		runId: integer(),
		securityId: integer(),
		date: text(),
		rule: text().notNull(),
		detail: text(),
		/** open | resolved */
		status: text().notNull().default('open'),
		createdAt: now()
	},
	(t) => [index('ops_quality_issues_status').on(t.status)]
);
