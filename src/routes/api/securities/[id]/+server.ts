import { error, json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { makeFetcher } from '#lib/server/market/http.js';
import { securitiesForPrices } from '#lib/server/market/prices.js';
import { chartUrl } from '#lib/server/market/yahoo.js';
import { israelDate } from '#lib/hypothesis.js';

/**
 * GET /api/securities/<id> — whether the price provider knows the security (spec section 14 question:
 * «нет цен» — the form warns when it is chosen). Unknown yet → one short request to find out.
 */
export async function GET({ params }) {
	const m = getMarket().sqlite;
	const id = Number(params.id);
	const row = m.prepare('select id, symbol, price_status as priceStatus from ref_securities where id = ?').get(id) as
		| { id: number; symbol: string; priceStatus: string | null }
		| undefined;
	if (!row) error(404, 'нет такой бумаги');
	if (row.priceStatus === null) {
		const sec = securitiesForPrices(m, [id])[0];
		if (sec) {
			const to = israelDate();
			const from = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
			try {
				const b = await makeFetcher({ retries: 1 })(chartUrl(sec.yahoo, from, to));
				const ok = !!JSON.parse(b.toString()).chart?.result?.[0]?.timestamp?.length;
				row.priceStatus = ok ? 'ok' : 'none';
			} catch (e) {
				if (String((e as Error).message).startsWith('404')) row.priceStatus = 'none';
			}
			if (row.priceStatus) m.prepare('update ref_securities set price_status = ? where id = ?').run(row.priceStatus, id);
		}
	}
	return json(row);
}
