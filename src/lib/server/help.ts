import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { marked } from 'marked';
import { eq, notInArray } from 'drizzle-orm';
import type { AppDb } from './db.js';
import { helpTopics } from './schema/app.js';
import { glossaryMd } from '../glossary.js';

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

/** T-019: the five parts of a topic (Что это / Идея / Как пользоваться / Напоминание / Ловушка), by label */
export const PARTS = { ru: ['Что это.', 'Идея.', 'Как пользоваться.', 'Напоминание.', 'Ловушка.'], en: ['What it is.', 'The idea.', 'How to use it.', 'Reminder.', 'Trap.'] } as const;
export function partsOf(md: string, lang: 'ru' | 'en') {
	const labels = PARTS[lang];
	const out: Record<string, string> = {};
	const at = labels.map((l) => md.indexOf(`**${l}**`));
	labels.forEach((l, i) => {
		if (at[i] < 0) return;
		const from = at[i] + l.length + 4;
		const next = at.filter((x) => x > at[i]).sort((a, b) => a - b)[0] ?? md.length;
		out[l] = md.slice(from, next).replace(/<!--[\s\S]*?-->/g, '').trim();
	});
	return out;
}

/** T-019: every topic's «Напоминание» line in a language (the screens show it under each block's title) */
export function reminders(db: AppDb, lang: 'ru' | 'en' = 'ru') {
	const out: Record<string, string> = {};
	for (const t of db.select().from(helpTopics).all()) {
		const en = t.key.startsWith('en:');
		if (en !== (lang === 'en')) continue;
		const r = partsOf(t.bodyMd, lang)[PARTS[lang][3]];
		if (r) out[en ? t.key.slice(3) : t.key] = r.replace(/\*\*/g, '').replace(/\s+/g, ' ');
	}
	// an English reader without a translation gets the Russian line
	if (lang === 'en') for (const [k, v] of Object.entries(reminders(db, 'ru'))) if (!(k in out)) out[k] = v;
	return out;
}

/** A topic for the help window: title and the body as HTML (texts come from the repository). */
export function helpTopic(db: AppDb, key: string, lang: 'ru' | 'en' = 'ru') {
	const get = (k: string) => db.select().from(helpTopics).where(eq(helpTopics.key, k)).get();
	// an English reader gets the English text, the Russian one if there is no translation
	const t = (lang === 'en' && !key.startsWith('en:') ? get(`en:${key}`) : undefined) ?? get(key);
	if (!t) return null;
	// owner 27.11.2026: the glossary of every ratio and term at the bottom of «Показатели»
	const md = key === 'security.stats' ? `${t.bodyMd}\n\n${glossaryMd(t.key.startsWith('en:') ? 'en' : 'ru')}` : t.bodyMd;
	return { key, title: t.title, html: marked.parse(md, { async: false }) as string };
}
