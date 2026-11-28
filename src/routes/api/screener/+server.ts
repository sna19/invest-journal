import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { COLUMNS, cleanFilters, screen, type Column } from '#lib/server/screener.js';

/** GET ?f=<json filters>&sort=<column>&dir=desc|asc&offset=0 — the screener (owner 28.11.2026) */
export function GET({ url }) {
	let f: unknown = {};
	try {
		f = JSON.parse(url.searchParams.get('f') ?? '{}');
	} catch {
		f = {};
	}
	const by = (COLUMNS.find((c) => c === url.searchParams.get('sort')) ?? 'cap') as Column;
	const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
	return json(screen(getMarket().sqlite, cleanFilters(f), { by, desc: url.searchParams.get('dir') !== 'asc' }, { offset, limit: 50 }));
}
