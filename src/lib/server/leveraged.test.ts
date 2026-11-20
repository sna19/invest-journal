import { describe, expect, it } from 'vitest';
import { openMarket } from './db.js';
import { leveragedFor, parseLeverage } from './leveraged.js';

describe('leveraged and inverse ETFs (20.11.2026)', () => {
	it('reads the direction and the multiple from the fund\'s name', () => {
		expect(parseLeverage('GraniteShares 2x Long NVDA Daily ETF')).toEqual({ dir: 'long', x: 2 });
		expect(parseLeverage('Direxion Daily NVDA Bear 1X ETF')).toEqual({ dir: 'short', x: 1 });
		expect(parseLeverage('Tradr 1.5X Short NVDA Daily ETF')).toEqual({ dir: 'short', x: 1.5 });
		expect(parseLeverage('ProShares UltraShort Semiconductors')).toEqual({ dir: 'short', x: 2 });
		expect(parseLeverage('ProShares Ultra Semiconductors')).toEqual({ dir: 'long', x: 2 });
		expect(parseLeverage('ProShares UltraPro QQQ')).toEqual({ dir: 'long', x: 3 });
		expect(parseLeverage('ProShares Short S&P500')).toEqual({ dir: 'short', x: 1 });
		expect(parseLeverage('MicroSectors Gold -3X Inverse Leveraged ETNs')).toEqual({ dir: 'short', x: 3 });
		expect(parseLeverage('GraniteShares YieldBOOST 2x NVDA')).toBeNull();
		expect(parseLeverage('iShares Core S&P 500 ETF')).toBeNull();
	});

	it('finds the funds on the share by its symbol or company name, then its sector and indices', () => {
		const m = openMarket(':memory:').sqlite;
		const add = m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search, active) values (?, ?, ?, ?, 'USD', 'USD', ?, 1) returning id`);
		const id = (add.get('NASDAQ', 'stock', 'NVDA', 'NVIDIA Corporation', 'nvda') as { id: number }).id;
		add.get('NASDAQ', 'stock', 'NVDS2', 'Other Corp', 'x');
		add.get('NASDAQ', 'etf', 'NVDL', 'GraniteShares 2x Long NVDA Daily ETF', 'nvdl');
		add.get('NASDAQ', 'etf', 'NVDQ', 'T-Rex 2X Inverse NVIDIA Daily Target ETF', 'nvdq');
		add.get('NASDAQ', 'etf', 'AMDL', 'GraniteShares 2x Long AMD Daily ETF', 'amdl');
		add.get('NASDAQ', 'etf', 'NVDY', 'YieldMax NVDA Option Income Strategy ETF', 'nvdy');
		add.get('NASDAQ', 'etf', 'TQQQ', 'ProShares UltraPro QQQ', 'tqqq');
		add.get('NYSE_ARCA', 'etf', 'TECS', 'Direxion Daily Technology Bear 3X Shares', 'tecs');
		m.prepare(`insert into ref_security_profiles (security_id, kind, sector, industry, fetched_at) values (?, 'stock', 'technology', 'Semiconductors', '2026-11-20')`).run(id);
		const l = leveragedFor(m, id);
		expect(l.map((x) => [x.symbol, x.dir, x.x, x.level])).toEqual([
			['NVDL', 'long', 2, 'stock'],
			['NVDQ', 'short', 2, 'stock'],
			['TECS', 'short', 3, 'sector'],
			['TQQQ', 'long', 3, 'index']
		]);
	});
});

describe('a fund\'s fee in its profile', () => {
	it('is read from fundProfile.feesExpensesInvestment', async () => {
		const { parseProfile } = await import('./market/profiles.js');
		const body = JSON.stringify({
			quoteSummary: { result: [{ quoteType: { quoteType: 'ETF' }, fundProfile: { categoryName: 'Trading--Leveraged Equity', feesExpensesInvestment: { annualReportExpenseRatio: { raw: 0.0105, fmt: '1.05%' }, netExpRatio: {} } } }] }
		});
		expect(parseProfile(body)).toMatchObject({ kind: 'etf', expenseRatio: 0.0105 });
		expect(parseProfile(JSON.stringify({ quoteSummary: { result: [{ quoteType: { quoteType: 'ETF' }, fundProfile: {} }] } })).expenseRatio).toBeNull();
	});
});
