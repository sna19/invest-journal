import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { createPortfolio, listPortfolios } from '#lib/server/portfolio.js';
import { body, fail } from '#lib/server/respond.js';

/** GET — the portfolios (?all=1 with archived ones); POST { name, kind } — a new one (section 18). */
export function GET({ url }) {
	return json({ items: listPortfolios(getApp().sqlite, url.searchParams.get('all') === '1') });
}

export async function POST({ request }) {
	try {
		return json(createPortfolio(getApp().sqlite, await body(request)), { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
