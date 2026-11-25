import { describe, expect, it } from 'vitest';
import { openMarket } from '../db.js';
import { adjustRows, splitScale } from './splits.js';
import { parseMonthly } from './monthly.js';

/** EMBJ, 16.11.2026: a 4:1 split; Yahoo gave the closes before it unadjusted */
function market(adjusted: boolean) {
	const m = openMarket(':memory:').sqlite;
	const id = (m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search, active) values ('NYSE', 'stock', 'EMBJ', 'Embraer', 'USD', 'USD', 'embj', 1) returning id`).get() as { id: number }).id;
	const px = m.prepare(`insert into market_prices_daily (security_id, date, close, provider_code) values (?, ?, ?, 'test')`);
	for (const [d, c] of [['2026-11-12', 79.48], ['2026-11-13', 78.73], ['2026-11-17', 18.9], ['2026-11-18', 18.68]] as const) px.run(id, d, adjusted && d < '2026-11-16' ? c / 4 : c);
	m.prepare(`insert into market_corporate_actions (security_id, ex_date, kind, ratio, provider_code) values (?, '2026-11-16', 'split', 4, 'test')`).run(id);
	return { m, id };
}

describe('a split the history was not adjusted for (EMBJ, 25.11.2026)', () => {
	it('brings the closes before it into the new scale; an adjusted history is left alone', () => {
		const a = market(false);
		const rows = adjustRows(a.m, a.id, a.m.prepare('select date, close from market_prices_daily where security_id = ? order by date').all(a.id) as { date: string; close: number }[]);
		expect(rows.map((r) => Math.round(r.close * 100) / 100)).toEqual([19.87, 19.68, 18.9, 18.68]);
		const b = market(true);
		expect(splitScale(b.m, b.id)('2026-11-12')).toBe(1);
	});

	it('the monthly bars of Yahoo with a split and the months before it unadjusted', () => {
		const ts = (m: string) => Date.parse(`${m}-01T05:00:00Z`) / 1000;
		const months = ['2026-08', '2026-09', '2026-10', '2026-11'];
		const close = [76, 80, 78, 18.5];
		const body = JSON.stringify({
			chart: {
				result: [
					{
						meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York' },
						timestamp: months.map(ts),
						events: { splits: { x: { date: Date.parse('2026-11-16T14:30:00Z') / 1000, numerator: 4, denominator: 1 } } },
						indicators: { quote: [{ close, volume: [1, 1, 1, 1] }], adjclose: [{ adjclose: close }] }
					}
				]
			}
		});
		const { rows } = parseMonthly(body, new Date('2026-12-05T12:00:00Z'));
		expect(rows.map((r) => r.close)).toEqual([19, 20, 19.5, 18.5]);
		expect(rows.map((r) => r.adjClose)).toEqual([19, 20, 19.5, 18.5]);
		// already adjusted months stay
		const adj = JSON.parse(body);
		adj.chart.result[0].indicators.quote[0].close = [19, 20, 19.5, 18.5];
		adj.chart.result[0].indicators.adjclose[0].adjclose = [19, 20, 19.5, 18.5];
		expect(parseMonthly(JSON.stringify(adj), new Date('2026-12-05T12:00:00Z')).rows.map((r) => r.close)).toEqual([19, 20, 19.5, 18.5]);
	});
});
