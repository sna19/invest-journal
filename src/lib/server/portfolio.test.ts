import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { InputError, LockedError } from './journal.js';
import {
	addCash,
	addEvent,
	cancelEvent,
	ConfirmError,
	createPortfolio,
	deletePortfolio,
	listPortfolios,
	portfolioView,
	positionView,
	reverseEvent,
	setAuto,
	syncAuto
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

	it('the database refuses to change or delete an event', () => {
		const s = setup();
		const { eventId } = addEvent(s.app, s.market, { portfolioId: s.p.id, securityId: s.us, kind: 'buy', date: '2026-01-05', qty: 1, price: 100 }, NOW);
		expect(() => s.app.prepare('update position_events set qty = 2 where id = ?').run(eventId)).toThrow(/cannot change/);
		expect(() => s.app.prepare('delete from position_events where id = ?').run(eventId)).toThrow(/never deleted/);
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
		expect(syncAuto(s.app, s.market, NOW)).toEqual({ bought: 0, sold: 0, dividends: 0, reversed: 0 });
	});
});
