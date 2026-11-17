import { describe, expect, it } from 'vitest';
import { nextPricesRun, noResultYet } from './hypothesis.js';

describe('the prices hint (T-007)', () => {
	it('next run is today before 07:15 Israel time and tomorrow after it', () => {
		// 2026-11-17: Israel is UTC+2 in winter
		expect(nextPricesRun(new Date('2026-11-17T05:10:00Z'))).toBe('сегодня в 07:15');
		expect(nextPricesRun(new Date('2026-11-17T05:20:00Z'))).toBe('завтра в 07:15');
		expect(nextPricesRun(new Date('2026-11-17T21:59:00Z'))).toBe('завтра в 07:15');
	});
	it('a fresh hypothesis has no result yet; one with a later price has', () => {
		const h = { status: 'open', entryPrice: 10, entryPriceDate: '2026-11-16', lastDate: '2026-11-16' };
		expect(noResultYet(h)).toBe(true);
		expect(noResultYet({ ...h, lastDate: null })).toBe(true);
		expect(noResultYet({ ...h, lastDate: '2026-11-17' })).toBe(false);
		expect(noResultYet({ ...h, entryPrice: null })).toBe(false);
		expect(noResultYet({ ...h, status: 'closed' })).toBe(false);
	});
});
