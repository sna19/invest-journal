import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addEvent, createPortfolio } from './portfolio.js';
import { addEntry, listEntries } from './diary.js';
import { decideOther } from './decisions.js';
import { addReminder, checkReminders, closeReminder, historyOfReminder, signalsBlock, snooze, snoozeSignal } from './reminders.js';

const NOW = new Date('2026-05-04T09:00:00Z');

function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = (market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'AAPL', 'Apple', 'USD', 'USD', 'aapl') returning id`).get() as { id: number }).id;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	px.run(sec, '2026-04-01', 99, 101, 100);
	px.run(sec, '2026-04-24', 104, 106, 105);
	px.run(sec, '2026-04-30', 84, 86, 85);
	market.prepare(`insert into ref_security_events (security_id, kind, date, provider_code) values (?, 'earnings', '2026-05-07', 'test')`).run(sec);
	const entry = addEntry(app, market, { body: 'Жду отчёт, потом решу', links: [{ type: 'security', id: sec }] })!;
	return { app, market, sec, entry };
}
const ids = (s: ReturnType<typeof setup>, today: string) => signalsBlock(s.app, s.market, today).reminders.map((r) => r.title);

describe('T-032 11г: reminders', () => {
	it('a date reminder shows in «Сигналы» on its day; snoozed for a week it goes and comes back; closed with a conclusion — a «вывод» in the chain', () => {
		const s = setup();
		const id = addReminder(s.app, { entryId: s.entry, condition: 'date', date: '2026-05-10', title: 'Посмотреть отчёт' });
		expect(ids(s, '2026-05-09')).toEqual([]);
		expect(ids(s, '2026-05-10')).toEqual(['Посмотреть отчёт']);
		expect(snooze(s.app, id, 'week', '2026-05-10')).toBe('2026-05-17');
		expect(ids(s, '2026-05-12')).toEqual([]);
		expect(ids(s, '2026-05-17')).toEqual(['Посмотреть отчёт']);
		snooze(s.app, id, 'day', '2026-05-17');
		snooze(s.app, id, '2026-06-01', '2026-05-18');
		expect(signalsBlock(s.app, s.market, '2026-06-01').reminders[0].snoozes).toBe(3);
		closeReminder(s.app, s.market, id, '<p>Отчёт слабый — <b>не докупаю</b></p>');
		expect(ids(s, '2026-06-02')).toEqual([]);
		const e = listEntries(s.app, s.market, {}).items.find((x) => x.id === s.entry)!;
		expect(e.answers.map((a) => [a.kind, a.html])).toEqual([['conclusion', '<p>Отчёт слабый — <b>не докупаю</b></p>']]);
		expect(historyOfReminder(s.app, id).map((h) => h.kind)).toEqual(['created', 'fired', 'snoozed', 'fired', 'snoozed', 'snoozed', 'fired', 'closed']);
		expect(() => snooze(s.app, id, '2026-05-01', '2026-06-02')).toThrow(/позже/);
	});

	it('the conditions: a price level, a change over N days, a position\'s drawdown, days before a report, a hypothesis\'s term', () => {
		const s = setup();
		const fire = (input: object, today = '2026-04-30') => {
			const id = addReminder(s.app, { entryId: s.entry, ...input });
			return checkReminders(s.app, s.market, today).some((r) => r.id === id);
		};
		expect(fire({ condition: 'price_below', securityId: s.sec, level: 90 })).toBe(true);
		expect(fire({ condition: 'price_above', securityId: s.sec, level: 90 })).toBe(false);
		// 105 → 85 over 6 days: −19%
		expect(fire({ condition: 'change', securityId: s.sec, days: 6, pct: 15 })).toBe(true);
		expect(fire({ condition: 'change', securityId: s.sec, days: 6, pct: 25 })).toBe(false);
		const p = createPortfolio(s.app, { name: 'Мой', kind: 'real', currency: 'USD' });
		const pos = addEvent(s.app, s.market, { portfolioId: p.id, securityId: s.sec, kind: 'buy', date: '2026-04-01', qty: 1, price: 100 }, NOW).positionId;
		expect(fire({ condition: 'drawdown', positionId: pos, pct: 10 })).toBe(true); // 100 → 85
		expect(fire({ condition: 'drawdown', positionId: pos, pct: 20 })).toBe(false);
		expect(fire({ condition: 'report', securityId: s.sec, days: 3 }, '2026-05-03')).toBe(false);
		expect(fire({ condition: 'report', securityId: s.sec, days: 3 }, '2026-05-04')).toBe(true);
		expect(() => addReminder(s.app, { entryId: s.entry, condition: 'change', securityId: s.sec, days: 0, pct: 5 })).toThrow(/365/);
	});

	it('«Отложить» creates its reminder; the feed filter «с открытым напоминанием»', () => {
		const s = setup();
		decideOther(s.app, s.market, { type: 'defer', securityId: s.sec, basis: 'intuition', why: '<p>после отчёта</p>', reviewDate: '2026-05-08' });
		expect(ids(s, '2026-05-08')).toEqual(['Вернуться к AAPL']);
		expect(listEntries(s.app, s.market, { remind: true }).items.map((e) => e.kind)).toEqual(['decision']);
	});

	it('a trade signal is snoozed the same way', () => {
		const s = setup();
		const p = createPortfolio(s.app, { name: 'Мой', kind: 'real', currency: 'USD' });
		addEvent(s.app, s.market, { portfolioId: p.id, securityId: s.sec, kind: 'buy', date: '2026-04-01', qty: 1, price: 100, discipline: true, plan: { thesis: 't', stop: 90, reviewDate: '2026-12-31' } }, NOW);
		const sig = signalsBlock(s.app, s.market, '2026-04-30').trade;
		expect(sig.map((x) => x.kind)).toEqual(['stop']);
		snoozeSignal(s.app, sig[0].key, 'day', '2026-04-30');
		expect(signalsBlock(s.app, s.market, '2026-04-30').trade).toEqual([]);
		const back = signalsBlock(s.app, s.market, '2026-05-01').trade;
		expect(back.map((x) => [x.kind, x.snoozes])).toEqual([['stop', 1]]);
	});
});
