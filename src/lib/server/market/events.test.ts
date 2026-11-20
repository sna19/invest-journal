import { describe, expect, it } from 'vitest';
import { parseCalendar, parseDividends, parseNext } from './events.js';

describe('the report and dividend calendar (T-013)', () => {
	it('reads Yahoo\'s earnings calendar as days on the exchange', () => {
		const body = JSON.stringify({
			finance: { result: [{ documents: [{ columns: [{ id: 'startdatetime' }, { id: 'eventtype' }], rows: [['2025-05-28T20:20:00.000Z', '2'], ['2025-02-26T21:20:00.000Z', '2'], ['2025-02-26T21:20:00.000Z', '2']] }] }] }
		});
		// 20:20 UTC is 16:20 in New York — the same day
		expect(parseCalendar(body, 'America/New_York')).toEqual(['2025-02-26', '2025-05-28']);
		expect(parseCalendar(JSON.stringify({ finance: { result: [] } }), 'UTC')).toEqual([]);
	});
	it('reads the dividends of a chart and the next report of the calendar events', () => {
		const ch = JSON.stringify({ chart: { result: [{ events: { dividends: { a: { amount: 1, date: Date.parse('2025-03-10T13:30:00Z') / 1000 }, b: { amount: 1, date: Date.parse('2024-03-11T13:30:00Z') / 1000 } } } }] } });
		expect(parseDividends(ch, 'America/New_York')).toEqual(['2024-03-11', '2025-03-10']);
		const nx = JSON.stringify({ quoteSummary: { result: [{ calendarEvents: { earnings: { earningsDate: [{ raw: Date.parse('2026-11-17T21:00:00Z') / 1000 }] }, exDividendDate: { raw: Date.parse('2026-12-02T00:00:00Z') / 1000 } } }] } });
		expect(parseNext(nx, 'America/New_York')).toEqual({ earnings: ['2026-11-17'], dividends: ['2026-12-02'] });
	});
});
