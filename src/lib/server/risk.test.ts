import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addCash, addEvent, createPortfolio } from './portfolio.js';
import { riskView, setSetting } from './risk.js';
import { whatIf } from '../risk.js';

const TODAY = '2026-11-20';

/** daily closes for two years: semis move together (SOXX, NVDA, SOXL ×3), KO alone, IEF calm and against stocks */
function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search, active) values (?, ?, ?, ?, 'USD', 'USD', ?, 1) returning id`);
	const ids: Record<string, number> = {};
	for (const [sym, type] of [['SOXX', 'etf'], ['NVDA', 'stock'], ['KO', 'stock'], ['AMAT', 'stock'], ['SOXL', 'etf'], ['IEF', 'etf']] as const)
		ids[sym] = (sec.get('NASDAQ', type, sym, sym, sym.toLowerCase()) as { id: number }).id;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	let seed = 3;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
	const p: Record<string, number> = { SOXX: 200, NVDA: 100, KO: 60, AMAT: 150, SOXL: 30, IEF: 95 };
	market.transaction(() => {
		for (let d = Date.parse('2024-10-01'); d <= Date.parse(TODAY); d += 86_400_000) {
			const day = new Date(d).getUTCDay();
			if (day === 0 || day === 6) continue;
			const date = new Date(d).toISOString().slice(0, 10);
			const chips = rnd() * 0.03;
			const mkt = rnd() * 0.01;
			const r: Record<string, number> = {
				SOXX: chips + mkt,
				NVDA: chips * 1.2 + mkt + rnd() * 0.01,
				AMAT: chips + mkt + rnd() * 0.008,
				SOXL: 3 * (chips + mkt),
				KO: mkt * 0.5 + rnd() * 0.012,
				IEF: -mkt * 0.3 + rnd() * 0.003
			};
			for (const k of Object.keys(p)) {
				p[k] *= 1 + r[k];
				px.run(ids[k], date, p[k], p[k], p[k]);
			}
		}
	})();
	const pf = createPortfolio(app, { name: 'Тест', kind: 'real', currency: 'USD' });
	const now = new Date(TODAY + 'T12:00:00Z');
	addCash(app, market, pf.id, { kind: 'deposit', date: '2024-10-01', amount: 10_000, currency: 'USD' }, now);
	for (const [sym, qty] of [['SOXX', 10], ['NVDA', 20], ['KO', 30]] as const)
		addEvent(app, market, { portfolioId: pf.id, securityId: ids[sym], kind: 'buy', date: '2024-10-01', qty, price: (market.prepare('select close from market_prices_daily where security_id = ? order by date limit 1').get(ids[sym]) as { close: number }).close, confirm: true }, now);
	return { app, market, ids, pf };
}

describe('the risk map and «what if?» on a portfolio (T-023)', () => {
	it('the three numbers, the map with semis together, the job tie, the labels of SOXL and IEF', () => {
		const s = setup();
		setSetting(s.app, 'employer', 'AMAT');
		const r = riskView(s.app, s.market, s.pf.id, { today: TODAY, add: [s.ids.SOXL, s.ids.IEF] })!;
		expect(r.now.held).toBe(3);
		expect(r.now.vol).toBeGreaterThan(0.05);
		expect(r.now.bets).toBeGreaterThan(1);
		expect(r.now.bets).toBeLessThan(3);
		// semis and the employer: the job tie is high
		expect(r.now.job!).toBeGreaterThan(0.5);
		const at = (sym: string) => r.securities.findIndex((x) => x.symbol === sym);
		const d = (a: string, b: string) => Math.hypot(r.securities[at(a)].xy[0] - r.securities[at(b)].xy[0], r.securities[at(a)].xy[1] - r.securities[at(b)].xy[1]);
		expect(d('NVDA', 'SOXX')).toBeLessThan(d('NVDA', 'KO'));
		expect(d('AMAT', 'SOXX')).toBeLessThan(d('AMAT', 'KO'));
		expect(r.links.some(([a, b]) => [a, b].includes(at('NVDA')) && [a, b].includes(at('SOXX')))).toBe(true);
		// money against risk: the semis carry more risk than money
		const row = (sym: string) => r.rows.find((x) => x.id === s.ids[sym as 'KO'])!;
		expect(row('NVDA').risk).toBeGreaterThan(row('NVDA').money);
		expect(row('KO').risk).toBeLessThan(row('KO').money);
		// the simulator: 5% of the portfolio from the cash
		const soxl = whatIf(r, [s.ids.SOXL], 0.05);
		expect(soxl.label).toBe('duplicates');
		expect(soxl.twin?.symbol).toBe('SOXX');
		const ief = whatIf(r, [s.ids.IEF], 0.05);
		expect(ief.label).toBe('reduces');
		// instead of NVDA: the semis' weight falls, so the risk of the invested part falls
		const swap = whatIf(r, [s.ids.IEF], 0.05, s.ids.NVDA);
		expect(swap.after.vol).toBeLessThan(swap.before.vol);
		// the details: minimal risk below the portfolio's, all within the 15% cap where possible
		expect(r.details.minRisk.vol).toBeLessThanOrEqual(r.now.vol * 2);
		expect(r.details.rolling.length).toBeGreaterThan(10);
	});
});
