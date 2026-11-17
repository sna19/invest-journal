import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { periodStart, portfolioChart, portfolioSeries, securityChart } from './charts.js';
import { addCash, addEvent, createPortfolio, portfolioView } from './portfolio.js';

const NOW = new Date('2026-05-04T09:00:00Z');

function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const us = (
		market
			.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'UUU', 'U Corp', 'USD', 'USD', 'uuu') returning id`)
			.get() as { id: number }
	).id;
	const spx = (market.prepare(`select security_id as id from ref_provider_symbols where provider_symbol = 'benchmark:SPX'`).get() as { id: number }).id;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	const days = ['2026-01-05', '2026-01-06', '2026-02-02', '2026-03-02', '2026-04-01', '2026-04-30'];
	const u = [100, 101, 105, 110, 120, 110];
	const s = [5000, 5050, 5100, 5000, 5200, 5300];
	days.forEach((d, i) => {
		px.run(us, d, u[i] - 1, u[i] + 1, u[i]);
		px.run(spx, d, s[i] - 10, s[i] + 10, s[i]);
	});
	market.prepare(`insert into market_fx_daily (pair, date, rate, provider_code) values ('USD/ILS', '2026-01-01', 3.5, 'test')`).run();
	// a 2:1 split on 2026-03-15: the table holds the provider's current scale, so a trade before it shows at price / 2
	market.prepare(`insert into market_corporate_actions (security_id, ex_date, kind, ratio, provider_code) values (?, '2026-03-15', 'split', 2, 'test')`).run(us);
	return { app, market, us, spx };
}

describe('charts (section 19)', () => {
	it('period start', () => {
		expect(periodStart('1M', '2026-03-31')).toBe('2026-03-03');
		expect(periodStart('10Y', '2026-11-17')).toBe('2016-11-17');
	});

	it('security: the benchmark starts at the same point; marks at the right dates and prices (trades before a split scaled)', () => {
		const t = setup();
		const src = (t.app.prepare(`select id from sources where name = 'WSJ'`).get() as { id: number }).id;
		const art = (t.app.prepare(`insert into articles (source_id, read_at) values (?, '2026-01-05') returning id`).get(src) as { id: number }).id;
		t.app
			.prepare(
				`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction, direction_source,
				   thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol, entry_price, entry_price_date, status, exit_date, exit_price, outcome)
				 values (?, ?, 'UUU', 'U', 'NASDAQ', 'USD', 'USD', 'recommendation', 'long', 'article', 't', 'i', '2026-04-01', 'article', '2026-01-05', ?, 'SPX', 200, '2026-01-05', 'closed', '2026-04-01', 120, 'hit')`
			)
			.run(art, t.us, t.spx);
		const p = createPortfolio(t.app, { name: 'Мой' });
		addEvent(t.app, t.market, { portfolioId: p.id, securityId: t.us, kind: 'buy', date: '2026-02-02', qty: 5, price: 210, confirm: true }, NOW);
		const c = securityChart(t.app, t.market, t.us, '1Y', '2026-04-30')!;
		expect(c.points).toHaveLength(6);
		expect(c.bench[0]).toEqual({ date: '2026-01-05', value: 100 });
		expect(c.bench.at(-1)!.value).toBeCloseTo(106, 6); // 5300 / 5000 × 100
		expect(c.benchChange).toBeCloseTo(6, 6);
		expect(c.change).toBeCloseTo(10, 6);
		expect(c.markers.map((m) => [m.kind, m.date, m.price])).toEqual([
			['entry', '2026-01-05', 100], // 200 before the 2:1 split → 100 in today's scale
			['buy', '2026-02-02', 105],
			['exit', '2026-04-01', 120]
		]);
		expect(c.markers[0]).toMatchObject({ hypothesisId: 1, sourceId: src });
		// a month back from 30 April starts on 30 March: only the exit of 1 April is in it
		expect(securityChart(t.app, t.market, t.us, '1M', '2026-04-30')!.markers.map((m) => m.kind)).toEqual(['exit']);
	});

	it('portfolio: the daily series ends at the same TWR; benchmarks from its start, the S&P also in shekels', () => {
		const t = setup();
		const p = createPortfolio(t.app, { name: 'Мой' });
		addCash(t.app, t.market, p.id, { kind: 'deposit', date: '2026-01-05', amount: 5000 }, NOW);
		addEvent(t.app, t.market, { portfolioId: p.id, securityId: t.us, kind: 'buy', date: '2026-01-05', qty: 10, price: 200, confirm: true }, NOW);
		addEvent(t.app, t.market, { positionId: 1, kind: 'sell', date: '2026-04-01', qty: 10, price: 120 }, NOW);
		const s = portfolioSeries(t.app, t.market, p.id, '2026-04-30');
		const v = portfolioView(t.app, t.market, p.id, '2026-04-30')!;
		expect(s.points.at(-1)!.value).toBeCloseTo(v.summary.twrPct!, 9);
		const ch = portfolioChart(t.app, t.market, p.id, [], '2026-04-30')!;
		expect(ch.series.map((x) => x.label)).toEqual(['Мой', 'S&P 500', 'S&P 500 в ₪']);
		expect(ch.series[1].points.at(-1)!.value).toBeCloseTo(6, 6);
	});
});
