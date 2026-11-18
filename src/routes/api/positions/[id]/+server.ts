import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { deletePosition, positionView } from '#lib/server/portfolio.js';
import { backupDir } from '#lib/server/db.js';
import { body, fail } from '#lib/server/respond.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** GET — a position: its events top to bottom, the numbers, the linked hypotheses (idea → purchase). */
export function GET({ params }) {
	const v = positionView(getApp().sqlite, getMarket().sqlite, Number(params.id));
	if (!v) error(404, 'нет такой позиции');
	return json(v);
}

/** DELETE { confirm: true } — the position whole, with a copy of the journal made first (owner's request, 18.11.2026). */
export async function DELETE({ params, request }) {
	try {
		const b = await body(request);
		if (b.confirm !== true) return json({ message: 'Подтвердите удаление' }, { status: 400 });
		const app = getApp().sqlite;
		return json(
			deletePosition(app, getMarket().sqlite, Number(params.id), (tag) => {
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
