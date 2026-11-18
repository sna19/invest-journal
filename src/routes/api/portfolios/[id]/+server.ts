import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { deletePortfolio, portfolioCash, portfolioView, updatePortfolio } from '#lib/server/portfolio.js';
import { backupDir } from '#lib/server/db.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { body, fail } from '#lib/server/respond.js';

/** GET — value, return against the benchmarks, positions by stage, the money; PATCH { name, currency, archived, autoAmountIls }. */
export function GET({ params }) {
	const id = Number(params.id);
	const v = portfolioView(getApp().sqlite, getMarket().sqlite, id);
	if (!v) error(404, 'нет такого портфеля');
	return json({ ...v, cash: portfolioCash(getApp().sqlite, id) });
}

export async function PATCH({ params, request }) {
	try {
		return json(updatePortfolio(getApp().sqlite, Number(params.id), await body(request), getMarket().sqlite));
	} catch (e) {
		return fail(e);
	}
}

/** DELETE { confirmName } — the portfolio whole, with a copy of the journal made first (owner's request, 17.11.2026). */
export async function DELETE({ params, request }) {
	try {
		const app = getApp().sqlite;
		const b = await body(request);
		const r = deletePortfolio(app, Number(params.id), b.confirmName, (tag) => {
			mkdirSync(backupDir, { recursive: true });
			const file = join(backupDir, `app-${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
			app.prepare('VACUUM INTO ?').run(file);
			return file;
		});
		return json(r);
	} catch (e) {
		return fail(e);
	}
}
