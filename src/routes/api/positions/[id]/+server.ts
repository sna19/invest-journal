import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { positionView } from '#lib/server/portfolio.js';

/** GET — a position: its events top to bottom, the numbers, the linked hypotheses (idea → purchase). */
export function GET({ params }) {
	const v = positionView(getApp().sqlite, getMarket().sqlite, Number(params.id));
	if (!v) error(404, 'нет такой позиции');
	return json(v);
}
