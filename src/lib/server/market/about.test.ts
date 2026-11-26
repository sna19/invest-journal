import { describe, expect, it } from 'vitest';
import { openMarket } from '../db.js';
import { aboutOf, parseAbout } from './about.js';

const BODY = JSON.stringify({
	quoteSummary: {
		result: [{ assetProfile: { longBusinessSummary: 'Applied Materials provides equipment to the semiconductor industry.', website: 'https://www.appliedmaterials.com', fullTimeEmployees: 41500, city: 'Santa Clara', country: 'United States' }, price: {} }]
	}
});

describe('«О компании»', () => {
	it('reads the summary, the site, the staff and the seat; a fund\'s family', () => {
		expect(parseAbout(BODY)).toEqual({ summary: 'Applied Materials provides equipment to the semiconductor industry.', website: 'https://www.appliedmaterials.com', employees: 41500, city: 'Santa Clara', country: 'United States', fundFamily: null });
		expect(parseAbout(JSON.stringify({ quoteSummary: { result: [{ assetProfile: { longBusinessSummary: 'The fund invests…', website: 'javascript:x' }, fundProfile: { family: 'iShares' } }] } }))).toMatchObject({ website: null, fundFamily: 'iShares' });
	});

	it('asks the provider once, translates once, keeps both; a fresh one is not asked again', async () => {
		const market = openMarket(':memory:').sqlite;
		const id = (market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'AMAT', 'Applied Materials', 'USD', 'USD', 'amat') returning id`).get() as { id: number }).id;
		market.prepare(`insert into ref_provider_symbols (security_id, provider_code, provider_symbol) values (?, 'yahoo', 'AMAT')`).run(id);
		let asked = 0;
		let translated = 0;
		const get = async (url: string) => {
			if (url.includes('fc.yahoo')) return { status: 200, body: '', cookies: ['A=1; path=/'] };
			if (url.includes('getcrumb')) return { status: 200, body: 'crumb', cookies: [] };
			asked++;
			return { status: 200, body: BODY, cookies: [] };
		};
		const translate = async (t: string) => (translated++, t.replace('provides equipment to the semiconductor industry', 'поставляет оборудование для полупроводниковой промышленности'));
		const a = await aboutOf(market, id, { get, translate });
		expect(a).toMatchObject({ summaryRu: 'Applied Materials поставляет оборудование для полупроводниковой промышленности.', employees: 41500 });
		await aboutOf(market, id, { get, translate });
		expect([asked, translated]).toEqual([1, 1]);
		// 91 days later it is asked again; the same text keeps its translation
		await aboutOf(market, id, { get, translate, now: new Date(Date.now() + 91 * 86_400_000) });
		expect([asked, translated]).toEqual([2, 1]);
	});
});
