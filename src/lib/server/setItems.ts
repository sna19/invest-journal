import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { marketView } from './portfolio.js';
import { readProfiles } from './market/profiles.js';

/**
 * What a glance at a set of securities needs (the picked ones, a saved set): price, the day, 1M / 3M / 1Y, sector,
 * market cap. `missing` — the ones without prices yet (the caller queues their history).
 */
export function setItems(market: Database.Database, rows: { id: number; origin?: string | null; addedAt?: string | null }[]) {
	const m = marketView(market);
	const today = israelDate();
	const prof = readProfiles(market, rows.map((r) => r.id), m.usd(today));
	const sec = market.prepare('select id, symbol, name_en as name, exchange_code as exchange, price_unit as unit from ref_securities where id = ?');
	const at = market.prepare('select date, close from market_prices_daily where security_id = ? and date <= ? order by date desc limit 1');
	const back = (d: number) => new Date(Date.parse(today + 'T12:00:00Z') - d * 86_400_000).toISOString().slice(0, 10);
	const missing: number[] = [];
	const items = rows.map((r) => {
		const s = sec.get(r.id) as { id: number; symbol: string; name: string; exchange: string; unit: string } | undefined;
		const last = at.get(r.id, today) as { date: string; close: number } | undefined;
		if (!last) missing.push(r.id);
		const ret = (d: number) => {
			const x = at.get(r.id, back(d)) as { date: string; close: number } | undefined;
			return last && x && x.close > 0 ? Math.round((last.close / x.close - 1) * 10000) / 100 : null;
		};
		const mv = m.dayMove(r.id);
		const p = prof.get(r.id);
		return {
			id: r.id,
			origin: r.origin ?? null,
			addedAt: r.addedAt ?? null,
			symbol: s?.symbol ?? '?',
			name: s?.name ?? '',
			exchange: s?.exchange ?? '',
			unit: s?.unit ?? 'USD',
			price: mv?.now ?? last?.close ?? null,
			dayPct: mv && mv.prev > 0 ? Math.round((mv.now / mv.prev - 1) * 10000) / 100 : null,
			m1: ret(30),
			m3: ret(91),
			y1: ret(365),
			sector: p?.sector ?? null,
			capUsd: p?.capUsd ?? null
		};
	});
	return { items, missing };
}
