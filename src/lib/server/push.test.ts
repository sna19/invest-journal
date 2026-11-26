import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addEvent, createPortfolio } from './portfolio.js';
import { savePlan } from './discipline.js';
import { messageOf, sendSignals, setPushKinds, subscribe } from './push.js';

const NOW = new Date('2026-05-04T09:00:00Z');
const SUB = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } };

function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const us = (market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', 'UUU', 'U', 'USD', 'USD', 'u') returning id`).get() as { id: number }).id;
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	px.run(us, '2026-01-05', 98, 102, 100);
	px.run(us, '2026-04-30', 108, 112, 110);
	const p = createPortfolio(app, { name: 'Мой', kind: 'real', currency: 'USD' });
	const pos = addEvent(app, market, { portfolioId: p.id, securityId: us, kind: 'buy', date: '2026-01-05', qty: 10, price: 100, discipline: true, plan: { thesis: 't', stop: 90, reviewDate: '2026-12-31' } }, NOW).positionId;
	const sent: { endpoint: string; payload: string }[] = [];
	const send = async (s: { endpoint: string }, payload: string) => void sent.push({ endpoint: s.endpoint, payload });
	return { app, market, pos, sent, send };
}

describe('T-015 Web Push', () => {
	it('sends a new signal once to every device; nothing without devices; the kinds chosen', async () => {
		const s = setup();
		savePlan(s.app, s.pos, { stop: 112, reason: 'подтянул' }, NOW);
		expect(await sendSignals(s.app, s.market, s.send, '2026-04-30')).toBe(0); // no device yet
		subscribe(s.app, s.market, SUB, 'iPhone'); // what stands now is marked as known
		expect(await sendSignals(s.app, s.market, s.send, '2026-04-30')).toBe(0);
		savePlan(s.app, s.pos, { stop: 95, target: 105, reason: 'цель ниже' }, NOW); // a new version → a target signal
		setPushKinds(s.app, ['stop']);
		expect(await sendSignals(s.app, s.market, s.send, '2026-04-30')).toBe(0);
		setPushKinds(s.app, ['stop', 'target']);
		expect(await sendSignals(s.app, s.market, s.send, '2026-04-30')).toBe(1);
		expect(await sendSignals(s.app, s.market, s.send, '2026-04-30')).toBe(0);
		const m = JSON.parse(s.sent[0].payload);
		expect(m).toMatchObject({ title: 'UUU: цель достигнута', url: `/position/${s.pos}` });
	});

	it('a device the push service no longer knows (410) is removed', async () => {
		const s = setup();
		subscribe(s.app, s.market, SUB, 'iPhone');
		savePlan(s.app, s.pos, { stop: 112, reason: 'x' }, NOW);
		const gone = async () => {
			throw Object.assign(new Error('Gone'), { statusCode: 410 });
		};
		expect(await sendSignals(s.app, s.market, gone, '2026-04-30')).toBe(0);
		expect(s.app.prepare('select count(*) as n from push_subscriptions').get()).toEqual({ n: 0 });
	});

	it('a model position past its quarter speaks of rule 2', () => {
		const msg = messageOf({ kind: 'model_end', positionId: 1, planId: 1, portfolioId: 2, portfolio: 'Мой', securityId: 3, symbol: 'UUU', priceUnit: 'USD', price: 90, priceDate: null, stop: null, target: null, reviewDate: '2026-03-31' });
		expect(msg.body).toMatch(/Правило 2/);
	});
});
