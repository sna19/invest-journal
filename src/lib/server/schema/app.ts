import { sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * app.db — the journal: sources, articles, hypotheses (stage 2) and help texts. Nothing here can be
 * rebuilt from elsewhere, so this file is backed up daily. No foreign keys into market.db: a hypothesis
 * keeps the security's number and a copy of its ticker and name (spec section 14).
 */

/** Spec section 8 — help texts, loaded from help/<key>.md at start; the files are the source. */
export const helpTopics = sqliteTable('help_topics', {
	key: text().primaryKey(),
	title: text().notNull(),
	bodyMd: text().notNull(),
	updatedAt: text()
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
});
