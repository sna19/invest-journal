import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { cleanParams, nextQuarter, securityResult, universe, type Variant } from '#lib/server/model/quarterly.js';
import { readParams, VARIANTS } from '#lib/server/model/service.js';

/** GET ?variant=A&quarter=1[&k=…] — the model block of a security's card (T-020): the saved parameters, or the preview's */
export function GET({ params, url }) {
	const v = (url.searchParams.get('variant') ?? 'A') as Variant;
	if (!VARIANTS.includes(v)) error(400, 'variant A | B | C | D | G');
	const q = Number(url.searchParams.get('quarter') ?? nextQuarter().quarter);
	if (![1, 2, 3, 4].includes(q)) error(400, 'quarter 1–4');
	const app = getApp().sqlite;
	const saved = readParams(app, v);
	// the preview's parameters when the card is opened from the model screen
	const over = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== 'variant' && k !== 'quarter'));
	const p = cleanParams(over, saved);
	const r = securityResult(universe(getMarket().sqlite), Number(params.id), v, q, p);
	if (!r) error(404, 'нет месячных цен этой бумаги');
	const version = app.prepare('select id from model_versions where variant = ? and params = ?').get(v, JSON.stringify(saved)) as { id: number } | undefined;
	return json({ ...r, versionId: version?.id ?? null, preview: JSON.stringify(p) !== JSON.stringify(saved) });
}
