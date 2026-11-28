import { describe, expect, it } from 'vitest';
import { allocate, type AllocPosition } from './allocation.js';

const t = (ru: string) => ru;
// fictional positions only
const stock = (symbol: string, valuePc: number, sector: string, country: string): AllocPosition => ({ symbol, securityId: symbol.length, valuePc, currency: 'USD', unrealizedPc: 0, profile: { type: 'stock', kind: 'stock', sector, industry: 'X', country, capUsd: 5e10, fundCategory: null, sectorWeights: null } });
const fund: AllocPosition = { symbol: 'FND', valuePc: 1000, currency: 'USD', unrealizedPc: 0, profile: { type: 'etf', kind: 'etf', sector: null, industry: null, country: null, capUsd: null, fundCategory: null, sectorWeights: { technology: 0.6, energy: 0.4 }, countryWeights: { Spain: 1 } } };

describe('owner 28.11.2026: who is in a slice; stocks only or funds only; regions', () => {
	const ps = [stock('AAA', 500, 'technology', 'United States'), stock('BBB', 300, 'energy', 'Israel'), fund];
	it('a slice lists its securities, a fund with the part of it there', () => {
		const tech = allocate('sector', ps, 200, t).rows.find((r) => r.key === 'technology')!;
		expect(tech.members.map((m) => [m.symbol, Math.round(m.value), Math.round(m.part * 100)])).toEqual([
			['FND', 600, 60],
			['AAA', 500, 100]
		]);
	});
	it('stocks only: no fund and no cash, percents of the stocks', () => {
		const a = allocate('sector', ps, 200, t, 'stock');
		expect(a.total).toBe(800);
		expect(a.rows.map((r) => [r.key, Math.round(r.pct)])).toEqual([
			['technology', 63],
			['energy', 38]
		]);
	});
	it('regions: a Spain fund is Europe, the US — North America, Israel its own', () => {
		const r = allocate('region', ps, 0, t).rows.map((x) => [x.key, x.value]);
		expect(r).toEqual(expect.arrayContaining([['r:eu', 1000], ['r:na', 500], ['r:il', 300]]));
	});
});
