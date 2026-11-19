import { describe, expect, it } from 'vitest';
import { lastCompleteMonth, parseMonthly } from './monthly.js';

const ts = (d: string) => Date.parse(d + 'T04:00:00Z') / 1000;
const body = JSON.stringify({
	chart: {
		result: [
			{
				meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York' },
				timestamp: [ts('2026-08-01'), ts('2026-09-01'), ts('2026-10-01'), ts('2026-11-01'), ts('2026-11-18')],
				indicators: {
					quote: [{ close: [458.39, 511.38, 390.09, 352.3, 352.3], volume: [1, 2, 3, 4, 5] }],
					adjclose: [{ adjclose: [457, 510, 390.09, 352.3, 352.3] }]
				}
			}
		]
	}
});

describe('monthly prices', () => {
	it('keeps complete months only, close and adjusted close', () => {
		const { rows, unit } = parseMonthly(body, new Date('2026-11-19T10:00:00Z'));
		expect(unit).toBe('USD');
		expect(rows.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
		expect(rows[1]).toMatchObject({ close: 511.38, adjClose: 510, volume: 2 });
	});

	it('the last complete month', () => {
		expect(lastCompleteMonth(new Date('2026-11-19T10:00:00Z'))).toBe('2026-10');
		expect(lastCompleteMonth(new Date('2027-01-05T10:00:00Z'))).toBe('2026-12');
	});
});
