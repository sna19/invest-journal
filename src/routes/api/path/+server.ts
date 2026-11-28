import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { flagsFor, portfolioPath, readFlagParams, reviewFlag, securityPath, writeFlagParams } from '#lib/server/path.js';
import { FLAG_DEFAULTS } from '#lib/path.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * T-033 «Путь доходности»: GET ?security=<id>[&position=<id>] — the block of a card; ?portfolio=<id> — a portfolio's
 * path; ?flags=<id,id,…> — the marks of a list; ?settings — the marks' thresholds.
 */
export function GET({ url }) {
	const app = getApp().sqlite;
	const m = getMarket().sqlite;
	const q = url.searchParams;
	if (q.has('security')) {
		const v = securityPath(app, m, Number(q.get('security')), { ...(q.get('position') ? { positionId: Number(q.get('position')) } : {}), dividends: q.get('div') !== '0' });
		if (!v) error(404, 'no prices');
		return json(v);
	}
	if (q.has('portfolio')) {
		const v = portfolioPath(app, m, Number(q.get('portfolio')));
		return json(v ?? { empty: true });
	}
	if (q.has('flags')) return json({ items: flagsFor(app, m, (q.get('flags') ?? '').split(',').map(Number).filter((x) => x > 0)) });
	if (q.has('settings')) return json({ params: readFlagParams(app), defaults: FLAG_DEFAULTS });
	error(400, 'security, portfolio, flags or settings');
}

/** POST { review: <mark state id> } — «Пересмотрел»; { settings: { … } } — the thresholds */
export async function POST({ request }) {
	try {
		const b = (await body(request)) as { review?: unknown; settings?: Record<string, unknown> };
		if (b.review !== undefined) return json({ reviewed: reviewFlag(getApp().sqlite, Number(b.review)) });
		if (b.settings) return json({ params: writeFlagParams(getApp().sqlite, b.settings) });
		return json({ error: 'review or settings' }, { status: 400 });
	} catch (e) {
		return fail(e);
	}
}
