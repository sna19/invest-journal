import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { getSetting, setSetting } from '#lib/server/risk.js';
import { cleanFilters } from '#lib/server/screener.js';
import { body } from '#lib/server/respond.js';

/** the owner's saved screens: GET — all; PUT { name, filters } — add or replace by name; DELETE ?name= */
const KEY = 'screener_saved';
type Saved = { name: string; filters: ReturnType<typeof cleanFilters> };
const read = (): Saved[] => {
	try {
		return JSON.parse(getSetting(getApp().sqlite, KEY) ?? '[]');
	} catch {
		return [];
	}
};
export function GET() {
	return json({ items: read() });
}
export async function PUT({ request }) {
	const b = await body(request);
	const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
	if (!name) return json({ errors: { name: 'Название' } }, { status: 400 });
	const items = [{ name, filters: cleanFilters(b.filters) }, ...read().filter((x) => x.name !== name)].slice(0, 30);
	setSetting(getApp().sqlite, KEY, JSON.stringify(items));
	return json({ items });
}
export function DELETE({ url }) {
	const items = read().filter((x) => x.name !== url.searchParams.get('name'));
	setSetting(getApp().sqlite, KEY, JSON.stringify(items));
	return json({ items });
}
