import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { addEntry, listEntries, scopeOf } from '#lib/server/diary.js';
import { addSnapshot } from '#lib/server/snapshots.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * T-032 11а. GET ?scope=security:12&inherit=0&kind=&only=personal|decisions&tags=1,2&from=&to=&hyp=all|12&q=&archived=1&before=&limit=
 * — the entries of a place (or all), newest first, with a cursor. POST { kind, body, links: [{type, id, primary}], tags, parentId }.
 */
export function GET({ url }) {
	const p = url.searchParams;
	return json(
		listEntries(getApp().sqlite, getMarket().sqlite, {
			scope: scopeOf(p.get('scope')),
			inherit: p.get('inherit') !== '0',
			kind: p.get('kind'),
			only: p.get('only'),
			tags: (p.get('tags') ?? '').split(',').map(Number).filter((x) => x > 0),
			from: p.get('from'),
			to: p.get('to'),
			hyp: p.get('hyp'),
			q: p.get('q'),
			archived: p.get('archived') === '1',
			remind: p.get('remind') === '1',
			before: Number(p.get('before')) || null,
			limit: Number(p.get('limit')) || 30
		})
	);
}

export async function POST({ request }) {
	try {
		const app = getApp().sqlite;
		const b = await body(request);
		// T-032 11в: an entry with a snapshot (a chart, a comparison, the candidates, a portfolio, a photo) — both or none
		const id = app.transaction(() => {
			const e = addEntry(app, getMarket().sqlite, b);
			for (const s of Array.isArray(b.snapshots) ? b.snapshots.slice(0, 10) : []) addSnapshot(app, e!, s);
			return e;
		})();
		return json({ id }, { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
