import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { historyOf } from '#lib/server/decisions.js';

/** Д-20: GET ?security=12 | ?hypothesis=7 — the timeline of hypotheses, entries and decisions */
export function GET({ url }) {
	const s = Number(url.searchParams.get('security')) || undefined;
	const h = Number(url.searchParams.get('hypothesis')) || undefined;
	return json(historyOf(getApp().sqlite, { securityId: s, hypothesisId: h }));
}
