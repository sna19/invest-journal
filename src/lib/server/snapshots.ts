import type Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { israelDate, type Errors } from '../hypothesis.js';
import { InputError } from './journal.js';
import { currentUserId } from './auth.js';
import { backupDir, dataDir } from './db.js';
import { addEntry } from './diary.js';
import { addReminder } from './reminders.js';

/**
 * T-032 11в «Снимки и квартальные» (spec 23, Д-21 — Д-26). A snapshot keeps the numbers a screen showed — a chart, a
 * comparison, the model's candidates with its parameters, a portfolio — and is drawn later by the same components, never
 * updated (Д-22, Д-34). A photo from the iPhone comes already made smaller (to about 1 600 px, in the browser) and lies in
 * data/media, one folder per user; the daily backup copies the new files (Д-24, Д-36).
 */

export const SNAPSHOT_TYPES = ['chart', 'compare', 'candidates', 'portfolio', 'scenario', 'stats', 'photo'] as const;
export type SnapshotType = (typeof SNAPSHOT_TYPES)[number];

export const mediaRoot = () => join(dataDir, 'media');
const userDir = () => `u${currentUserId() ?? 1}`;

const MAGIC: [string, number[]][] = [
	['jpg', [0xff, 0xd8, 0xff]],
	['png', [0x89, 0x50, 0x4e, 0x47]],
	['webp', [0x52, 0x49, 0x46, 0x46]]
];

/** a photo's bytes into data/media/u<user>/<year>/<id>.<ext>; returns its path under media */
export function savePhoto(bytes: Uint8Array) {
	if (bytes.length > 6 * 1024 * 1024) throw new InputError({ photo: 'Фото больше 6 МБ' } as Errors);
	const ext = MAGIC.find(([, m]) => m.every((b, i) => bytes[i] === b))?.[0];
	if (!ext) throw new InputError({ photo: 'Нужна картинка JPEG, PNG или WebP' } as Errors);
	const rel = join(userDir(), israelDate().slice(0, 4), `${randomUUID()}.${ext}`);
	mkdirSync(join(mediaRoot(), userDir(), israelDate().slice(0, 4)), { recursive: true });
	writeFileSync(join(mediaRoot(), rel), bytes);
	return rel;
}

/** a photo of the current user only; nothing outside its folder */
export function readPhoto(rel: string) {
	const clean = normalize(rel).replace(/^([/\\])+/, '');
	if (clean.includes('..') || !clean.startsWith(userDir() + '/') || !/\.(jpg|png|webp)$/.test(clean)) return null;
	const file = join(mediaRoot(), clean);
	if (!existsSync(file)) return null;
	const ext = clean.split('.').pop()!;
	return { bytes: readFileSync(file), type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
}

export interface SnapshotInput {
	type?: unknown;
	params?: unknown;
	data?: unknown;
	photoPath?: unknown;
}

/** Д-21, Д-22: a snapshot to an entry — its numbers frozen as they came */
export function addSnapshot(app: Database.Database, entryId: number, s: SnapshotInput) {
	const type = (SNAPSHOT_TYPES as readonly string[]).includes(String(s.type)) ? (s.type as SnapshotType) : null;
	if (!type) throw new InputError({ snapshot: 'Тип снимка' } as Errors);
	const params = JSON.stringify(s.params ?? {});
	const data = JSON.stringify(s.data ?? {});
	if (params.length + data.length > 600_000) throw new InputError({ snapshot: 'Снимок слишком большой' } as Errors);
	let photo: string | null = null;
	if (type === 'photo') {
		photo = typeof s.photoPath === 'string' ? s.photoPath : null;
		if (!photo || !readPhoto(photo)) throw new InputError({ snapshot: 'Нет такого фото' } as Errors);
	}
	return (app.prepare('insert into snapshots (entry_id, type, params, data, photo_path) values (?, ?, ?, ?, ?) returning id').get(entryId, type, params, data, photo) as { id: number }).id;
}

export function snapshotsOf(app: Database.Database, entryIds: number[]) {
	const out = new Map<number, { id: number; type: SnapshotType; params: unknown; data: unknown; photo: string | null; createdAt: string }[]>();
	if (!entryIds.length) return out;
	const rows = app
		.prepare(`select id, entry_id as entryId, type, params, data, photo_path as photo, created_at as createdAt from snapshots where entry_id in (${entryIds.map(() => '?').join(',')}) order by id`)
		.all(...entryIds) as { id: number; entryId: number; type: SnapshotType; params: string; data: string; photo: string | null; createdAt: string }[];
	for (const r of rows) out.set(r.entryId, [...(out.get(r.entryId) ?? []), { id: r.id, type: r.type, params: JSON.parse(r.params), data: JSON.parse(r.data), photo: r.photo, createdAt: r.createdAt }]);
	return out;
}

/**
 * Д-26: when the model records its quarter — a system entry with the candidates' snapshot (the variant, the parameters'
 * version, each candidate's numbers) linked to the run, and a reminder at the quarter's end: «разбор квартала».
 */
export function recordQuarterEntry(
	app: Database.Database,
	market: Database.Database,
	r: { variant: string; quarter: string; versionId: number; params: unknown; candidates: { id: number; symbol: string; name: string; sector: string | null; mean: number; median: number; worst: number; up: number; score: number | null }[]; years: number; quarterEnd: string }
) {
	const run = `${r.variant}|${r.quarter}`;
	const body = `<p>Модель ${r.variant} зафиксировала кандидатов на ${r.quarter.replace('-', ' ')}: ${r.candidates.length}. ${r.candidates.map((c) => c.symbol).join(', ')}</p>`;
	const entryId = addEntry(
		app,
		market,
		{ kind: 'observation', body, format: 'html', links: [{ type: 'model_run', id: run, primary: true }, ...r.candidates.map((c) => ({ type: 'security' as const, id: String(c.id) }))] },
		{ origin: `model:${run}` }
	);
	if (!entryId) return null;
	addSnapshot(app, entryId, { type: 'candidates', params: { variant: r.variant, quarter: r.quarter, versionId: r.versionId, years: r.years, params: r.params }, data: { candidates: r.candidates } });
	addReminder(app, { entryId, condition: 'date', date: r.quarterEnd, title: `Разбор квартала: модель ${r.variant} ${r.quarter.replace('-', ' ')}` });
	return entryId;
}

/** Д-24: the daily backup copies the photos that are not in it yet (photos never change) */
export function backupMedia(dir = backupDir) {
	const src = mediaRoot();
	if (!existsSync(src)) return 0;
	let n = 0;
	const walk = (rel: string) => {
		for (const f of readdirSync(join(src, rel))) {
			const r = join(rel, f);
			if (statSync(join(src, r)).isDirectory()) walk(r);
			else if (!existsSync(join(dir, 'media', r))) {
				mkdirSync(join(dir, 'media', rel), { recursive: true });
				copyFileSync(join(src, r), join(dir, 'media', r));
				n++;
			}
		}
	};
	walk('');
	return n;
}
