import { describe, expect, it } from 'vitest';
import { allocate, type AllocPosition } from './allocation.js';

const t = (_ru: string, en: string) => en;
const pos = (symbol: string, valuePc: number, profile: AllocPosition['profile'], currency = 'USD', unrealizedPc = 0): AllocPosition => ({ symbol, valuePc, currency, unrealizedPc, profile });
const stock = (sector: string, industry: string, country: string, capUsd: number) => ({ type: 'stock', kind: 'stock' as const, sector, industry, country, capUsd, fundCategory: null, sectorWeights: null });
const fund = (w: Record<string, number> | null) => ({ type: 'etf', kind: 'etf' as const, sector: null, industry: null, country: null, capUsd: null, fundCategory: null, sectorWeights: w });

const book = [
	pos('AMAT', 300, stock('technology', 'Semiconductor Equipment & Materials', 'United States', 280e9)),
	pos('ESLT', 200, stock('industrials', 'Aerospace & Defense', 'Israel', 30e9), 'ILS', -5),
	pos('SCHD', 400, fund({ technology: 0.5, energy: 0.4 })),
	pos('NEW', 100, null)
];

describe('allocation', () => {
	it('splits a fund across sectors by its weights; cash and the unknown are grey', () => {
		const { rows, total, unknown } = allocate('sector', book, 100, t);
		const by = Object.fromEntries(rows.map((r) => [r.key, r.value]));
		expect(total).toBe(1100);
		expect(by.technology).toBeCloseTo(500);
		expect(by.energy).toBeCloseTo(160);
		expect(by.industrials).toBe(200);
		expect(by.other).toBeCloseTo(40);
		expect(by.none).toBe(100);
		expect(by.cash).toBe(100);
		expect(unknown).toBe(1);
		expect(rows[0].key).toBe('technology');
		expect(rows.reduce((n, r) => n + r.pct, 0)).toBeCloseTo(100);
	});

	it('size, country, result and currencies', () => {
		const size = Object.fromEntries(allocate('size', book, 0, t).rows.map((r) => [r.key, r.value]));
		expect(size).toMatchObject({ mega: 300, large: 200, funds: 400, none: 100 });
		expect(allocate('country', book, 0, t).rows.map((r) => r.label)).toContain('Israel');
		const res = Object.fromEntries(allocate('result', book, 0, t).rows.map((r) => [r.key, r.value]));
		expect(res).toMatchObject({ up: 800, down: 200 });
		const cur = Object.fromEntries(allocate('currency', book, 50, t).rows.map((r) => [r.key, r.value]));
		expect(cur).toMatchObject({ usd: 800, ils: 250 });
	});

	it('more than eight securities fold into «others»', () => {
		const many = Array.from({ length: 12 }, (_, i) => pos(`S${i}`, 100 - i, null));
		const { rows } = allocate('security', many, 0, t);
		expect(rows.filter((r) => !r.muted)).toHaveLength(7);
		expect(rows.find((r) => r.key === 'others')!.value).toBe(93 + 92 + 91 + 90 + 89);
	});
});
