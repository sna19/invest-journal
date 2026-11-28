import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { cleanFilters, screen } from './screener.js';

// fictional shares only
describe('owner 28.11.2026: the screener', () => {
	const m = openMarket(':memory:').sqlite;
	const sec = m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', ?, ?, 'USD', 'USD', ?) returning id`);
	const prof = m.prepare(`insert into ref_security_profiles (security_id, kind, sector, industry, market_cap, cap_currency, fetched_at) values (?, 'stock', ?, ?, ?, 'USD', '2026-11-28')`);
	const st = m.prepare(`insert into ref_security_stats (security_id, data, fetched_at) values (?, ?, '2026-11-28')`);
	const add = (sym: string, sector: string, cap: number, data: object) => {
		const id = (sec.get(sym, sym, sym.toLowerCase()) as { id: number }).id;
		prof.run(id, sector, 'X', cap);
		st.run(id, JSON.stringify(data));
	};
	add('BIG', 'technology', 5e11, { pe: 30, dividendYield: 0.005, roe: 0.4 });
	add('MID', 'technology', 5e9, { pe: 12, dividendYield: 0.03, roe: 0.18 });
	add('DIV', 'utilities', 2e10, { pe: 16, dividendYield: 0.05, roe: 0.09 });
	add('LOSS', 'technology', 1e9, { pe: -4 });
	it('ranges, size classes, sector; sorted by a column; a loss is not «cheap»', () => {
		const cheap = screen(m, cleanFilters({ pe: { max: 20 } }), { by: 'pe', desc: false });
		expect(cheap.items.map((r) => r.symbol)).toEqual(['MID', 'DIV']);
		expect(screen(m, cleanFilters({ div: { min: 3 } }), { by: 'div', desc: true }).items.map((r) => r.symbol)).toEqual(['DIV', 'MID']);
		expect(screen(m, cleanFilters({ caps: ['mega'] })).items.map((r) => r.symbol)).toEqual(['BIG']);
		expect(screen(m, cleanFilters({ sector: 'technology', roe: { min: 15 } }), { by: 'roe', desc: true }).items.map((r) => r.symbol)).toEqual(['BIG', 'MID']);
		expect(screen(m, cleanFilters({})).total).toBe(4);
	});
	it('the form keeps only what it may', () => {
		expect(cleanFilters({ market: 'XX', sector: 'DROP TABLE', colors: ['green', 'blue'], pe: { min: '', max: '15' } })).toMatchObject({ market: null, sector: null, colors: ['green'], pe: { min: null, max: 15 } });
	});
});
