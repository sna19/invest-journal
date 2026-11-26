import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { InputError } from './journal.js';
import { addEvent, createPortfolio, deletePosition, positionView } from './portfolio.js';
import { defaultReview, disciplineStats, listRules, planOf, saveRule, deleteRule, savePlan, signals } from './discipline.js';
import { tradeRisk } from '../discipline.js';

const NOW = new Date('2026-05-04T09:00:00Z');

/** one US share with prices to 30.04.2026 (last close 110), the dollar rate, a dollar portfolio */
function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const us = (
		market
			.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'UUU', 'U Corp', 'USD', 'USD', 'uuu') returning id`)
			.get() as { id: number }
	).id;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	for (const [d, c] of [
		['2026-01-05', 100],
		['2026-04-01', 120],
		['2026-04-30', 110]
	] as const)
		px.run(us, d, c - 2, c + 2, c);
	market.prepare(`insert into market_fx_daily (pair, date, rate, provider_code) values ('USD/ILS', '2026-01-05', 3.5, 'test')`).run();
	const p = createPortfolio(app, { name: 'Мой', kind: 'real', currency: 'USD' });
	app.prepare(`insert into cash_events (portfolio_id, kind, date, amount, currency) values (?, 'deposit', '2026-01-02', 10000, 'USD')`).run(p.id);
	return { app, market, us, p };
}

const buy = (s: ReturnType<typeof setup>, extra: object) =>
	addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, discipline: true, ...extra }, NOW);

describe('T-015: the conditions of a purchase', () => {
	it('a purchase from the form needs a thesis and a stop — or «без стопа» with a reason (rule 1)', () => {
		const s = setup();
		expect(() => buy(s, { plan: { stop: 90 } })).toThrow(InputError);
		try {
			buy(s, { plan: { thesis: 'рост облака' } });
		} catch (e) {
			expect((e as InputError).errors as Record<string, string>).toMatchObject({ stop: expect.stringMatching(/без стопа/) });
		}
		expect(() => buy(s, { plan: { thesis: 'x', stop: 100 } })).toThrow(/ниже цены входа/);
		expect(() => buy(s, { plan: { thesis: 'x', stop: 90, target: 95 } })).toThrow(/выше цены входа/);
		const r = buy(s, { plan: { thesis: 'спекуляция на отчёте', kind: 'spec', noStopReason: 'держу через отчёт' } });
		const plan = planOf(s.app, r.positionId)!;
		expect(plan).toMatchObject({ kind: 'spec', stop: null, noStopReason: 'держу через отчёт', eventId: r.eventId, reviewDate: '2026-04-05' });
	});

	it('without `discipline` (tests, imports) nothing is asked; a model trade reviews at the quarter end', () => {
		const s = setup();
		const r = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 1, price: 100 }, NOW);
		expect(planOf(s.app, r.positionId)).toBeNull();
		expect(defaultReview('model', '2026-01-05')).toBe('2026-03-31');
		expect(defaultReview('model', '2026-11-30')).toBe('2026-12-31');
		expect(defaultReview('own', '2026-11-30')).toBe('2027-02-28');
	});

	it('the risk of a trade is (entry − stop) × quantity, in the portfolio currency and in % of it — as by hand', () => {
		// 10 shares at $100, stop $92: 8 × 10 = $80; a portfolio of $10 000 → 0.8%
		const r = tradeRisk({ entry: 100, stop: 92, qty: 10, factor: 1, toPc: 1, portfolioValue: 10000 })!;
		expect([r.money, r.pct]).toEqual([80, 0.8]);
		expect(r.stopPct).toBeCloseTo(8, 9);
		// a TASE share in agorot into a shekel portfolio: 200 × (6500 − 6000) ag. = ₪1 000
		expect(tradeRisk({ entry: 6500, stop: 6000, qty: 200, factor: 0.01, toPc: 1, portfolioValue: 50000 })!.money).toBeCloseTo(1000, 9);
		// a dollar share in a shekel portfolio at 3.7
		expect(tradeRisk({ entry: 50, stop: 45, qty: 4, factor: 1, toPc: 3.7, portfolioValue: null })!.money).toBeCloseTo(74, 9);
		expect(tradeRisk({ entry: 50, stop: null, qty: 4, factor: 1, toPc: 1, portfolioValue: null })).toBeNull();
	});
});

describe('T-015: signals', () => {
	it('a stop broken by the latest price, a target reached, the review date, a model position past its quarter', () => {
		const s = setup();
		const a = buy(s, { plan: { thesis: 't', stop: 95, reviewDate: '2026-06-30' } });
		expect(signals(s.app, s.market, '2026-04-30')).toEqual([]);
		// a trailing stop above the entry is allowed when reviewing
		savePlan(s.app, a.positionId, { stop: 112, reason: 'подтянул стоп' }, NOW);
		expect(signals(s.app, s.market, '2026-04-30').map((x) => x.kind)).toEqual(['stop']);
		savePlan(s.app, a.positionId, { stop: 95, target: 108, reason: 'поднял стоп' }, NOW);
		expect(signals(s.app, s.market, '2026-04-30').map((x) => x.kind)).toEqual(['target']);
		savePlan(s.app, a.positionId, { stop: 95, target: 130, reviewDate: '2026-04-15', reason: 'цель выше' }, NOW);
		expect(signals(s.app, s.market, '2026-04-30').map((x) => x.kind)).toEqual(['review']);
		savePlan(s.app, a.positionId, { kind: 'model', stop: 95, target: 130, reviewDate: '2026-03-31', reason: 'это была модель' }, NOW);
		expect(signals(s.app, s.market, '2026-04-30').map((x) => x.kind)).toEqual(['model_end']);
		// «Продал» ends them
		addEvent(s.app, s.market, { positionId: a.positionId, kind: 'sell', date: '2026-04-30', qty: 10, price: 110, discipline: true, review: { reason: 'model', followed: true } }, NOW);
		expect(signals(s.app, s.market, '2026-04-30')).toEqual([]);
	});

	it('«Пересмотрел» needs a reason and leaves a note in the feed; a carried-over position is filled without one', () => {
		const s = setup();
		const a = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'opening', date: '2026-01-05', qty: 5, price: 100 }, NOW);
		savePlan(s.app, a.positionId, { thesis: 'старая позиция', stop: 90 }, NOW);
		expect(() => savePlan(s.app, a.positionId, { stop: 95 }, NOW)).toThrow(/Почему пересмотрел/);
		savePlan(s.app, a.positionId, { stop: 95, reason: 'отчёт сильный' }, NOW);
		const v = positionView(s.app, s.market, a.positionId, '2026-04-30')!;
		expect(v.plan).toMatchObject({ thesis: 'старая позиция', stop: 95 });
		expect(v.events.find((e) => e.kind === 'note')!.note).toMatch(/Пересмотрел: отчёт сильный · стоп 90 → 95/);
		// deleting the position takes its conditions along
		deletePosition(s.app, s.market, a.positionId);
		expect(s.app.prepare('select count(*) as n from trade_plans').get()).toEqual({ n: 0 });
	});
});

describe('T-015: the review at a sale and «Дисциплина»', () => {
	it('a sale from the form asks for the reason and the rule; the numbers count it', () => {
		const s = setup();
		const a = buy(s, { plan: { thesis: 't', stop: 90 } });
		addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 5, price: 100 }, NOW); // an old purchase, no conditions
		expect(() => addEvent(s.app, s.market, { positionId: a.positionId, kind: 'sell', date: '2026-04-01', qty: 5, price: 120, discipline: true }, NOW)).toThrow(InputError);
		addEvent(s.app, s.market, { positionId: a.positionId, kind: 'sell', date: '2026-04-01', qty: 10, price: 120, discipline: true, review: { reason: 'target', followed: true } }, NOW);
		addEvent(s.app, s.market, { positionId: a.positionId, kind: 'sell', date: '2026-04-30', qty: 5, price: 110, discipline: true, review: { reason: 'changed_mind', followed: false } }, NOW);
		const d = disciplineStats(s.app, s.market, '2026-04-30');
		expect(d.buys).toEqual({ n: 2, withPlan: 1, withStop: 1 });
		expect(d.exits).toEqual({ n: 2, reviewed: 2, followed: 1 });
		expect(d.byRule.kept).toMatchObject({ n: 1, avgPct: 20, wins: 1 });
		expect(d.byRule.broken).toMatchObject({ n: 1, avgPct: 10, wins: 1 });
		expect(d.matrix).toEqual({ goodWin: 1, goodLoss: 0, badWin: 1, badLoss: 0 });
		expect(d.kinds.map((k) => [k.kind, k.n])).toEqual([['own', 2]]);
		const v = positionView(s.app, s.market, a.positionId, '2026-04-30')!;
		expect(Object.values(v.reviews).map((r) => r.reason).sort()).toEqual(['changed_mind', 'target']);
	});

	it('«Мои правила»: three from the start, added, moved, deleted', () => {
		const s = setup();
		expect(listRules(s.app).map((r) => r.text)).toEqual([
			'Нет условия выхода — нет сделки.',
			'Сделка по модели исполняется по модели целиком, включая выход.',
			'Спекуляции — только из игрового бюджета с потолком и заранее принятым максимальным убытком.'
		]);
		const list = saveRule(s.app, { text: 'Не докупать падающую позицию' });
		const id = list.at(-1)!.id;
		expect(saveRule(s.app, { id, move: 'up' }).map((r) => r.text)[2]).toBe('Не докупать падающую позицию');
		expect(() => saveRule(s.app, { text: '  ' })).toThrow(InputError);
		expect(deleteRule(s.app, id)).toHaveLength(3);
	});
});
