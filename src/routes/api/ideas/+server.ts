import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { dayList, findIdeas, keepPosition, lastIdeas, markIdea, readSignalSettings, runIdeas, SDEFAULTS, writeSignalSettings } from '#lib/server/ideas.js';
import { body, fail } from '#lib/server/respond.js';

/** T-035 «Сигналы»: GET — the week's ideas and the day's list (sell, review, place at the broker) with the settings */
export function GET({ url }) {
	const app = getApp().sqlite;
	const m = getMarket().sqlite;
	// ?preview=1 — the funnel as it would choose now (the settings' screen shows its counts)
	if (url.searchParams.get('preview') === '1') {
		const r = findIdeas(app, m);
		return json({ funnel: r.funnel, ideas: r.ideas.map((i) => ({ id: i.s.id, rank: i.rank, total: i.s.total, reasons: i.reasons })) });
	}
	return json({ ...lastIdeas(app), day: dayList(app, m), settings: readSignalSettings(app), defaults: SDEFAULTS });
}

/**
 * POST { action: 'mark', id, status: bought | wanted | skipped, reason } — what was done with an idea;
 * { action: 'keep', key, reason } — «Держу — потому что…»; { action: 'settings', … }; { action: 'run' } — the week's
 * run now (once a week; the earlier run stays).
 */
export async function POST({ request }) {
	try {
		const b = await body(request);
		const app = getApp().sqlite;
		const m = getMarket().sqlite;
		if (b.action === 'mark') return json({ status: markIdea(app, m, Number(b.id), b.status, b.reason) });
		if (b.action === 'keep') return json({ until: keepPosition(app, m, b.key, b.reason) });
		if (b.action === 'settings') return json({ settings: writeSignalSettings(app, b) });
		if (b.action === 'run') return json(runIdeas(getApp().db, app, m));
		return json({ error: 'action' }, { status: 400 });
	} catch (e) {
		return fail(e);
	}
}
