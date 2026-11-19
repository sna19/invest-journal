import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { marked } from 'marked';
import { eq, notInArray } from 'drizzle-orm';
import type { AppDb } from './db.js';
import { helpTopics } from './schema/app.js';

/**
 * Spec section 8 — help texts live in the repository, one file per topic: help/<key>.md, the first line is
 * the title. At start they are loaded into help_topics; changing a text needs no code change.
 */
export const helpDir = resolve(process.env.HELP_DIR ?? 'help');

export interface HelpFile {
	key: string;
	title: string;
	bodyMd: string;
}

export function readHelpFiles(dir = helpDir): HelpFile[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith('.md'))
		.map((f) => {
			const [first, ...rest] = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').split('\n');
			return { key: f.slice(0, -3), title: first.replace(/^#+\s*/, '').trim(), bodyMd: rest.join('\n').trim() };
		});
}

/**
 * Upserts every file, removes topics whose file is gone. English texts (help/en/<key>.md, 19.11.2026) are kept
 * beside the Russian ones under the key «en:<key>».
 */
export function loadHelp(db: AppDb, dir = helpDir) {
	const ru = readHelpFiles(dir);
	const files = [...ru, ...readHelpFiles(join(dir, 'en')).map((f) => ({ ...f, key: `en:${f.key}` }))];
	db.transaction((tx) => {
		for (const f of files) {
			tx.insert(helpTopics)
				.values(f)
				.onConflictDoUpdate({ target: helpTopics.key, set: { title: f.title, bodyMd: f.bodyMd, updatedAt: new Date().toISOString() } })
				.run();
		}
		if (files.length) tx.delete(helpTopics).where(notInArray(helpTopics.key, files.map((f) => f.key))).run();
	});
	return ru.length;
}

/** A topic for the help window: title and the body as HTML (texts come from the repository). */
export function helpTopic(db: AppDb, key: string, lang: 'ru' | 'en' = 'ru') {
	const get = (k: string) => db.select().from(helpTopics).where(eq(helpTopics.key, k)).get();
	// an English reader gets the English text, the Russian one if there is no translation
	const t = (lang === 'en' && !key.startsWith('en:') ? get(`en:${key}`) : undefined) ?? get(key);
	if (!t) return null;
	return { key, title: t.title, html: marked.parse(t.bodyMd, { async: false }) as string };
}
