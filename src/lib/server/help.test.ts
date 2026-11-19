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

const AREAS = 'account|hypothesis|result|source|stats|ticker|portfolio|consensus|security';

/**
 * Every topic key the interface uses: <HelpIcon topicKey="…">, <TopBar help="…"> and keys chosen in an
 * expression (topicKey={x ? 'stats.own' : 'stats.mode'}) — any quoted «area.name» in a .svelte file.
 */
function usedKeys() {
	const keys = new Set<string>();
	const attr = /(?:topicKey|help)="([a-z]+\.[a-z_.]+)"/g;
	const quoted = new RegExp(`['"]((?:${AREAS})\\.[a-z_]+(?:\\.[a-z_]+)*)['"]`, 'g');
	for (const f of sources(join(root, 'src'))) {
		const text = readFileSync(f, 'utf8');
		for (const m of text.matchAll(attr)) keys.add(m[1]);
		if (f.endsWith('.svelte')) for (const m of text.matchAll(quoted)) keys.add(m[1]);
	}
	return keys;
}

/** Spec section 8, the starting set, and the topics added by sections 17 and stage 6: each one has a place. */
const REQUIRED = [
	'hypothesis.list',
	'hypothesis.confidence',
	'hypothesis.invalidation',
	'hypothesis.horizon',
	'hypothesis.mode',
	'hypothesis.signal_type',
	'hypothesis.default_horizon',
	'result.excess',
	'result.locked',
	'result.prices',
	'source.stats',
	'source.threshold',
	'source.usefulness',
	'stats.screen',
	'stats.calibration',
	'stats.own',
	'stats.mode',
	'stats.tags',
	'ticker.search',
	'ticker.db',
	'portfolio.kinds',
	'portfolio.stages',
	'portfolio.twr',
	'portfolio.fx',
	'portfolio.source_auto',
	'portfolio.chart',
	'portfolio.allocation',
	'security.chart',
	'portfolio.together',
	'portfolio.transfer'
];

describe('help (spec section 8)', () => {
	const files = readHelpFiles(join(root, 'help'));

	it('every topicKey used in the interface has its help/<key>.md', () => {
		const have = new Set(files.map((f) => f.key));
		const used = usedKeys();
		expect(used.size).toBeGreaterThan(0);
		expect([...used].filter((k) => !have.has(k))).toEqual([]);
	});

	it('every topic of section 8 (and later sections) stands in the interface and has its text', () => {
		const used = usedKeys();
		const have = new Set(files.map((f) => f.key));
		expect(REQUIRED.filter((k) => !used.has(k))).toEqual([]);
		expect(REQUIRED.filter((k) => !have.has(k))).toEqual([]);
	});

	it('no help file is left without a place in the interface', () => {
		const used = usedKeys();
		expect(files.map((f) => f.key).filter((k) => !used.has(k))).toEqual([]);
	});

	it('docs/HELP.md is the current collection of the texts (npm run help:doc)', async () => {
		const { helpDoc, WHERE } = await import('../../../scripts/help-doc.mjs');
		expect(readFileSync(join(root, 'docs', 'HELP.md'), 'utf8')).toBe(helpDoc());
		expect(files.map((f) => f.key).filter((k) => !(k in WHERE))).toEqual([]);
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
		// English (19.11.2026): every topic has its translation, and an English reader gets it
		expect(helpTopic(db, 'ticker.search', 'en')!.title).toBe('Ticker search');
		expect(helpTopic(db, 'ticker.search', 'ru')!.title).toBe('Поиск тикера');
	});

	it('every topic has an English text with a title and a body', () => {
		const en = readHelpFiles(join(root, 'help', 'en'));
		expect(en.map((f) => f.key).sort()).toEqual(files.map((f) => f.key).sort());
		for (const f of en) {
			expect(f.title, f.key).toBeTruthy();
			expect(f.bodyMd.length, f.key).toBeGreaterThan(20);
			expect(/[А-Яа-яЁё]/.test(f.title + f.bodyMd), `${f.key} has Russian`).toBe(false);
		}
	});
});
