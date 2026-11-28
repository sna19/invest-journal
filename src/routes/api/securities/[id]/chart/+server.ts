import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { PERIODS, securityChart, type Period } from '#lib/server/charts.js';
import { queueProfiles, queueSecurity } from '#lib/server/jobs.js';
import { staleProfiles } from '#lib/server/market/profiles.js';

/** GET ?period=1M|3M|6M|1Y|5Y|10Y — the security card's chart (section 19): price, benchmark, marks. */
export function GET({ params, url }) {
	const p = url.searchParams.get('period') ?? '1Y';
	const period = (p in PERIODS ? p : '1Y') as Period;
	const c = securityChart(getApp().sqlite, getMarket().sqlite, Number(params.id), period);
	if (!c) error(404, 'нет такой бумаги');
	// T-020: no daily history yet (a model's candidate) — load it now; the card shows monthly closes meanwhile
	if (c.monthly) queueSecurity(Number(params.id));
	// owner 28.11.2026: a fund's fee on its card — its profile loaded when not yet (or stale)
	if (c.security.type === 'etf' && staleProfiles(getMarket().sqlite, [c.security.id]).length) queueProfiles([c.security.id]);
	return json(c);
}
