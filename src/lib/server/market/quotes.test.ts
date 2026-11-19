import { describe, expect, it } from 'vitest';
import { openMarket } from '../db.js';
import { fitToClose, marketsOpen, parseQuote, readSchedule, writeSchedule } from './quotes.js';

describe('live quotes', () => {
	it('reads the last price and its time from the chart answer', () => {
		const body = JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 123.45, regularMarketTime: 1795100000, chartPreviousClose: 120, currency: 'USD' } }] } });
		expect(parseQuote(body)).toEqual({ price: 123.45, prevClose: 120, currency: 'USD', marketTime: new Date(1795100000 * 1000).toISOString() });
		expect(parseQuote(JSON.stringify({ chart: { result: [] } }))).toBeNull();
	});
	it('brings agorot and shekels to the close’s unit, refuses a bad print', () => {
		expect(fitToClose(6512, 6480)).toBe(6512);
		expect(fitToClose(65.12, 6480)).toBeCloseTo(6512, 6);
		expect(fitToClose(651200, 6480)).toBe(6512);
		expect(fitToClose(9000, 5000)).toBeNull();
		expect(fitToClose(10, null)).toBe(10);
	});
	it('knows when TASE and the US market are open', () => {
		// Wednesday 18.11.2026: 12:00 Israel — TASE open, New York 05:00 closed
		expect(marketsOpen(new Date('2026-11-18T10:00:00Z'))).toEqual({ tase: true, us: false });
		// 18:00 Israel = 11:00 New York — TASE closed, US open
		expect(marketsOpen(new Date('2026-11-18T16:00:00Z'))).toEqual({ tase: false, us: true });
		// Saturday — both closed
		expect(marketsOpen(new Date('2026-11-21T12:00:00Z'))).toEqual({ tase: false, us: false });
	});
	it('keeps the schedule in the settings, refuses odd values', () => {
		const m = openMarket(':memory:').sqlite;
		expect(readSchedule(m)).toEqual({ quotesEvery: 15, quotesMarketHours: true, pricesAt: '07:15' });
		expect(writeSchedule(m, { quotesEvery: 5, quotesMarketHours: false, pricesAt: '06:40' })).toEqual({ quotesEvery: 5, quotesMarketHours: false, pricesAt: '06:40' });
		expect(() => writeSchedule(m, { quotesEvery: 7 })).toThrow();
		expect(() => writeSchedule(m, { pricesAt: '25:00' })).toThrow();
	});
});
