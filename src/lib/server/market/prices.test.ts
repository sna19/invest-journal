import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from '../db.js';
import { closeEarly, result, updateHypotheses } from '../results.js';
import { HttpError } from './http.js';
import { enqueue, enqueueMissingHistory, findGaps, resetRunning, runQueue } from './history.js';
import { checkPrices, computeFactors, isWeekend, loadSecurity, securitiesForPrices, type Ctx } from './prices.js';
import { ringSecurities, setSetting } from './rings.js';
import type { Fetcher } from './types.js';
import { parseChart } from './yahoo.js';

/** A Yahoo chart answer for given days: [date, close] (+ dividends). */
function chart(symbol: string, unit: string, tz: string, days: [string, number | null][], dividends: [string, number][] = [], splits: [string, number][] = []) {
	// 14:30 UTC — inside the trading day both in New York and in Tel Aviv
	const ts = (d: string) => Math.floor(Date.parse(d + 'T14:30:00Z') / 1000);
	return Buffer.from(
		JSON.stringify({
			chart: {
				result: [
					{
						meta: { symbol, currency: unit, exchangeTimezoneName: tz },
						timestamp: days.map(([d]) => ts(d)),
						indicators: {
							quote: [{ open: days.map(([, c]) => c), high: days.map(([, c]) => c && c * 1.01), low: days.map(([, c]) => c && c * 0.99), close: days.map(([, c]) => c), volume: days.map(() => 1000) }]
						},
						events: {
							dividends: Object.fromEntries(dividends.map(([d, a]) => [ts(d), { date: ts(d), amount: a }])),
							splits: Object.fromEntries(splits.map(([d, r]) => [ts(d), { date: ts(d), numerator: r, denominator: 1, splitRatio: `${r}:1` }]))
						}
					}
				],
				error: null
			}
		})
	);
}

/** Weekdays from a date. */
function weekdays(from: string, n: number) {
	const out: string[] = [];
	for (let t = Date.parse(from + 'T12:00:00Z'); out.length < n; t += 86400000) {
		const d = new Date(t);
		if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
	}
	return out;
}

function setup() {
	const market = openMarket(':memory:');
	const app = openApp(':memory:');
	const add = (symbol: string, exchangeCode: string, unit: string, yahoo: string) => {
		const id = (market.sqlite
			.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values (?, 'stock', ?, ?, ?, ?, ?) returning id`)
			.get(exchangeCode, symbol, symbol, unit === 'USD' ? 'USD' : 'ILS', unit, symbol.toLowerCase()) as { id: number }).id;
		market.sqlite.prepare(`insert into ref_provider_symbols (security_id, provider_code, provider_symbol) values (?, 'yahoo', ?)`).run(id, yahoo);
		return id;
	};
	const ids = {
		spx: (market.sqlite.prepare(`select id from ref_securities where symbol = 'SPX'`).get() as { id: number }).id,
		ta: (market.sqlite.prepare(`select id from ref_securities where symbol = 'TA-125'`).get() as { id: number }).id,
		amat: add('AMAT', 'NASDAQ', 'USD', 'AMAT'),
		lumi: add('LUMI', 'TASE', 'ILA', 'LUMI.TA')
	};
	const answers = new Map<string, Buffer | number>();
	const calls: string[] = [];
	const get: Fetcher = async (url) => {
		const sym = decodeURIComponent(/chart\/([^?]+)/.exec(url)![1]);
		calls.push(sym);
		const a = answers.get(sym);
		if (a === undefined || typeof a === 'number') throw new HttpError(a ?? 404, url);
		return a;
	};
	const ctx: Ctx = { db: market.db, sqlite: market.sqlite, get, rawDir: mkdtempSync(join(tmpdir(), 'raw-')), runId: 0, day: '2026-11-15' };
	ctx.runId = (market.sqlite.prepare(`insert into ops_ingest_runs (job, provider_code) values ('test', 'yahoo') returning id`).get() as { id: number }).id;
	const sec = (id: number) => securitiesForPrices(market.sqlite, [id])[0];
	const count = () => (market.sqlite.prepare('select count(*) as n from market_prices_daily').get() as { n: number }).n;
	return { market, app, ids, answers, calls, ctx, sec, count };
}

describe('parse', () => {
	it('dates in the exchange time zone, empty rows dropped, dividends and splits read', () => {
		const p = parseChart(
			{ name: 'x', body: chart('LUMI.TA', 'ILA', 'Asia/Jerusalem', [['2025-12-04', 7000], ['2025-12-05', null], ['2025-12-08', 7100]], [['2025-12-08', 102]], [['2025-12-04', 2]]) },
			'2025-12-01',
			'2025-12-31'
		);
		expect(p.unit).toBe('ILA');
		expect(p.rows.map((r) => [r.date, r.close])).toEqual([
			['2025-12-04', 7000],
			['2025-12-08', 7100]
		]);
		expect(p.empty).toBe(1);
		expect(p.actions).toEqual(
			expect.arrayContaining([
				{ exDate: '2025-12-08', kind: 'dividend', ratio: null, amount: 102 },
				{ exDate: '2025-12-04', kind: 'split', ratio: 2, amount: null }
			])
		);
	});
});

describe('checks (section 14)', () => {
	const row = (date: string, close: number, o = close, h = close, l = close, v = 1) => ({ date, open: o, high: h, low: l, close, volume: v });
	const opts = { prevClose: 100, actionDates: new Set<string>(), calendar: null, calendarMax: null, calendarName: 'US' };
	it('positive close, volume ≥ 0, no weekend, close inside the day range (US)', () => {
		const { good, issues } = checkPrices(
			[row('2026-01-05', 100), row('2026-01-06', 0), row('2026-01-07', 101, 101, 100, 99), row('2026-01-08', 102, 102, 102, 102, -5), row('2026-01-10', 103), row('2026-01-12', 104)],
			opts
		);
		expect(good.map((r) => r.date)).toEqual(['2026-01-05', '2026-01-12']);
		expect(issues.map((i) => i.rule)).toEqual(['price.not_positive', 'price.ohlc', 'price.volume', 'price.not_trading_day']);
	});
	it('agorot: an older part of the history in shekels (AMPA before 18.05.2026) is brought to agorot', () => {
		const { good, issues, known } = checkPrices(
			[row('2026-05-14', 16.86), row('2026-05-15', 16.67), row('2026-05-18', 1652), row('2026-05-19', 1614)],
			{ ...opts, prevClose: null, calendarName: 'TASE', agorot: true }
		);
		expect(issues).toEqual([]);
		expect(good.map((r) => Math.round(r.close * 100) / 100)).toEqual([1686, 1667, 1652, 1614]);
		expect(known.filter((k) => k.rule === 'price.unit_converted').map((k) => k.date)).toEqual(['2026-05-14', '2026-05-15']);
	});
	it('agorot: a unit switch on a day the price also moves (16.53 shekels → 1757 agorot) is still a unit switch', () => {
		const { good, issues } = checkPrices([row('2026-04-28', 16.53), row('2026-04-29', 1757), row('2026-04-30', 1720)], { ...opts, prevClose: null, calendarName: 'TASE', agorot: true });
		expect(issues).toEqual([]);
		expect(good.map((r) => Math.round(r.close))).toEqual([1653, 1757, 1720]);
	});
	it('agorot: a daily batch in shekels against stored agorot is converted; for USD the same is refused', () => {
		const a = checkPrices([row('2026-02-02', 7.9), row('2026-02-03', 7.95)], { ...opts, prevClose: 787, calendarName: 'TASE', agorot: true });
		expect(a.good.map((r) => Math.round(r.close))).toEqual([790, 795]);
		const u = checkPrices([row('2026-02-02', 7.9)], { ...opts, prevClose: 787 });
		expect(u.issues.map((i) => i.rule)).toEqual(['price.unit_glitch']);
	});
	it('a real level change: the first day waits, the second confirms it; an action day is not a jump', () => {
		const { good, issues } = checkPrices([row('2026-03-02', 200), row('2026-03-03', 205), row('2026-03-04', 400)], { ...opts, actionDates: new Set(['2026-03-04']) });
		expect(good.map((r) => r.date)).toEqual(['2026-03-03', '2026-03-04']);
		expect(issues.map((i) => i.date)).toEqual(['2026-03-02']);
	});
	it('TASE: open outside the range drops the open; close outside it drops the range (closing auction)', () => {
		const t = { ...opts, prevClose: null, calendarName: 'TASE' };
		const a = checkPrices([row('2021-07-27', 450.7, 448.1, 454.8, 450)], t);
		expect(a.good[0]).toMatchObject({ close: 450.7, open: null, high: 454.8 });
		const b = checkPrices([row('2024-09-03', 937.7, 941.6, 920, 920)], t);
		expect(b.issues).toEqual([]);
		expect(b.good[0]).toMatchObject({ close: 937.7, open: null, high: null, low: null });
		expect(b.known.map((k) => k.rule)).toEqual(['price.ohlc_auction']);
	});
	it('TASE weekend: Fri–Sat until 2026, Sat–Sun after', () => {
		expect(isWeekend('TASE', '2025-12-26')).toBe(true); // Friday
		expect(isWeekend('TASE', '2025-12-28')).toBe(false); // Sunday
		expect(isWeekend('TASE', '2026-01-09')).toBe(false); // Friday
		expect(isWeekend('TASE', '2026-01-11')).toBe(true); // Sunday
		expect(isWeekend('US', '2026-01-10')).toBe(true);
	});
});

describe('dividend factors', () => {
	it('CRSP: prices before an ex-date × (1 − D / previous close), cumulative backwards', () => {
		const closes: Record<string, number> = { '2026-03-01': 100, '2026-06-01': 50 };
		const f = computeFactors(
			[
				{ exDate: '2026-03-02', amount: 2 },
				{ exDate: '2026-06-02', amount: 1 }
			],
			(d) => (d === '2026-03-02' ? closes['2026-03-01'] : closes['2026-06-01'])
		);
		expect(f).toEqual([
			{ date: '2026-03-02', factor: (1 - 2 / 100) * (1 - 1 / 50) },
			{ date: '2026-06-02', factor: 1 - 1 / 50 }
		]);
	});
});

describe('loadSecurity', () => {
	it('stores prices, builds the calendar from the benchmark, a rerun adds nothing', async () => {
		const s = setup();
		const days = weekdays('2026-01-05', 20);
		s.answers.set('^GSPC', chart('^GSPC', 'USD', 'America/New_York', days.map((d, i) => [d, 6000 + i])));
		s.answers.set('AMAT', chart('AMAT', 'USD', 'America/New_York', days.map((d, i) => [d, 200 + i]), [[days[10], 0.46]]));
		const b = await loadSecurity(s.ctx, s.sec(s.ids.spx), days[0], days.at(-1)!);
		const a = await loadSecurity(s.ctx, s.sec(s.ids.amat), days[0], days.at(-1)!);
		expect([b.added, a.added]).toEqual([20, 20]);
		expect((s.market.sqlite.prepare(`select count(*) as n from ref_trading_days where exchange_code = 'US'`).get() as { n: number }).n).toBe(20);
		const factor = s.market.sqlite.prepare('select * from market_adjustment_factors').all();
		expect(factor).toEqual([{ security_id: s.ids.amat, date: days[10], factor: 1 - 0.46 / 209 }]);
		const n = s.count();
		const again = await loadSecurity(s.ctx, s.sec(s.ids.amat), days[0], days.at(-1)!);
		expect(again).toMatchObject({ added: 0, updated: 0 });
		expect(s.count()).toBe(n);
		const adj = s.market.sqlite.prepare('select adj_close from market_prices_adjusted where security_id = ? and date = ?');
		expect((adj.get(s.ids.amat, days[9]) as { adj_close: number }).adj_close).toBeCloseTo(209 * (1 - 0.46 / 209), 9);
		expect((adj.get(s.ids.amat, days[10]) as { adj_close: number }).adj_close).toBe(210);
	});

	it('an unknown security is «нет цен»; a wrong unit is refused once prices exist, adopted before', async () => {
		const s = setup();
		expect((await loadSecurity(s.ctx, s.sec(s.ids.amat), '2026-01-01', '2026-01-31')).status).toBe('none');
		expect((s.market.sqlite.prepare('select price_status as p from ref_securities where id = ?').get(s.ids.amat) as { p: string }).p).toBe('none');
		// TASE share quoted in shekels instead of agorot: adopted while there are no prices yet
		s.answers.set('LUMI.TA', chart('LUMI.TA', 'ILS', 'Asia/Jerusalem', [['2026-01-05', 70]]));
		expect((await loadSecurity(s.ctx, s.sec(s.ids.lumi), '2026-01-01', '2026-01-31')).status).toBe('ok');
		expect((s.market.sqlite.prepare('select price_unit as u from ref_securities where id = ?').get(s.ids.lumi) as { u: string }).u).toBe('ILS');
		// …then the provider switches to agorot: refused, an open issue
		s.answers.set('LUMI.TA', chart('LUMI.TA', 'ILA', 'Asia/Jerusalem', [['2026-01-06', 7000]]));
		const r = await loadSecurity(s.ctx, s.sec(s.ids.lumi), '2026-01-06', '2026-01-31');
		expect(r).toMatchObject({ status: 'error', added: 0 });
		expect(s.market.sqlite.prepare(`select rule, status from ops_quality_issues where rule like 'price.unit%' order by id`).all()).toEqual([
			{ rule: 'price.unit_adopted', status: 'resolved' },
			{ rule: 'price.unit_mismatch', status: 'open' }
		]);
	});

	it('a new split after prices exist asks for a full reload', async () => {
		const s = setup();
		const days = weekdays('2026-02-02', 10);
		s.answers.set('AMAT', chart('AMAT', 'USD', 'America/New_York', days.slice(0, 5).map((d) => [d, 100])));
		await loadSecurity(s.ctx, s.sec(s.ids.amat), days[0], days[4]);
		s.answers.set('AMAT', chart('AMAT', 'USD', 'America/New_York', days.slice(5).map((d) => [d, 50]), [], [[days[5], 2]]));
		expect((await loadSecurity(s.ctx, s.sec(s.ids.amat), days[5], days[9])).newSplit).toBe(true);
	});
});

describe('history queue', () => {
	it('benchmarks first; an interrupted load goes on from where it stopped; ring 1 only', async () => {
		const s = setup();
		const days = weekdays('2026-01-05', 10);
		for (const [sym, unit, tz] of [
			['^GSPC', 'USD', 'America/New_York'],
			['^TA125.TA', 'ILS', 'Asia/Jerusalem'],
			['AMAT', 'USD', 'America/New_York'],
			['LUMI.TA', 'ILA', 'Asia/Jerusalem']
		])
			s.answers.set(sym, chart(sym, unit, tz, days.map((d) => [d, 100])));
		// a hypothesis on AMAT puts it in ring 1; LUMI has none
		s.app.sqlite.exec(`insert into articles (id, source_id, read_at) values (1, 1, '2026-01-05')`);
		s.app.sqlite
			.prepare(
				`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction,
				   direction_source, thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol)
				 values (1, ?, 'AMAT', 'AMAT', 'NASDAQ', 'USD', 'USD', 'recommendation', 'long', 'article', 't', 'i', '2026-12-01', 'article', '2026-01-05', ?, 'SPX')`
			)
			.run(s.ids.amat, s.ids.spx);
		const ids = ringSecurities(s.market.sqlite, s.app.sqlite);
		expect(ids.sort()).toEqual([s.ids.spx, s.ids.ta, s.ids.amat].sort());
		expect(enqueueMissingHistory(s.market.sqlite, ids, '2026-01-16')).toBe(3);
		expect(enqueueMissingHistory(s.market.sqlite, ids, '2026-01-16')).toBe(0); // no duplicates

		// «killed» after the first task, which stays «running»
		const first = await runQueue(s.ctx, { stopAfter: 1 });
		expect(first.done).toBe(1);
		expect(s.calls).toEqual(['^GSPC']);
		s.market.sqlite.prepare(`update ops_ingest_tasks set status = 'running' where id = (select max(id) from ops_ingest_tasks)`).run();
		expect(resetRunning(s.market.sqlite)).toBe(1);
		const rest = await runQueue(s.ctx);
		expect(rest.done).toBe(2);
		expect(s.calls.slice(1).sort()).toEqual(['AMAT', '^TA125.TA'].sort());
		expect(s.count()).toBe(30);
		expect(s.calls).not.toContain('LUMI.TA');

		// ring 3 adds every active security
		setSetting(s.market.sqlite, 'ring', '3');
		expect(ringSecurities(s.market.sqlite, s.app.sqlite)).toContain(s.ids.lumi);
	});

	it('gap control queues the missing trading days', async () => {
		const s = setup();
		const days = weekdays('2026-03-02', 10);
		s.answers.set('^GSPC', chart('^GSPC', 'USD', 'America/New_York', days.map((d) => [d, 100])));
		s.answers.set('AMAT', chart('AMAT', 'USD', 'America/New_York', days.filter((_, i) => i !== 4 && i !== 6).map((d) => [d, 100])));
		await loadSecurity(s.ctx, s.sec(s.ids.spx), days[0], days[9]);
		await loadSecurity(s.ctx, s.sec(s.ids.amat), days[0], days[9]);
		expect(findGaps(s.market.sqlite, [s.ids.spx, s.ids.amat])).toBe(1);
		expect(s.market.sqlite.prepare(`select security_id, period_from, period_to from ops_ingest_tasks`).all()).toEqual([
			{ security_id: s.ids.amat, period_from: days[4], period_to: days[6] }
		]);
		enqueue(s.market.sqlite, s.ids.amat, days[4], days[6]);
		expect((s.market.sqlite.prepare('select count(*) as n from ops_ingest_tasks').get() as { n: number }).n).toBe(1);
		// the provider has no prices for those days either: they become «price.missing» and are not queued again
		await runQueue(s.ctx);
		expect(s.market.sqlite.prepare(`select date, status from ops_quality_issues where rule = 'price.missing' order by date`).all()).toEqual([{ date: days[4], status: 'known' }, { date: days[6], status: 'known' }]);
		expect(findGaps(s.market.sqlite, [s.ids.amat])).toBe(0);
	});
});

describe('hypotheses (section 6)', () => {
	it('result: excess over the benchmark; for «down» both signs change', () => {
		const p = (adj: number) => ({ date: 'x', close: adj, adj });
		expect(result('long', { s: p(100), b: p(1000) }, { s: p(110), b: p(1050) })).toEqual({ returnPct: 10, benchmarkReturnPct: 5, excessPct: 5 });
		expect(result('short', { s: p(100), b: p(1000) }, { s: p(90), b: p(1050) })).toEqual({ returnPct: 10, benchmarkReturnPct: -5, excessPct: 15 });
	});

	it('entry on the first trading day from the record, closing at the horizon, early close with a reason', async () => {
		const s = setup();
		const days = weekdays('2026-04-01', 60);
		s.answers.set('^GSPC', chart('^GSPC', 'USD', 'America/New_York', days.map((d, i) => [d, 5000 + i * 10])));
		s.answers.set('AMAT', chart('AMAT', 'USD', 'America/New_York', days.map((d, i) => [d, 100 + i])));
		await loadSecurity(s.ctx, s.sec(s.ids.spx), days[0], days.at(-1)!);
		await loadSecurity(s.ctx, s.sec(s.ids.amat), days[0], days.at(-1)!);
		s.app.sqlite.exec(`insert into articles (id, source_id, read_at) values (1, 1, '2026-04-04')`);
		const ins = s.app.sqlite.prepare(
			`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction,
			   direction_source, thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol)
			 values (1, ?, 'AMAT', 'AMAT', 'NASDAQ', 'USD', 'USD', 'recommendation', ?, 'article', 't', 'i', ?, 'article', ?, ?, 'SPX') returning id`
		);
		// recorded on Saturday 2026-04-04 → entry Monday 04-06 (days[3]); horizon Sunday 05-03 → exit Friday 05-01 (days[22])
		const a = (ins.get(s.ids.amat, 'long', '2026-05-03', '2026-04-04', s.ids.spx) as { id: number }).id;
		const b = (ins.get(s.ids.amat, 'short', '2026-12-31', '2026-04-04', s.ids.spx) as { id: number }).id;
		const sum = updateHypotheses(s.app.sqlite, s.market.sqlite, new Date('2026-06-24T10:00:00Z'));
		expect(sum).toMatchObject({ entries: 2, closed: 1, updated: 1 });
		const h = (id: number) => s.app.sqlite.prepare('select * from hypotheses where id = ?').get(id) as Record<string, unknown>;
		expect(days[3]).toBe('2026-04-06');
		expect(days[22]).toBe('2026-05-01');
		const ra = h(a);
		expect(ra).toMatchObject({ status: 'closed', entry_price_date: '2026-04-06', entry_price: 103, benchmark_entry: 5030, exit_date: '2026-05-01', exit_price: 122, benchmark_exit: 5220, outcome: 'hit' });
		const manual = { r: (122 / 103 - 1) * 100, rb: (5220 / 5030 - 1) * 100 };
		expect(ra.return_pct).toBeCloseTo(manual.r, 3);
		expect(ra.excess_pct).toBeCloseTo(manual.r - manual.rb, 3);
		// a closed result never changes, even if prices are corrected later
		expect(() => s.app.sqlite.prepare('update hypotheses set excess_pct = 0 where id = ?').run(a)).toThrow(/locked/);
		// the open «down» one has its current result; then an early close with a reason
		expect(h(b).current_excess_pct).toBeLessThan(0);
		expect(closeEarly(s.app.sqlite, s.market.sqlite, b, '', new Date('2026-06-24T10:00:00Z'))).toMatchObject({ error: expect.any(String) });
		const ce = closeEarly(s.app.sqlite, s.market.sqlite, b, 'Тезис больше не актуален', new Date('2026-06-24T10:00:00Z'));
		expect(ce).toMatchObject({ ok: true, exitDate: days.at(-1) });
		expect(h(b)).toMatchObject({ status: 'closed_early', close_reason: 'Тезис больше не актуален', outcome: 'miss' });
	});

	it('does not close while an unconfirmed jump of the security lies in the term', async () => {
		const s = setup();
		const days = weekdays('2026-04-01', 40);
		s.answers.set('^GSPC', chart('^GSPC', 'USD', 'America/New_York', days.map((d) => [d, 5000])));
		s.answers.set('AMAT', chart('AMAT', 'USD', 'America/New_York', days.map((d, i) => [d, i === 10 ? 300 : 100])));
		await loadSecurity(s.ctx, s.sec(s.ids.spx), days[0], days.at(-1)!);
		await loadSecurity(s.ctx, s.sec(s.ids.amat), days[0], days.at(-1)!);
		s.app.sqlite.exec(`insert into articles (id, source_id, read_at) values (1, 1, '2026-04-01')`);
		s.app.sqlite
			.prepare(
				`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction,
				   direction_source, thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol)
				 values (1, ?, 'AMAT', 'AMAT', 'NASDAQ', 'USD', 'USD', 'recommendation', 'long', 'article', 't', 'i', ?, 'article', '2026-04-01', ?, 'SPX')`
			)
			.run(s.ids.amat, days[30], s.ids.spx);
		const r = updateHypotheses(s.app.sqlite, s.market.sqlite, new Date('2026-07-01T10:00:00Z'));
		expect(r.closed).toBe(0);
		expect(r.waiting[0].why).toMatch(/проблема качества/);
	});

	it('does not close on incomplete data: the security misses the last days before the horizon', async () => {
		const s = setup();
		const days = weekdays('2026-04-01', 30);
		s.answers.set('^GSPC', chart('^GSPC', 'USD', 'America/New_York', days.map((d) => [d, 5000])));
		s.answers.set('AMAT', chart('AMAT', 'USD', 'America/New_York', days.slice(0, 15).map((d) => [d, 100])));
		await loadSecurity(s.ctx, s.sec(s.ids.spx), days[0], days.at(-1)!);
		await loadSecurity(s.ctx, s.sec(s.ids.amat), days[0], days.at(-1)!);
		s.app.sqlite.exec(`insert into articles (id, source_id, read_at) values (1, 1, '2026-04-01')`);
		s.app.sqlite
			.prepare(
				`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction,
				   direction_source, thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol)
				 values (1, ?, 'AMAT', 'AMAT', 'NASDAQ', 'USD', 'USD', 'recommendation', 'long', 'article', 't', 'i', ?, 'article', '2026-04-01', ?, 'SPX')`
			)
			.run(s.ids.amat, days[25], s.ids.spx);
		const r = updateHypotheses(s.app.sqlite, s.market.sqlite, new Date('2026-06-01T10:00:00Z'));
		expect(r.closed).toBe(0);
		expect(r.waiting[0].why).toMatch(/нет цены бумаги/);
	});
});
