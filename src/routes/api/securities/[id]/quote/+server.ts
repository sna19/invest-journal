import { error, json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { israelDate } from '#lib/hypothesis.js';
import { marketView, security } from '#lib/server/portfolio.js';

/** GET ?date= — what the «Купил / Продал» form starts from: the last known close and the dollar rate. */
export function GET({ params, url }) {
	const m = getMarket().sqlite;
	const s = security(m, Number(params.id));
	if (!s) error(404, 'нет такой бумаги');
	const date = url.searchParams.get('date') || israelDate();
	const v = marketView(m);
	const day = v.day(s.id, date);
	return json({
		securityId: s.id,
		symbol: s.symbol,
		name: s.name_en,
		currency: s.price_unit === 'USD' ? 'USD' : 'ILS',
		priceUnit: s.price_unit,
		close: day?.close ?? null,
		date: day?.date ?? null,
		fxUsd: v.fx('USD', date)
	});
}
