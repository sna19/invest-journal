import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from '../db.js';
import { DEFAULTS, monthIndex, quarterReturn, runModel, type Series, type Universe } from './quarterly.js';
import { commodityUniverse, isLevered, readFunds, writeFunds } from './commodities.js';
import { keyOf, poolOfKey, readParams, writeParams } from './service.js';

const START = monthIndex('2012-12');
const LAST = monthIndex('2026-10');

/** a fund that rises `q1` % a month in the first quarter and is flat otherwise */
function fund(id: number, symbol: string, q1: number, from = START): Series {
	const n = LAST - from + 1;
	const adj = new Float64Array(n);
	let p = 50;
	for (let j = 0; j < n; j++) {
		const i = from + j;
		if (j > 0 && (i % 12) + 1 <= 3) p *= 1 + q1 / 100;
		adj[j] = p;
	}
	return { id, symbol, name: symbol, market: 'US', exchange: 'NYSE_ARCA', capUsd: null, shares: null, sector: null, unit: 'USD', start: from, adj, close: adj.slice(), volume: new Float64Array(n).fill(1e6) };
}

describe('T-031: commodities in the quarterly model', () => {
	const funds = new Map(
		[fund(1, 'GLD', 2), fund(2, 'IAU', 2), fund(3, 'SLV', 1.5), fund(4, 'UNG', 3), fund(5, 'USO', 2.5), fund(6, 'DBA', 0), fund(7, 'DBC', 0), fund(8, 'DGP', 4), fund(9, 'CANE', 3, monthIndex('2019-01'))].map((s) => [s.symbol, s])
	);
	const base: Universe = { stocks: [], funds, bench: { US: null, IL: null }, lastMonth: LAST, usdIls: 3.7, builtAt: '' };
	const market = openMarket(':memory:').sqlite;
	const list = [
		{ symbol: 'GLD', group: 'precious' as const, twin: 'gold' },
		{ symbol: 'IAU', group: 'precious' as const, twin: 'gold' },
		{ symbol: 'SLV', group: 'precious' as const },
		{ symbol: 'UNG', group: 'energy' as const },
		{ symbol: 'USO', group: 'energy' as const },
		{ symbol: 'DBA', group: 'agriculture' as const },
		{ symbol: 'DGP', group: 'precious' as const },
		{ symbol: 'CANE', group: 'agriculture' as const },
		{ symbol: 'XXX', group: 'broad' as const }
	];

	it('the universe: the group is the sector, leverage and a short history out, DBC the market', () => {
		const { u, rows } = commodityUniverse(base, market, list, 'DBC', 10);
		expect(u.stocks.map((s) => s.symbol)).toEqual(['GLD', 'IAU', 'SLV', 'UNG', 'USO', 'DBA']);
		expect(u.stocks.find((s) => s.symbol === 'UNG')!.sector).toBe('energy');
		expect(u.bench.US?.symbol).toBe('DBC');
		expect(Object.fromEntries(rows.map((r) => [r.symbol, r.excluded]))).toMatchObject({ DGP: 'levered', CANE: 'short', XXX: 'unknown', GLD: null });
		expect(isLevered('UGL')).toBe(true);
		expect(isLevered('ABC', 'ProShares Ultra Silver')).toBe(true);
	});

	it('variant A in Q1: by hand, one of GLD and IAU, at most 2 per group', () => {
		const { u } = commodityUniverse(base, market, list, 'DBC', 10);
		const r = runModel(u, 'A', 1, { ...DEFAULTS, count: 3, k: 9, perSector: 2, minPriceUsd: 0, minTurnoverUsd: 0 });
		// Q1 of UNG: +3% a month → 1.03³ − 1 = 9.27%; GLD 2% → 6.12%
		expect(quarterReturn(u.stocks.find((s) => s.symbol === 'UNG')!, 2026, 1)).toBeCloseTo(1.03 ** 3 - 1, 10);
		expect(r.candidates.map((c) => c.symbol)).toEqual(['UNG', 'USO', 'GLD']);
		expect(r.candidates[0].mean).toBeCloseTo((1.03 ** 3 - 1) * 100, 1);
		// a pick of 5: the twin IAU is still left out
		const r5 = runModel(u, 'A', 1, { ...DEFAULTS, count: 5, k: 9, perSector: 3, minPriceUsd: 0, minTurnoverUsd: 0 });
		expect(r5.candidates.map((c) => c.symbol)).toEqual(['UNG', 'USO', 'GLD', 'SLV']);
	});

	it('their own parameters and list (cA, cB), apart from the shares', () => {
		const app = openApp(':memory:').sqlite;
		expect(readParams(app, 'A', 'commodities').count).toBe(3);
		writeParams(app, 'A', { count: 4, capGroups: ['mega'], compareWith: 'sector' }, 'commodities');
		expect(readParams(app, 'A', 'commodities')).toMatchObject({ count: 4, capGroups: [], compareWith: 'market' });
		expect(readParams(app, 'A').count).toBe(10);
		expect(keyOf('B', 'commodities')).toBe('cB');
		expect(poolOfKey('cB')).toEqual({ variant: 'B', pool: 'commodities' });
		writeFunds(app, { funds: [{ symbol: 'gld', group: 'precious' }, { symbol: 'gld', group: 'energy' }, { symbol: '??', group: 'x' }], bench: 'gsg' });
		expect(readFunds(app)).toEqual({ funds: [{ symbol: 'GLD', group: 'precious', twin: undefined }], bench: 'GSG' });
	});
});
