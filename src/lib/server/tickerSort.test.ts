import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { sortHits } from './tickerSort.js';
import type { SecurityHit } from './market/search.js';

// fictional shares only
describe('owner 28.11.2026: the tickers list sorted by a key, down or up, empties last', () => {
	const m = openMarket(':memory:').sqlite;
	const hit = (id: number, symbol: string, capUsd: number | null): SecurityHit => ({ id, symbol, nameEn: symbol, nameHe: null, exchangeCode: 'NASDAQ', exchangeName: 'NASDAQ', type: 'stock', currency: 'USD', priceUnit: 'USD', active: true, sector: null, capUsd });
	const put = m.prepare(`insert into ref_security_stats (security_id, data, fetched_at) values (?, ?, '2026-11-28')`);
	put.run(1, JSON.stringify({ pe: 30, dividendYield: 0.01 }));
	put.run(2, JSON.stringify({ pe: 12, dividendYield: 0.04 }));
	put.run(3, JSON.stringify({ pe: -5 }));
	const hits = [hit(1, 'AAA', 300), hit(2, 'BBB', null), hit(3, 'CCC', 100), hit(4, 'DDD', 200)];
	it('P/E up: the cheapest first, a loss (negative P/E) and no data last', () => {
		expect(sortHits(m, hits, 'pe', false).map((h) => [h.symbol, h.sortValue])).toEqual([
			['BBB', 12],
			['AAA', 30],
			['CCC', null],
			['DDD', null]
		]);
	});
	it('P/E down; dividends down (no payments or monthly prices — the provider\'s yield); market cap up', () => {
		expect(sortHits(m, hits, 'pe', true).map((h) => h.symbol).slice(0, 2)).toEqual(['AAA', 'BBB']);
		expect(sortHits(m, hits, 'div', true).map((h) => h.symbol).slice(0, 2)).toEqual(['BBB', 'AAA']);
		expect(sortHits(m, hits, 'cap', false).map((h) => h.symbol)).toEqual(['CCC', 'DDD', 'AAA', 'BBB']);
	});
});
