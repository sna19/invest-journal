import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { israelDate } from '../hypothesis.js';
import { InputError, LockedError } from './journal.js';
import {
	addCash,
	addEvent,
	cancelEvent,
	ConfirmError,
	createPortfolio,
	deletePortfolio,
	deletePosition,
	editCash,
	editEvent,
	exportPortfolio,
	listPortfolios,
	portfolioView,
	positionView,
	reverseEvent,
	setAuto,
	syncAuto,
	updatePortfolio
} from './portfolio.js';

const NOW = new Date('2026-05-04T09:00:00Z');

/** A market with one US share, one TASE share (agorot), prices, a dividend, the dollar rate. */
function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = market.prepare(
		`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values (?, 'stock', ?, ?, ?, ?, ?) returning id`
	);
	const us = (sec.get('NASDAQ', 'UUU', 'U Corp', 'USD', 'USD', 'uuu') as { id: number }).id;
	const il = (sec.get('TASE', 'AAA', 'A Ltd', 'ILS', 'ILA', 'aaa') as { id: number }).id;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	for (const [d, c] of [
		['2026-01-05', 100],
		['2026-02-02', 105],
		['2026-04-01', 120],
		['2026-04-30', 110]
	] as const)
		px.run(us, d, c - 2, c + 2, c);
	for (const [d, c] of [
		['2026-01-05', 5000],
		['2026-02-02', 6000],
		['2026-03-02', 7000],
		['2026-04-30', 6500]
	] as const)
		px.run(il, d, c - 100, c + 100, c);
	const fx = market.prepare(`insert into market_fx_daily (pair, date, rate, provider_code) values ('USD/ILS', ?, ?, 'test')`);
	for (const [d, r] of [
		['2026-01-05', 3.5],
		['2026-04-01', 3.7],
		['2026-04-30', 3.8]
	] as const)
		fx.run(d, r);
	market.prepare(`insert into market_corporate_actions (security_id, ex_date, kind, amount, provider_code) values (?, '2026-03-10', 'dividend', 1, 'test')`).run(us);
	const p = createPortfolio(app, { name: 'Мой', kind: 'real', currency: 'ILS' });
	return { app, market, us, il, p };
}

describe('portfolio events (section 18)', () => {
	it('a buy opens a position; the rate is taken by the date; stages follow the events', () => {
		const s = setup();
		const a = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'watch', date: '2026-01-02', note: 'интересно' }, NOW);
		const b = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, fee: 1 }, NOW);
		expect(b.positionId).toBe(a.positionId);
		const v = positionView(s.app, s.market, a.positionId, '2026-04-30')!;
		expect(v.position.stage).toBe('holding');
		expect(v.events.find((e) => e.kind === 'buy')!.fxRate).toBe(3.5);
		expect(v.position.valuePc).toBeCloseTo(10 * 110 * 3.8, 6);
	});

	it('refuses a future date, an oversell, a sell of nothing; asks about a price far from the day', () => {
		const s = setup();
		expect(() => addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-06-01', qty: 1, price: 100 }, NOW)).toThrow(InputError);
		expect(() => addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'sell', date: '2026-01-05', qty: 1, price: 100 }, NOW)).toThrow(InputError);
		const { positionId } = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.il, kind: 'buy', date: '2026-01-05', qty: 100, price: 5000 }, NOW);
		expect(() => addEvent(s.app, s.market, { positionId, kind: 'sell', date: '2026-02-02', qty: 101, price: 6000 }, NOW)).toThrow(/продаётся/);
		// 50 instead of 5000: shekels instead of agorot — asked, with a hint; with confirm it goes
		expect(() => addEvent(s.app, s.market, { positionId, kind: 'buy', date: '2026-02-02', qty: 1, price: 60 }, NOW)).toThrow(ConfirmError);
		expect(() => addEvent(s.app, s.market, { positionId, kind: 'buy', date: '2026-02-02', qty: 1, price: 60 }, NOW)).toThrow(/агороты/);
		expect(() => addEvent(s.app, s.market, { positionId, kind: 'buy', date: '2026-02-02', qty: 1, price: 60, confirm: true }, NOW)).not.toThrow();
		// within 10% of the range: no question
		expect(() => addEvent(s.app, s.market, { positionId, kind: 'buy', date: '2026-02-02', qty: 1, price: 6500 }, NOW)).not.toThrow();
	});

	it("the database keeps an event's kind and position, refuses deletes, and logs every correction", () => {
		const s = setup();
		const { eventId } = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 1, price: 100 }, NOW);
		expect(() => s.app.prepare(`update position_events set kind = 'sell' where id = ?`).run(eventId)).toThrow(/keeps its kind/);
		expect(() => s.app.prepare('delete from position_events where id = ?').run(eventId)).toThrow(/never deleted/);
		s.app.prepare('update position_events set qty = 2 where id = ?').run(eventId);
		const log = s.app.prepare('select * from event_edits').all() as { event_id: number; old_values: string; new_values: string }[];
		expect(log).toHaveLength(1);
		expect(JSON.parse(log[0].old_values).qty).toBe(1);
		expect(JSON.parse(log[0].new_values).qty).toBe(2);
		expect(() => s.app.prepare('delete from event_edits').run()).toThrow(/never deleted/);
	});

	it('«Изменить»: date, quantity, price and fee change in place; the rate follows the date; checks as for a new event', () => {
		const s = setup();
		const { positionId, eventId } = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, fee: 1 }, NOW);
		const sell = addEvent(s.app, s.market, { positionId, kind: 'sell', date: '2026-04-01', qty: 4, price: 120 }, NOW);
		editEvent(s.app, s.market, eventId, { date: '2026-04-01', qty: 12, price: 118, fee: 2 }, NOW);
		const v = positionView(s.app, s.market, positionId, '2026-04-30')!;
		const buy = v.events.find((e) => e.id === eventId)!;
		expect([buy.date, buy.qty, buy.price, buy.fee, buy.fxRate]).toEqual(['2026-04-01', 12, 118, 2, 3.7]);
		expect(v.position.qty).toBe(8);
		expect(v.events).toHaveLength(2);
		expect((s.app.prepare('select count(*) as n from event_edits').get() as { n: number }).n).toBe(1);
		// the same rules: a future date, a buy smaller than what was sold, a price far from the day
		expect(() => editEvent(s.app, s.market, eventId, { date: '2026-06-01' }, NOW)).toThrow(InputError);
		expect(() => editEvent(s.app, s.market, eventId, { qty: 3 }, NOW)).toThrow(/продажа больше/);
		expect(() => editEvent(s.app, s.market, eventId, { price: 12 }, NOW)).toThrow(ConfirmError);
		expect(() => editEvent(s.app, s.market, eventId, { price: 12, confirm: true }, NOW)).not.toThrow();
		// a reversed event is not changed
		reverseEvent(s.app, s.market, sell.eventId, undefined, NOW);
		expect(() => editEvent(s.app, s.market, sell.eventId, { qty: 1 }, NOW)).toThrow(LockedError);
	});

	it("«Изменить» a money record, and the portfolio's currency with the rates taken again", () => {
		const s = setup();
		const c = addCash(s.app, s.market, s.p.id, { kind: 'deposit', date: '2026-01-05', amount: 1000, currency: 'USD' }, NOW);
		editCash(s.app, s.market, c.id, { date: '2026-04-01', amount: 2000 }, NOW);
		const row = s.app.prepare('select date, amount, fx_rate as fx from cash_events where id = ?').get(c.id) as { date: string; amount: number; fx: number };
		expect(row).toEqual({ date: '2026-04-01', amount: 2000, fx: 3.7 });
		const { eventId } = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 1, price: 100 }, NOW);
		updatePortfolio(s.app, s.p.id, { name: 'Доллары', currency: 'USD' }, s.market);
		const p = s.app.prepare('select name, currency from portfolios where id = ?').get(s.p.id);
		expect(p).toEqual({ name: 'Доллары', currency: 'USD' });
		expect((s.app.prepare('select fx_rate as fx from position_events where id = ?').get(eventId) as { fx: number }).fx).toBe(1);
		// a shekel security keeps a portfolio in shekels
		addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'note', date: '2026-01-05', note: 'x' }, NOW);
		updatePortfolio(s.app, s.p.id, { currency: 'ILS' }, s.market);
		addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.il, kind: 'buy', date: '2026-01-05', qty: 1, price: 5000 }, NOW);
		expect(() => updatePortfolio(s.app, s.p.id, { currency: 'USD' }, s.market)).toThrow(/шекелевые: AAA/);
		// a portfolio with corrections is still deleted whole
		expect(() => deletePortfolio(s.app, s.p.id, 'Доллары')).not.toThrow();
		expect((s.app.prepare('select count(*) as n from event_edits').get() as { n: number }).n).toBe(0);
	});

	it('storno fixes the total and keeps the history; a cancel only within 24 hours', () => {
		const s = setup();
		const { positionId, eventId } = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100 }, NOW);
		const wrong = addEvent(s.app, s.market, { positionId, kind: 'buy', date: '2026-02-02', qty: 100, price: 105 }, NOW);
		expect(positionView(s.app, s.market, positionId, '2026-04-30')!.position.qty).toBe(110);
		reverseEvent(s.app, s.market, wrong.eventId, 'опечатка: 10, а не 100', NOW);
		addEvent(s.app, s.market, { positionId, kind: 'buy', date: '2026-02-02', qty: 10, price: 105 }, NOW);
		const v = positionView(s.app, s.market, positionId, '2026-04-30')!;
		expect(v.position.qty).toBe(20);
		expect(v.events.map((e) => e.kind)).toEqual(['buy', 'buy', 'buy', 'reverse']);
		expect(v.events.find((e) => e.id === wrong.eventId)!.reversedBy).not.toBeNull();
		// the first buy cannot be taken out under a later sell of everything
		addEvent(s.app, s.market, { positionId, kind: 'sell', date: '2026-04-01', qty: 20, price: 120 }, NOW);
		expect(() => reverseEvent(s.app, s.market, eventId, '', NOW)).toThrow(InputError);
		// an event entered just now can be cancelled; one entered two days ago cannot
		const fresh = addEvent(s.app, s.market, { positionId, kind: 'note', date: '2026-04-02', note: 'итог' });
		expect(cancelEvent(s.app, s.market, fresh.eventId)).toBe(positionId);
		s.app.prepare(`insert into position_events (position_id, kind, date, currency, note, created_at) values (?, 'note', '2026-04-02', 'USD', 'старая', '2026-04-02T00:00:00Z')`).run(positionId);
		const old = (s.app.prepare(`select id from position_events where note = 'старая'`).get() as { id: number }).id;
		expect(() => cancelEvent(s.app, s.market, old)).toThrow(LockedError);
		expect(() => s.app.prepare(`update position_events set cancelled_at = 'x' where id = ?`).run(old)).toThrow(/24 hours/);
	});

	it('a shekel portfolio: money by currency as the broker shows, the dollar buy without dollars warns; value, TWR, TA-125', () => {
		const s = setup();
		addCash(s.app, s.market, s.p.id, { kind: 'deposit', date: '2026-01-05', amount: 10000 }, NOW);
		addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.il, kind: 'buy', date: '2026-01-05', qty: 100, price: 5000, fee: 10 }, NOW);
		const u = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, fee: 1 }, NOW);
		expect(u.warning).toMatch(/долларов ушёл в минус/);
		addCash(s.app, s.market, s.p.id, { kind: 'dividend', date: '2026-03-10', amount: 10, currency: 'USD', positionId: u.positionId }, NOW);
		const v = portfolioView(s.app, s.market, s.p.id, '2026-04-30')!;
		// ₪ 10 000 − 5 010 = 4 990; $ −1 001 + 10 = −991, worth −991 × 3.8 = −3 765.8
		expect(v.summary.balances).toEqual([
			{ currency: 'ILS', amount: 4990, valuePc: 4990 },
			{ currency: 'USD', amount: -991, valuePc: expect.closeTo(-3765.8, 6) }
		]);
		// 4 990 − 3 765.8 + 100 × 65 + 10 × 110 × 3.8 = 11 904.2
		expect(v.summary.value).toBeCloseTo(11904.2, 6);
		// TWR: the dollar buy is paid by an implied deposit of 1 001 × 3.5 on 01-05 → (4 990 + 10 × 3.8 + 6 500 + 4 180) / 13 503.5 − 1
		expect(v.summary.twrPct!).toBeCloseTo((15708 / 13503.5 - 1) * 100, 6);
		expect(v.summary.benchmark.label).toBe('ТА-125');
		expect(v.positions.map((p) => p.stage)).toEqual(['holding', 'holding']);
		expect(v.lastFee).toEqual({ ILS: 10, USD: 1 });
	});

	it('a dollar portfolio: only dollar securities; «Перенесено» with the purchase price added later; a conversion is its deposit', () => {
		const s = setup();
		const b = createPortfolio(s.app, { name: 'Blink', kind: 'real', currency: 'USD' });
		expect(() => addEvent(s.app, s.market, { portfolioId: b.id, securityId: s.il, kind: 'buy', qty: 1, price: 5000, date: '2026-01-05' }, NOW)).toThrow(/только бумаги в долларах/);
		const o = addEvent(s.app, s.market, { portfolioId: b.id, securityId: s.us, kind: 'opening', date: '2026-01-05', qty: 10.123456, price: 100 }, NOW);
		let v = portfolioView(s.app, s.market, b.id, '2026-04-30')!;
		expect(v.positions[0]).toMatchObject({ stage: 'holding', fromTransfer: true });
		expect(v.positions[0].qty).toBeCloseTo(10.123456, 9);
		// from the transfer: 100 → 110 $, +10%; no money moved
		expect(v.summary.twrPct!).toBeCloseTo(10, 6);
		expect(v.summary.balances).toEqual([]);
		expect(v.summary.benchmark.label).toBe('S&P 500');
		// the average price comes later and does not change the history: profit from the purchase now
		addEvent(s.app, s.market, { positionId: o.positionId, kind: 'basis', price: 80 }, NOW);
		v = portfolioView(s.app, s.market, b.id, '2026-04-30')!;
		expect(v.positions[0].fromTransfer).toBe(false);
		expect(v.positions[0].unrealized).toBeCloseTo(10.123456 * 30, 6);
		expect(v.summary.twrPct!).toBeCloseTo(10, 6);
		// 3 600 ₪ converted into 1 000 $: dollars come from outside
		addCash(s.app, s.market, b.id, { kind: 'convert', date: '2026-04-30', amount: 3600, currency: 'ILS', toAmount: 1000, toCurrency: 'USD' }, NOW);
		v = portfolioView(s.app, s.market, b.id, '2026-04-30')!;
		expect(v.summary.balances).toEqual([{ currency: 'USD', amount: 1000, valuePc: 1000 }]);
		expect(v.summary.twrPct!).toBeCloseTo(10, 6);
	});
});

describe('export for an AI adviser', () => {
	it('gives totals, positions with only the counted events, money and units', () => {
		const s = setup();
		const a = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, fee: 1 }, NOW);
		const wrong = addEvent(s.app, s.market, { positionId: a.positionId, kind: 'buy', date: '2026-02-02', qty: 1, price: 105 }, NOW);
		reverseEvent(s.app, s.market, wrong.eventId, undefined, NOW);
		addCash(s.app, s.market, s.p.id, { kind: 'deposit', date: '2026-01-05', amount: 4000, currency: 'ILS' }, NOW);
		const x = exportPortfolio(s.app, s.market, s.p.id, '2026-04-30')!;
		expect(x.portfolio).toMatchObject({ name: 'Мой', currency: 'ILS' });
		expect(x.positions).toHaveLength(1);
		const p = x.positions[0];
		expect(p).toMatchObject({ symbol: 'UUU', quantity: 10, lastPrice: 110, value_ILS: 4180 });
		expect(p.events.map((e) => [e.kind, e.quantity])).toEqual([['buy', 10]]);
		expect(x.cash).toEqual([{ date: '2026-01-05', kind: 'deposit', amount: 4000, currency: 'ILS' }].map((c) => expect.objectContaining(c)));
		expect(JSON.parse(JSON.stringify(x)).summary.value_ILS).toBeGreaterThan(0);
	});
});

describe('deleting a position whole', () => {
	it('takes its events, its dividends and corrections; the rest of the portfolio and single deletes stay guarded', () => {
		const s = setup();
		const a = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100 }, NOW);
		addEvent(s.app, s.market, { positionId: a.positionId, kind: 'note', date: '2026-01-06', note: 'x' }, NOW);
		editEvent(s.app, s.market, a.eventId, { qty: 11 }, NOW);
		addCash(s.app, s.market, s.p.id, { kind: 'dividend', date: '2026-03-10', amount: 11, currency: 'USD', positionId: a.positionId }, NOW);
		addCash(s.app, s.market, s.p.id, { kind: 'deposit', date: '2026-01-05', amount: 5000, currency: 'ILS' }, NOW);
		const b = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.il, kind: 'buy', date: '2026-01-05', qty: 1, price: 5000 }, NOW);
		const r = deletePosition(s.app, s.market, a.positionId);
		expect([r.symbol, r.events, r.cash]).toEqual(['UUU', 2, 1]);
		expect(positionView(s.app, s.market, a.positionId)).toBeNull();
		expect(positionView(s.app, s.market, b.positionId)).not.toBeNull();
		expect((s.app.prepare('select count(*) as n from cash_events').get() as { n: number }).n).toBe(1);
		expect((s.app.prepare('select count(*) as n from event_edits').get() as { n: number }).n).toBe(0);
		expect((s.app.prepare('select count(*) as n from portfolio_purge').get() as { n: number }).n).toBe(0);
		expect(() => s.app.prepare('delete from position_events where id = ?').run(b.eventId)).toThrow(/never deleted/);
	});
});

describe('deleting a portfolio whole', () => {
	it('needs the name typed back; takes positions, events and money; other portfolios and single-event deletes stay guarded', () => {
		const s = setup();
		const other = createPortfolio(s.app, { name: 'Другой', currency: 'USD' });
		addEvent(s.app, s.market, { portfolioId: other.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 1, price: 100 }, NOW);
		addCash(s.app, s.market, s.p.id, { kind: 'deposit', date: '2026-01-05', amount: 100 }, NOW);
		const { eventId } = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 1, price: 100 }, NOW);
		reverseEvent(s.app, s.market, eventId, '', NOW);
		expect(() => deletePortfolio(s.app, s.p.id, 'мой')).toThrow(/Наберите название/);
		const tags: string[] = [];
		const r = deletePortfolio(s.app, s.p.id, ' Мой ', (t) => (tags.push(t), 'copy.db'));
		expect(r).toEqual({ name: 'Мой', positions: 1, events: 2, cash: 1, backup: 'copy.db' });
		expect(tags).toEqual([`before-delete-portfolio-${s.p.id}`]);
		expect(listPortfolios(s.app).map((p) => p.name)).toEqual(['Другой']);
		const left = s.app.prepare('select id from position_events').get() as { id: number };
		expect(() => s.app.prepare('delete from position_events where id = ?').run(left.id)).toThrow(/never deleted/);
		expect((s.app.prepare('select count(*) as n from portfolio_purge').get() as { n: number }).n).toBe(0);
	});
});

describe('automatic portfolio of a source (section 18)', () => {
	it('buys each rise hypothesis of the three types for 3 000 $ in its dollar portfolio, sells it when it closes, takes dividends; «down» and news stay out', () => {
		const s = setup();
		const src = (s.app.prepare(`select id from sources where name = ?`).get("Barron's") as { id: number }).id;
		const art = (s.app.prepare(`insert into articles (source_id, read_at) values (?, '2026-01-05') returning id`).get(src) as { id: number }).id;
		const hyp = s.app.prepare(
			`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction, direction_source,
			   thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol, entry_price, entry_price_date)
			 values (?, ?, 'UUU', 'U Corp', 'NASDAQ', 'USD', 'USD', ?, ?, 'article', 't', 'i', '2026-04-01', 'article', '2026-01-05', 1, 'SPX', 100, '2026-01-05') returning id`
		);
		const closedOne = (hyp.get(art, s.us, 'recommendation', 'long') as { id: number }).id;
		const openOne = (hyp.get(art, s.us, 'target', 'long') as { id: number }).id;
		hyp.get(art, s.us, 'recommendation', 'short');
		hyp.get(art, s.us, 'news', 'long');
		s.app.prepare(`update hypotheses set status = 'closed', exit_date = '2026-04-01', exit_price = 120, return_pct = 20, outcome = 'hit' where id = ?`).run(closedOne);

		const ports = setAuto(s.app, s.market, src, true, NOW);
		expect(ports.map((p) => [p.kind, p.currency, p.auto_source_id, p.auto_amount_ils])).toEqual([['virtual', 'USD', src, 3000]]);
		const v = portfolioView(s.app, s.market, ports[0].id, '2026-04-30')!;
		expect(v.positions).toHaveLength(2);
		const closed = v.positions.find((x) => x.hypotheses.includes(closedOne))!;
		expect(closed.stage).toBe('closed');
		// 3 000 $ at 100 $ → 30 shares; sold at 120 $
		const q = 30;
		expect(closed.realized).toBeCloseTo(q * 20, 6);
		expect(closed.realizedPc).toBeCloseTo(q * 20, 6);
		// the price return of the position equals the hypothesis's (20%); the dividend comes as money
		expect((closed.realized / (q * 100)) * 100).toBeCloseTo(20, 6);
		const cash = s.app.prepare(`select count(*) as n from cash_events where kind = 'dividend' and auto = 1`).get() as { n: number };
		expect(cash.n).toBe(2);
		expect(v.positions.find((x) => x.hypotheses.includes(openOne))!.stage).toBe('holding');
		// idempotent
		expect(syncAuto(s.app, s.market, NOW)).toEqual({ carried: 0, bought: 0, sold: 0, dividends: 0, reversed: 0 });
	});
});

describe('live quotes in the portfolio (owner 19.11.2026)', () => {
	it('a quote newer than the last close prices the position; an older one is ignored; the live dollar is today’s rate', () => {
		const s = setup();
		const { positionId } = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100 }, NOW);
		const put = s.market.prepare(`insert or replace into market_quotes (key, security_id, price, prev_close, currency, market_time, fetched_at, provider_code) values (?, ?, ?, ?, 'USD', ?, ?, 'yahoo')`);
		const now = new Date().toISOString();
		put.run(`sec:${s.us}`, s.us, 125, 110, now, now);
		put.run('fx:USD/ILS', null, 3.9, 3.8, now, now);
		// the app's «today» is Israel's: at night the UTC date is still yesterday
		const today = israelDate();
		let v = positionView(s.app, s.market, positionId, today)!;
		expect(v.position.lastPrice).toBe(125);
		expect(v.position.livePrice).toBe(true);
		expect(v.position.valuePc).toBeCloseTo(10 * 125 * 3.9, 6);
		// a quote older than the last close is not used
		put.run(`sec:${s.us}`, s.us, 99, 98, '2026-04-01T15:00:00Z', now);
		v = positionView(s.app, s.market, positionId, today)!;
		expect(v.position.lastPrice).toBe(110);
		expect(v.position.livePrice).toBe(false);
	});
});

describe('the day change (T-019)', () => {
	it('the last close against the one before, with the rate of each day for a dollar share; the portfolio sums it', () => {
		const s = setup();
		addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, fee: 0 }, NOW);
		addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.il, kind: 'buy', date: '2026-01-05', qty: 100, price: 5000, fee: 0 }, NOW);
		const v = portfolioView(s.app, s.market, s.p.id, '2026-04-30')!;
		const us = v.positions.find((p) => p.symbol === 'UUU')!;
		const il = v.positions.find((p) => p.symbol === 'AAA')!;
		// no quote: 110 against 120, the dollar 3.8 against 3.7, dated by the last close
		expect(us.dayPct).toBeCloseTo((110 / 120 - 1) * 100, 6);
		expect(us.dayPc).toBeCloseTo(10 * (110 * 3.8 - 120 * 3.7), 6);
		expect(us.dayDate).toBe('2026-04-30');
		// agorot: 6500 against 7000 for 100 shares
		expect(il.dayPc).toBeCloseTo(100 * 0.01 * (6500 - 7000), 6);
		const day = v.summary.day!;
		// dollars kept in the shekel portfolio move with the rate too (here −1 000 $ spent on the share)
		const usd = v.summary.balances.find((b) => b.currency === 'USD')!.amount;
		expect(usd).toBeCloseTo(-1000, 6);
		expect(day.money).toBeCloseTo(us.dayPc! + il.dayPc! + usd * (3.8 - 3.7), 6);
		expect(day.date).toBe('2026-04-30');
		expect(day.pct).toBeLessThan(0);
	});

	it('a live quote against its own previous close', () => {
		const s = setup();
		addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, fee: 0 }, NOW);
		s.market
			.prepare(`insert into market_quotes (key, security_id, price, prev_close, currency, market_time, fetched_at, provider_code) values (?, ?, 112, 110, 'USD', ?, ?, 'yahoo')`)
			.run(`sec:${s.us}`, s.us, new Date().toISOString(), new Date().toISOString());
		const us = portfolioView(s.app, s.market, s.p.id)!.positions.find((p) => p.symbol === 'UUU')!;
		expect(us.dayPct).toBeCloseTo((112 / 110 - 1) * 100, 6);
		expect(us.dayPc).toBeCloseTo(10 * (112 - 110) * 3.8, 6);
	});
});

describe('the report (owner\'s request 20.11.2026)', async () => {
	const { portfolioReport } = await import('./report.js');
	it('months: the return and the gain split into realized, dividends, costs and the rest; flows apart', () => {
		const s = setup();
		const usd = createPortfolio(s.app, { name: 'USD', kind: 'real', currency: 'USD' });
		addCash(s.app, s.market, usd.id, { kind: 'deposit', date: '2026-01-05', amount: 2000, currency: 'USD' }, NOW);
		addEvent(s.app, s.market, { portfolioId: usd.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, fee: 0 }, NOW);
		addEvent(s.app, s.market, { portfolioId: usd.id, securityId: s.us, kind: 'sell', date: '2026-04-01', qty: 4, price: 120, fee: 0 }, NOW);
		const r = portfolioReport(s.app, s.market, usd.id, '2026-04-30')!;
		expect(r.months.map((x) => x.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
		const jan = r.months[0];
		expect(jan.flows).toBe(2000);
		const apr = r.months[3];
		// the sale: 4 × (120 − 100) realized in April
		expect(apr.realized).toBeCloseTo(80, 6);
		for (const x of r.months) expect(x.realized + x.dividends - x.costs + x.unrealized).toBeCloseTo(x.gain, 6);
		// the months chain to the whole return
		const chained = r.months.reduce((g, x) => g * (1 + (x.pct ?? 0) / 100), 1);
		expect((chained - 1) * 100).toBeCloseTo(r.total.pct!, 1);
	});

	it('closed trades: each sale against the market over the same days, what came after', () => {
		const s = setup();
		const usd = createPortfolio(s.app, { name: 'USD', kind: 'real', currency: 'USD' });
		addEvent(s.app, s.market, { portfolioId: usd.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, fee: 0 }, NOW);
		addEvent(s.app, s.market, { portfolioId: usd.id, securityId: s.us, kind: 'sell', date: '2026-04-01', qty: 4, price: 120, fee: 0 }, NOW);
		const r = portfolioReport(s.app, s.market, usd.id, '2026-04-30')!;
		expect(r.trades).toHaveLength(1);
		expect(r.trades[0]).toMatchObject({ symbol: 'UUU', qty: 4, returnPct: 20, profitPc: 80, kind: 'own', days: 86 });
		// the price now 110 against the sale's 120
		expect(r.trades[0].afterPct).toBeCloseTo((110 / 120 - 1) * 100, 1);
		expect(r.summary).toMatchObject({ n: 1, wins: 1, profitPc: 80 });
	});
});

describe('a model\'s automatic portfolios (T-012)', () => {
	it('the fee on every trade, «hold if chosen again» carries the position, variant C keeps a second portfolio without the rule, the tax of the year', () => {
		const s = setup();
		const src = Number(s.app.prepare(`insert into sources (name, kind, market) values ('Квартальная схема — оценка', 'model', 'any')`).run().lastInsertRowid);
		s.app.prepare(`insert into model_versions (variant, params, source_id) values ('C', '{}', ?)`).run(src);
		const art = (s.app.prepare(`insert into articles (source_id, read_at) values (?, '2026-01-05') returning id`).get(src) as { id: number }).id;
		const hyp = s.app.prepare(
			`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction, direction_source,
			   thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol, entry_price, entry_price_date)
			 values (?, ?, 'UUU', 'U Corp', 'NASDAQ', 'USD', 'USD', 'recommendation', 'long', 'article', 't', 'i', ?, 'article', ?, 1, 'SPX', ?, ?) returning id`
		);
		const q1 = (hyp.get(art, s.us, '2026-03-31', '2026-01-05', 100, '2026-01-05') as { id: number }).id;
		s.app.prepare(`update hypotheses set status = 'closed', exit_date = '2026-04-01', exit_price = 120, return_pct = 20, outcome = 'hit' where id = ?`).run(q1);
		// the next quarter is not recorded yet: the sale waits
		const early = new Date('2026-04-02T09:00:00Z');
		const ports = setAuto(s.app, s.market, src, true, early);
		expect(ports.map((p) => [p.currency, p.auto_hold])).toEqual([['USD', 1], ['USD', 0]]);
		const [withRule, without] = ports;
		const sells = () => s.app.prepare(`select f.auto_hold as hold, count(*) as n from position_events e join positions p on p.id = e.position_id join portfolios f on f.id = p.portfolio_id where e.kind = 'sell' group by 1`).all();
		expect(sells()).toEqual([]);
		// the fee of a purchase: 0,1% of 3 000 $ is 3 $ — the minimum 5 $
		expect(s.app.prepare(`select distinct fee from position_events where kind = 'buy'`).all()).toEqual([{ fee: 5 }]);
		// Q2 chooses the same share again
		const q2 = (hyp.get(art, s.us, '2026-06-30', '2026-04-01', 120, '2026-04-01') as { id: number }).id;
		const r = syncAuto(s.app, s.market, NOW);
		expect(r.carried).toBe(1);
		// with the rule: one position, one purchase, no sale; it now serves the Q2 hypothesis
		const vh = portfolioView(s.app, s.market, withRule.id, '2026-04-30')!;
		expect(vh.positions).toHaveLength(1);
		expect(vh.positions[0].hypotheses).toEqual(expect.arrayContaining([q1]));
		expect(s.app.prepare('select hypothesis_id as h, from_hypothesis_id as f from auto_carries').all()).toEqual([{ h: q2, f: q1 }]);
		// without: sold at 120 (fee 5 $) and bought again (fee 5 $)
		expect(sells()).toEqual([{ hold: 0, n: 1 }]);
		const vn = portfolioView(s.app, s.market, without.id, '2026-04-30')!;
		expect(vn.positions).toHaveLength(2);
		// the tax of the current year is accrued: 25% of 30 × 20 $ − the two fees
		const tax = (id: number) => (s.app.prepare('select tax_accrued as t from portfolios where id = ?').get(id) as { t: number | null }).t;
		expect(tax(without.id)).toBeCloseTo(0.25 * (600 - 10), 2);
		expect(tax(withRule.id)).toBeNull();
		// a year later: the 2026 tax is a money record on 31 December, once
		syncAuto(s.app, s.market, new Date('2027-01-10T09:00:00Z'));
		syncAuto(s.app, s.market, new Date('2027-01-11T09:00:00Z'));
		expect(s.app.prepare(`select portfolio_id as p, date, amount from cash_events where kind = 'tax'`).all()).toEqual([{ p: without.id, date: '2026-12-31', amount: 147.5 }]);
		expect(tax(without.id)).toBeNull();
	});
});
