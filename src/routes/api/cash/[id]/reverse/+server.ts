import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { reverseCash } from '#lib/server/portfolio.js';
import { fail } from '#lib/server/respond.js';

export function POST({ params }) {
	try {
		return json({ portfolioId: reverseCash(getApp().sqlite, Number(params.id)) });
	} catch (e) {
		return fail(e);
	}
}
