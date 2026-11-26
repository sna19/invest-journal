import { json } from '@sveltejs/kit';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { backupDir, getApp } from '#lib/server/db.js';
import { deleteEntry, editEntry, entryForHypothesis, linkEntry, setArchived } from '#lib/server/diary.js';
import { body, fail } from '#lib/server/respond.js';

/** Д-39: the entry's words and security for a hypothesis made from it */
export function GET({ params }) {
	const e = entryForHypothesis(getApp().sqlite, Number(params.id));
	return e ? json(e) : json({ message: 'Нет такой записи' }, { status: 404 });
}

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
		if (b.action === 'link') {
			linkEntry(getApp().sqlite, Number(params.id), b.type, b.id);
			return json({ ok: true });
		}
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
