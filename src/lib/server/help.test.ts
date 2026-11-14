import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApp } from './db.js';
import { helpTopic, loadHelp, readHelpFiles } from './help.js';

const root = join(import.meta.dirname, '..', '..', '..');

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? sources(p) : /\.(svelte|ts)$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
	});
}

/** Every topic key the interface uses: <HelpIcon topicKey="…"> and <TopBar help="…">. */
function usedKeys() {
	const keys = new Set<string>();
	for (const f of sources(join(root, 'src'))) {
		for (const m of readFileSync(f, 'utf8').matchAll(/(?:topicKey|help)="([a-z]+\.[a-z.]+)"/g)) keys.add(m[1]);
	}
	return keys;
}

describe('help (spec section 8)', () => {
	const files = readHelpFiles(join(root, 'help'));

	it('every topicKey used in the interface has its help/<key>.md', () => {
		const have = new Set(files.map((f) => f.key));
		const used = usedKeys();
		expect(used.size).toBeGreaterThan(0);
		expect([...used].filter((k) => !have.has(k))).toEqual([]);
	});

	it('each file has a title on its first line and a body', () => {
		for (const f of files) {
			expect(f.title, f.key).toBeTruthy();
			expect(f.bodyMd.length, f.key).toBeGreaterThan(20);
		}
	});

	it('loads into help_topics and renders Markdown; removed files disappear', () => {
		const { db } = openApp(':memory:');
		expect(loadHelp(db, join(root, 'help'))).toBe(files.length);
		const t = helpTopic(db, 'ticker.search')!;
		expect(t.title).toBe('Поиск тикера');
		expect(t.html).toContain('<strong>');
		expect(helpTopic(db, 'nope')).toBeNull();
	});
});
