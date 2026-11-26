import { json } from '@sveltejs/kit';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { backupDir, getApp } from '#lib/server/db.js';
import { deleteEntry, editEntry, setArchived } from '#lib/server/diary.js';
import { body, fail } from '#lib/server/respond.js';

/** PATCH { body?, kind?, tags? } — an edit (a new revision); POST { action: 'archive' | 'restore' }; DELETE { word: 'УДАЛИТЬ' } */
export async function PATCH({ params, request }) {
	try {
		return json({ id: editEntry(getApp().sqlite, Number(params.id), await body(request)) });
	} catch (e) {
		return fail(e);
	}
}

export async function POST({ params, request }) {
	try {
		const b = await body(request);
		setArchived(getApp().sqlite, Number(params.id), b.action === 'archive');
		return json({ ok: true });
	} catch (e) {
		return fail(e);
	}
}

export async function DELETE({ params, request }) {
	try {
		const app = getApp().sqlite;
		return json(
			deleteEntry(app, Number(params.id), (await body(request)).word, (tag) => {
				mkdirSync(backupDir, { recursive: true });
				const file = join(backupDir, `app-${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
				app.prepare('VACUUM INTO ?').run(file);
				return file;
			})
		);
	} catch (e) {
		return fail(e);
	}
}
