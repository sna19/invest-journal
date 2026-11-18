import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { israelDate } from '#lib/hypothesis.js';
import { body } from '#lib/server/respond.js';

/**
 * POST { date, close } — a price by hand for a security the provider has no price for (section 18: «ручная цена
 * от даты»). Kept with provider «manual»; a price from the provider for the same day replaces it.
 */
export async function POST({ params, request }) {
	const b = await body(request);
	const id = Number(params.id);
	const date = String(b.date || israelDate());
	const close = Number(String(b.close ?? '').replace(',', '.'));
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > israelDate()) return json({ message: 'Дата не позже сегодняшней' }, { status: 400 });
	if (!(close > 0)) return json({ message: 'Цена больше нуля' }, { status: 400 });
	const m = getMarket().sqlite;
	if (!m.prepare('select 1 from ref_securities where id = ?').get(id)) return json({ message: 'Нет такой бумаги' }, { status: 404 });
	m.prepare(
		`insert into market_prices_daily (security_id, date, close, provider_code) values (?, ?, ?, 'manual')
		 on conflict (security_id, date) do update set close = excluded.close, provider_code = 'manual', low = null, high = null, open = null`
	).run(id, date, close);
	return json({ ok: true });
}
