import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { benchmarkId } from './portfolio.js';
import { addEvent, createPortfolio } from './portfolio.js';
import { addEntry, entryForHypothesis, linkEntry, listEntries } from './diary.js';
import { decideBuy, decideOther, decideSell } from './decisions.js';
import { honestReview, periodOf, weekly } from './honest.js';
import { historyOf } from './decisions.js';

const NOW = new Date('2026-05-04T09:00:00Z');

function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search, is_benchmark) values ('NASDAQ', ?, ?, ?, 'USD', 'USD', ?, ?) returning id`);
	const a = (sec.get('stock', 'AAPL', 'Apple', 'aapl', 0) as { id: number }).id;
	const x = (sec.get('stock', 'XOM', 'Exxon', 'xom', 0) as { id: number }).id;
	// the S&P 500 comes with the base's seed
	const spx = benchmarkId(market, 'benchmark:SPX')!;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	for (const [s, p1, p2, p3] of [
		[a, 100, 110, 120],
		[x, 50, 45, 40],
		[spx, 1000, 1020, 1050]
	] as const) {
		px.run(s, '2026-04-01', p1 - 1, p1 + 1, p1);
		px.run(s, '2026-04-15', p2 - 1, p2 + 1, p2);
		px.run(s, '2026-04-30', p3 - 1, p3 + 1, p3);
	}
	return { app, market, a, x, spx };
}

describe('T-032 11д: the honest review', () => {
	it('a purchase against the market, the pause before it, a refusal that avoided a loss', () => {
		const s = setup();
		// an entry about AAPL long before the purchase — the pause
		addEntry(s.app, s.market, { body: 'Смотрю на Apple', links: [{ type: 'security', id: s.a }] }, { at: '2026-03-20T10:00:00.000Z' });
		const p = createPortfolio(s.app, { name: 'Мой', kind: 'real', currency: 'USD' });
		const b = addEvent(s.app, s.market, { portfolioId: p.id, securityId: s.a, kind: 'buy', date: '2026-04-01', qty: 10, price: 100, discipline: true, plan: { thesis: 'сервисы', stop: 90 } }, NOW);
		decideBuy(s.app, s.market, b.eventId, { basis: 'intuition' });
		const sale = addEvent(s.app, s.market, { positionId: b.positionId, kind: 'sell', date: '2026-04-15', qty: 10, price: 110, discipline: true, review: { reason: 'target', followed: true } }, NOW);
		decideSell(s.app, s.market, sale.eventId, { outcome: 'yes' });
		const skip = decideOther(s.app, s.market, { type: 'skip', securityId: s.x, basis: 'consensus', why: '<p>нефть дорогая</p>', reviewDate: '2026-04-30' });
		s.app.prepare(`update decisions set created_at = '2026-04-01T10:00:00.000Z' where id = ?`).run(skip);
		const r = honestReview(s.app, s.market, { from: '0000-01-01', to: '2099-01-01', label: 'всё' }, '2026-04-30');
		const buy = r.buys[0];
		// +10% against the S&P 500 +2% over 1–15 April
		expect([buy.ret, buy.excess, buy.held, buy.closed]).toEqual([10, 8, 14, true]);
		expect(r.byBasis).toEqual([{ key: 'intuition', n: 1, cameTrue: 1, judged: 1, avgExcess: 8, avgHeld: 14 }]);
		expect(buy.pauseDays).toBeGreaterThan(0);
		expect(r.skips).toHaveLength(1);
		expect(r.skips[0].symbol).toBe('XOM');
		expect(r.skips[0].verdict).toBe('avoided');
		expect(r.skips[0].changePct).toBeLessThan(0);
		expect(periodOf('quarter', '2026-05-20')).toMatchObject({ from: '2026-04-01', label: 'Q2 2026' });
	});

	it('the weekly pick: an entry whose security moved more than 10% since it was written', () => {
		const s = setup();
		addEntry(s.app, s.market, { body: 'Exxon дешевеет', links: [{ type: 'security', id: s.x }] }, { at: '2026-04-01T10:00:00.000Z' });
		const w = weekly(s.app, s.market, '2026-04-30');
		expect(w.moved.map((m) => [m.symbol, m.changePct])).toEqual([['XOM', -20]]);
	});

	it('an observation on a hypothesis keeps its assessment; an entry becomes a hypothesis and is linked both ways', () => {
		const s = setup();
		const id = addEntry(s.app, s.market, { kind: 'observation', body: 'Спрос растёт', assessment: 'strengthening', links: [{ type: 'security', id: s.a }] })!;
		expect(listEntries(s.app, s.market, {}).items[0].assessment).toBe('strengthening');
		expect(entryForHypothesis(s.app, id)).toEqual({ id, text: 'Спрос растёт', securityId: s.a });
		const src = (s.app.prepare(`insert into sources (name, kind) values ('Собственная идея', 'own') on conflict(name) do update set kind = 'own' returning id`).get() as { id: number }).id;
		const art = (s.app.prepare(`insert into articles (source_id, read_at) values (?, '2026-04-30') returning id`).get(src) as { id: number }).id;
		const h = (s.app.prepare(`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction, direction_source, thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol) values (?, ?, 'AAPL', 'Apple', 'NASDAQ', 'USD', 'USD', 'opinion', 'long', 'mine', 'Спрос растёт', 'нет', '2026-07-30', 'default', '2026-04-30', ?, 'SPX') returning id`).get(art, s.a, s.spx) as { id: number }).id;
		linkEntry(s.app, id, 'hypothesis', h);
		expect(listEntries(s.app, s.market, { scope: { type: 'hypothesis', id: String(h) } }).items.map((e) => e.id)).toEqual([id]);
		expect(historyOf(s.app, { hypothesisId: h }).items.find((x) => x.entryId === id)?.assessment).toBe('strengthening');
	});
});
