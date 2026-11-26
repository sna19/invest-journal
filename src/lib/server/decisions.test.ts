import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addEvent, createPortfolio, positionView } from './portfolio.js';
import { savePlan } from './discipline.js';
import { listEntries } from './diary.js';
import { buyForSale, cancelDecision, decideBuy, decideHold, decideOther, decideSell, historyOf, syncDecisions, underSignal } from './decisions.js';

const NOW = new Date('2026-05-04T09:00:00Z');

function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = (market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'AAPL', 'Apple', 'USD', 'USD', 'aapl') returning id`).get() as { id: number }).id;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	px.run(sec, '2026-04-01', 99, 101, 100);
	px.run(sec, '2026-04-30', 108, 112, 110);
	const p = createPortfolio(app, { name: 'Мой', kind: 'real', currency: 'USD' });
	const buy = (extra: object = {}) => {
		const r = addEvent(app, market, { portfolioId: p.id, securityId: sec, kind: 'buy', date: '2026-04-01', qty: 10, price: 100, discipline: true, plan: { thesis: 'Сервисы растут быстрее железа', wrongIf: 'маржа сервисов падает', stop: 90, target: 130, reviewDate: '2026-12-31' }, ...extra }, NOW);
		decideBuy(app, market, r.eventId, {});
		return r;
	};
	return { app, market, sec, p, buy };
}

describe('T-032 11б: decisions', () => {
	it('a purchase with «Почему» is a decision «купить» with its thesis entry; it is in the feed and in the filter «решения»', () => {
		const s = setup();
		const { positionId } = s.buy();
		const d = positionView(s.app, s.market, positionId, '2026-04-30')!.decisions;
		expect(d.map((x) => [x.type, x.basis, x.expectation, x.noReason])).toEqual([['buy', 'intuition', 'цель 130 · стоп 90', 0]]);
		const feed = listEntries(s.app, s.market, { only: 'decisions' }).items;
		expect(feed).toHaveLength(1);
		expect(feed[0].html).toContain('Сервисы растут быстрее железа');
		expect(feed[0].html).toContain('маржа сервисов падает');
		expect((feed[0].decision as { type: string }).type).toBe('buy');
		// a second purchase on top is «докупить»
		const r2 = addEvent(s.app, s.market, { positionId, kind: 'buy', date: '2026-04-30', qty: 1, price: 110, discipline: true, plan: { thesis: 'ещё', stop: 95 } }, NOW);
		expect(decideBuy(s.app, s.market, r2.eventId)).toBeTruthy();
		expect(positionView(s.app, s.market, positionId, '2026-04-30')!.decisions.map((x) => x.type)).toEqual(['buy', 'add']);
	});

	it('a sale shows the purchase, «Сбылось? частично» becomes a conclusion in the chain and in the security\'s history', () => {
		const s = setup();
		const { positionId } = s.buy();
		expect(buyForSale(s.app, positionId)!.html).toContain('Сервисы растут');
		const sale = addEvent(s.app, s.market, { positionId, kind: 'sell', date: '2026-04-30', qty: 4, price: 110, discipline: true, review: { reason: 'changed_mind', followed: false } }, NOW);
		decideSell(s.app, s.market, sale.eventId, { why: '<p>Беру часть прибыли перед отчётом</p>', outcome: 'partly', conclusion: '<p>Сервисы растут, но <b>медленнее</b></p>' });
		const ds = positionView(s.app, s.market, positionId, '2026-04-30')!.decisions;
		expect(ds.map((x) => [x.type, x.outcome])).toEqual([
			['buy', 'partly'],
			['trim', null]
		]);
		const thesis = listEntries(s.app, s.market, { only: 'decisions' }).items.find((e) => (e.decision as { type: string }).type === 'buy')!;
		const kinds = thesis.answers.map((a) => a.kind).sort();
		expect(kinds).toEqual(['conclusion', 'decision']);
		const c = thesis.answers.find((a) => a.kind === 'conclusion')!;
		expect(c.html).toContain('Сбылось: <b>частично</b> · выход: передумал · правило нарушено');
		expect(c.html).toContain('<b>медленнее</b>');
		const h = historyOf(s.app, { securityId: s.sec }).items.map((x) => x.label);
		expect(h).toEqual(['Решение: купить · интуиция · сбылось: частично', 'Решение: сократить · интуиция', 'Вывод']);
	});

	it('a sale without «Почему» is allowed and marked; «Пересмотрел» at a signal is «держать» in the chain', () => {
		const s = setup();
		const { positionId } = s.buy();
		// the price (110) is under a stop moved up to 112 — a signal stands
		savePlan(s.app, positionId, { stop: 112, reason: 'подтянул' }, NOW);
		expect(underSignal(s.app, s.market, positionId)).toBe(true);
		const r = savePlan(s.app, positionId, { stop: 100, reason: 'держу: отчёт через неделю' }, NOW);
		decideHold(s.app, s.market, positionId, r.noteEventId!);
		const sale = addEvent(s.app, s.market, { positionId, kind: 'sell', date: '2026-04-30', qty: 10, price: 110, discipline: true, review: { reason: 'stop', followed: true } }, NOW);
		decideSell(s.app, s.market, sale.eventId, { outcome: 'no' });
		const ds = positionView(s.app, s.market, positionId, '2026-04-30')!.decisions;
		expect(ds.map((x) => [x.type, x.noReason])).toEqual([
			['buy', 0],
			['hold', 0],
			['sell', 1]
		]);
		const hold = listEntries(s.app, s.market, { only: 'decisions' }).items.find((e) => (e.decision as { type: string }).type === 'buy')!.answers.find((a) => (a.decision as { type: string } | null)?.type === 'hold')!;
		expect(hold.body).toMatch(/Пересмотрел: держу: отчёт через неделю/);
	});

	it('«не покупать» and «отложить» need the basis and the reason; a decision is cancelled only within 24 hours', () => {
		const s = setup();
		expect(() => decideOther(s.app, s.market, { type: 'skip', securityId: s.sec, why: '<p>дорого</p>' })).toThrow(/Основание/);
		expect(() => decideOther(s.app, s.market, { type: 'defer', securityId: s.sec, basis: 'intuition', why: 'жду' })).toThrow(/вернуться/);
		const id = decideOther(s.app, s.market, { type: 'skip', securityId: s.sec, basis: 'consensus', why: '<p>все уже купили</p>' });
		expect(() => cancelDecision(s.app, id, new Date(Date.now() + 25 * 3600_000))).toThrow(/24 часа/);
		expect(cancelDecision(s.app, id).cancelledAt).toBeTruthy();
		expect(historyOf(s.app, { securityId: s.sec }).items).toEqual([]);
	});

	it('the purchases before 11б get their decisions from their theses, once', () => {
		const s = setup();
		const r = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.sec, kind: 'buy', date: '2026-04-01', qty: 5, price: 100, discipline: true, plan: { thesis: 'старый тезис', stop: 90, kind: 'model' } }, NOW);
		expect(syncDecisions(s.app, s.market)).toBe(1);
		expect(syncDecisions(s.app, s.market)).toBe(0);
		const d = positionView(s.app, s.market, r.positionId, '2026-04-30')!.decisions;
		expect(d.map((x) => [x.type, x.basis])).toEqual([['buy', 'model']]);
		expect(decideBuy(s.app, s.market, r.eventId)).toBeNull();
	});
});
