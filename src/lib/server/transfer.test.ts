import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { createPortfolio, portfolioView } from './portfolio.js';
import { applyTransfer, parseTransfer, previewTransfer } from './transfer.js';

// fictional securities and numbers only: the owner's portfolio never goes into the repository
function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = market.prepare(
		`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values (?, 'stock', ?, ?, ?, ?, ?) returning id`
	);
	const aaa = (sec.get('NASDAQ', 'AAA', 'Alpha', 'USD', 'USD', 'aaa') as { id: number }).id;
	const ttt = (sec.get('TASE', 'TTT', 'Tet', 'ILS', 'ILA', 'ttt') as { id: number }).id;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	px.run(aaa, '2026-11-16', 49, 51, 50);
	px.run(ttt, '2026-11-17', 1190, 1210, 1200);
	market.prepare(`insert into market_fx_daily (pair, date, rate, provider_code) values ('USD/ILS', '2026-11-17', 3.6, 'test')`).run();
	return { app, market };
}

const yahoo = async () =>
	Buffer.from(
		JSON.stringify({
			chart: {
				result: [
					{
						meta: { currency: 'USD', exchangeName: 'LSE', longName: 'Fictional UCITS ETF USD (Acc)', gmtoffset: 0 },
						timestamp: [Date.parse('2026-11-16T16:30:00Z') / 1000, Date.parse('2026-11-17T16:30:00Z') / 1000],
						indicators: { quote: [{ close: [99, 100] }] }
					}
				]
			}
		})
	);

describe('transfer of existing positions (section 18)', () => {
	it('parses the list', () => {
		const l = parseTransfer('date 2026-11-17\nAAA 10.123456 49.5\n# note\nTTT value=12 000 cost=9000\ncash ILS 100,5\ntax 20\nyahoo:FAKE.L value=3600\nBAD x');
		expect(l.map((x) => x.kind)).toEqual(['date', 'position', 'skip', 'position', 'cash', 'tax', 'position', 'error']);
		expect(l[1]).toMatchObject({ symbol: 'AAA', qty: 10.123456, price: 49.5 });
		expect(l[3]).toMatchObject({ symbol: 'TTT', value: 12000, cost: 9000 });
		expect(l[4]).toMatchObject({ currency: 'ILS', amount: 100.5 });
		expect(l[6]).toMatchObject({ yahoo: 'FAKE.L', value: 3600 });
	});

	it('a dollar portfolio: fractional shares at the given price; a price far from the base is flagged', async () => {
		const s = setup();
		const p = createPortfolio(s.app, { name: 'D', currency: 'USD' });
		const pv = await previewTransfer(s.app, s.market, p.id, 'date 2026-11-17\nAAA 10.123456 49.5\nAAA 1 60\nTTT 1 1200', { today: '2026-11-17' });
		expect(pv.rows[0]).toMatchObject({ ok: true, qty: 10.123456, price: 49.5 });
		expect(pv.rows[0].warnings[0]).toMatch(/взята за 2026-11-16/);
		expect(pv.rows[1].warnings.join()).toMatch(/отличается от закрытия 50/);
		expect(pv.rows[2]).toMatchObject({ ok: false });
	});

	it('a shekel portfolio: quantity from the value and the close, rounded; the purchase cost; a UCITS line added by hand; money and tax', async () => {
		const s = setup();
		const p = createPortfolio(s.app, { name: 'S', currency: 'ILS' });
		const text = 'date 2026-11-17\nTTT value=12 050 cost=9000\nyahoo:FAKE.L value=3 600 cost=3000\ncash ILS 500\ncash USD 10\ntax 20';
		const pv = await previewTransfer(s.app, s.market, p.id, text, { today: '2026-11-17', get: yahoo });
		// 1 200 agorot = 12 ₪: 12 050 / 12 = 1 004.17 → 1 004, 0.017%; 3 600 / (100 $ × 3.6) = 10
		expect(pv.rows[0]).toMatchObject({ ok: true, qty: 1004, price: 1200 });
		expect(pv.rows[0].roundingPct!).toBeCloseTo(0.0166, 3);
		expect(pv.rows[1]).toMatchObject({ ok: true, qty: 10, price: 100, found: { exchange: 'LSE', manual: true, isNew: true } });
		expect(pv.total.positions).toBeCloseTo(12048 + 3600, 6);
		expect(pv.total.cash).toBeCloseTo(500 + 36, 6);
		const r = await applyTransfer(s.app, s.market, p.id, text, { today: '2026-11-17', get: yahoo, now: new Date('2026-11-17T18:00:00Z') });
		expect(r).toMatchObject({ added: 2, skipped: [] });
		const v = portfolioView(s.app, s.market, p.id, '2026-11-17')!;
		expect(v.summary.taxAccrued).toBe(20);
		expect(v.summary.balances).toEqual([
			{ currency: 'ILS', amount: 500, valuePc: 500 },
			{ currency: 'USD', amount: 10, valuePc: 36 }
		]);
		const t = v.positions.find((x) => x.symbol === 'TTT')!;
		// profit from the purchase cost: 1 004 × 12 − 9 000
		expect(t).toMatchObject({ fromTransfer: false, stage: 'holding' });
		expect(t.unrealizedPc).toBeCloseTo(3048, 6);
		// the UCITS line is in the reference now, out of the search
		const m = s.market.prepare(`select manual, exchange_code as ex from ref_securities where symbol = 'FAKE'`).get();
		expect(m).toEqual({ manual: 1, ex: 'LSE' });
		// a hand-made security without a price yet: the opening's price counts
		expect(v.summary.value).toBeCloseTo(12048 + 3600 + 536, 6);
	});
});
