import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { addEvent } from '#lib/server/portfolio.js';
import { decideBuy, decideSell, openBuy, OUTCOMES, syncDecisions, type DecisionInput } from '#lib/server/decisions.js';
import { queueSecurity, runProfilesJob } from '#lib/server/jobs.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * POST { securityId | positionId, kind, date, qty, price, fee, amount, note, hypothesisId, confirm } — an event of a
 * position; the first one for a security opens the position. 409 { confirm: true } — a price to look at again.
 */
export async function POST({ params, request }) {
	try {
		const app = getApp().sqlite;
		const input = { ...(await body(request)), portfolioId: Number(params.id) };
		// Д-18: a sale from the form answers its purchase — «Сбылось?» is asked when there is one
		const pre = input as { kind?: unknown; discipline?: unknown; positionId?: unknown; decision?: DecisionInput };
		if (pre.discipline === true && pre.kind === 'sell' && pre.positionId && openBuy(app, Number(pre.positionId)) && !(OUTCOMES as readonly string[]).includes(String(pre.decision?.outcome)))
			return json({ message: 'Сбылось ли то, ради чего покупал?', errors: { outcome: 'Сбылось? — да, частично, нет или рано судить' } }, { status: 400 });
		// one transaction: a refused event leaves no empty position behind
		const r = app.transaction(() => addEvent(app, getMarket().sqlite, input))();
		// T-032: a purchase or a sale from the form is a decision with its thesis entry (11б); notes go to the diary
		const inp = input as { kind?: unknown; discipline?: unknown; decision?: DecisionInput };
		if (inp.discipline === true && inp.kind === 'buy') decideBuy(app, getMarket().sqlite, r.eventId, inp.decision ?? {});
		if (inp.discipline === true && inp.kind === 'sell') decideSell(app, getMarket().sqlite, r.eventId, inp.decision ?? {});
		syncDecisions(app, getMarket().sqlite);
		// section 14 ring 1: a security that came into a portfolio gets its price history
		const sid = (input as { securityId?: unknown }).securityId;
		if (sid) queueSecurity(Number(sid));
		// and its profile (sector, industry, …) for the allocation block
		if (sid) void runProfilesJob().catch((e) => console.error(`profiles: ${e}`));
		return json(r, { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
