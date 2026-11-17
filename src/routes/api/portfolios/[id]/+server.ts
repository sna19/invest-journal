import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { portfolioCash, portfolioView, updatePortfolio } from '#lib/server/portfolio.js';
import { body, fail } from '#lib/server/respond.js';

/** GET — value, return against the benchmarks, positions by stage, the money; PATCH { name, archived, autoAmountIls }. */
export function GET({ params }) {
	const id = Number(params.id);
	const v = portfolioView(getApp().sqlite, getMarket().sqlite, id);
	if (!v) error(404, 'нет такого портфеля');
	return json({ ...v, cash: portfolioCash(getApp().sqlite, id) });
}

export async function PATCH({ params, request }) {
	try {
		return json(updatePortfolio(getApp().sqlite, Number(params.id), await body(request)));
	} catch (e) {
		return fail(e);
	}
}
