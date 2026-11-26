import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { yearResult } from '#lib/server/portfolioRisk.js';
import { israelDate } from '#lib/hypothesis.js';

/** T-016 (7): GET ?y=2026 — the realized result of the real portfolios for a calendar year (an estimate, not a tax calculation) */
export function GET({ url }) {
	const y = Number(url.searchParams.get('y')) || Number(israelDate().slice(0, 4));
	return json({ year: y, items: yearResult(getApp().sqlite, getMarket().sqlite, y) });
}
