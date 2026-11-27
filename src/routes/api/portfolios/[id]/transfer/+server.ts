import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { queueSecurities } from '#lib/server/jobs.js';
import { makeFetcher } from '#lib/server/market/http.js';
import { applyTransfer, previewTransfer } from '#lib/server/transfer.js';
import { body, fail } from '#lib/server/respond.js';

/**
 * POST { text, apply } — «Перенос позиций» (section 18): without `apply` a preview (nothing written; the securities
 * found are queued for prices so that a repeated preview finds their closes); with `apply` the openings, money and tax.
 */
export async function POST({ params, request }) {
	try {
		const b = await body(request);
		const id = Number(params.id);
		const text = String(b.text ?? '');
		const get = makeFetcher({ retries: 1 });
		const app = getApp().sqlite;
		const market = getMarket().sqlite;
		if (b.apply) {
			const r = await applyTransfer(app, market, id, text, { get });
			queueSecurities(r.securities);
			return json(r);
		}
		const p = await previewTransfer(app, market, id, text, { get });
		queueSecurities(p.securities);
		return json(p);
	} catch (e) {
		if (e instanceof Error && e.message === 'Портфеля нет') return json({ message: e.message }, { status: 404 });
		return fail(e);
	}
}
