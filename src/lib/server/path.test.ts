import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { benchmarkId } from './portfolio.js';
import { flagsFor, monthEnds, periods, securityPath, trSeries, type Pt } from './path.js';
import { concentration, ladder, monthlyReturns, mosaic } from '../path.js';

/** daily closes from `start` for each year's growth, spread evenly over its days */
function yearly(growths: number[], start = '2023-11-26') {
	const out: Pt[] = [];
	let v = 100;
	let d = new Date(start + 'T12:00:00Z');
	out.push({ date: start, v });
	for (const g of growths) {
		const end = new Date(d);
		end.setUTCFullYear(end.getUTCFullYear() + 1);
		const n = Math.round((end.getTime() - d.getTime()) / 86_400_000);
		const k = (1 + g) ** (1 / n);
		for (let i = 0; i < n; i++) {
			d = new Date(d.getTime() + 86_400_000);
			v *= k;
			out.push({ date: d.toISOString().slice(0, 10), v });
		}
	}
	return out;
}

function market(series: Pt[], index: Pt[] = series.map((p) => ({ date: p.date, v: 1000 }))) {
	const app = openApp(':memory:').sqlite;
	const m = openMarket(':memory:').sqlite;
	const id = (m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'XYZ', 'XYZ', 'USD', 'USD', 'xyz') returning id`).get() as { id: number }).id;
	const put = m.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	const spx = benchmarkId(m, 'benchmark:SPX')!;
	for (const p of series) put.run(id, p.date, p.v, p.v, p.v);
	for (const p of index) put.run(spx, p.date, p.v, p.v, p.v);
	return { app, m, id };
}

describe('T-033: the path of the return', () => {
	it('+48%, +25%, 0%: +85% over 3 years, 22.8% a year, the ladder +48 / +37 / 0, the mark «выдыхается»', () => {
		const s = yearly([0.48, 0.25, 0]);
		const per = periods(s, []);
		const y3 = per.find((x) => x.key === '3y')!;
		expect(y3.ret).toBeCloseTo(0.85, 6);
		expect(y3.perYear).toBeCloseTo(0.228, 3);
		expect(per.find((x) => x.key === '1y')!.ret).toBeCloseTo(0, 6);
		// the ladder by years of the period: the 3 steps add up to the total
		const pts = monthEnds(s, []);
		const l = ladder(
			[
				{ m: '2020-12', v: 100, b: null },
				{ m: '2021-06', v: 120, b: null },
				{ m: '2021-12', v: 148, b: null },
				{ m: '2022-12', v: 185, b: null },
				{ m: '2023-12', v: 185, b: null }
			],
			'2021-01',
			'year'
		)!;
		expect(l.steps.map((x) => Math.round(x.contribution * 100))).toEqual([48, 37, 0]);
		expect(l.total).toBeCloseTo(0.85, 6);
		// the product of the mosaic's year totals is the total of the months
		const rets = monthlyReturns(pts);
		const rows = mosaic(rets, 'month', false);
		expect(rows.reduce((g, r) => g * (1 + r.total!), 1)).toBeCloseTo(rets.reduce((g, r) => g * (1 + r.r), 1), 10);
		const { app, m, id } = market(s);
		expect(flagsFor(app, m, [id])[id]).toEqual(['fading']);
	});

	it('a slow fall and one month of +30%: «отскок»; flat with one +30% month: «всплеск»', () => {
		// −5% a month for 3 years, then +30% in the last month
		const fall: Pt[] = [];
		let v = 100;
		for (let i = 0; i <= 37 * 21; i++) {
			const d = new Date(Date.UTC(2023, 9, 1) + i * 86_400_000 * (30.4 / 21));
			const last = i > 36 * 21;
			v *= last ? 1.3 ** (1 / 21) : 0.95 ** (1 / 21);
			fall.push({ date: d.toISOString().slice(0, 10), v });
		}
		const a = market(fall);
		expect(flagsFor(a.app, a.m, [a.id])[a.id]).toContain('bounce');
		// flat with ±0.5% noise for 3 years and one month of +30% in the middle
		const flat: Pt[] = [];
		v = 100;
		for (let i = 0; i <= 37 * 21; i++) {
			const d = new Date(Date.UTC(2023, 9, 1) + i * 86_400_000 * (30.4 / 21));
			const spike = i > 18 * 21 && i <= 19 * 21;
			v *= spike ? 1.3 ** (1 / 21) : i % 2 ? 1.005 : 1 / 1.005;
			flat.push({ date: d.toISOString().slice(0, 10), v });
		}
		const b = market(flat);
		expect(flagsFor(b.app, b.m, [b.id])[b.id]).toContain('spike');
		const c = concentration(monthlyReturns(monthEnds(flat, [])));
		expect(c.best1).toBeGreaterThan(0.9);
	});

	it('a dividend is reinvested on its ex-date; the block of a security', () => {
		const s: Pt[] = [
			{ date: '2026-01-05', v: 100 },
			{ date: '2026-01-06', v: 98 },
			{ date: '2026-01-07', v: 99 }
		];
		const { app, m, id } = market(s);
		m.prepare(`insert into market_corporate_actions (security_id, kind, ex_date, amount, provider_code) values (?, 'dividend', '2026-01-06', 2, 'test')`).run(id);
		const tr = trSeries(m, id);
		// 98 + 2 = 100: the drop of the ex-date is the dividend, the value does not change
		expect(tr.map((x) => Math.round(x.v * 1e6) / 1e6)).toEqual([1, 1, 1 * (99 / 98)].map((x) => Math.round(x * 1e6) / 1e6));
		const v = securityPath(app, m, id)!;
		expect(v.periods.find((x) => x.key === 'ytd')!.ret).toBeCloseTo(99 / 98 - 1, 6);
		expect(v.periods.find((x) => x.key === '1y')!.ret).toBeNull();
	});
});
