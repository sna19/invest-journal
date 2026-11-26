import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addEvent, createPortfolio } from './portfolio.js';
import { addEntry, deleteEntry, editEntry, listEntries, render, revisions, setArchived, syncJournal, tagCloud } from './diary.js';

const NOW = new Date('2026-05-04T09:00:00Z');

/** two US shares in technology (one held in a portfolio), one in energy, an ETF of the sector, the S&P 500 */
function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = market.prepare(
		`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search, is_benchmark) values (?, ?, ?, ?, 'USD', 'USD', ?, ?) returning id`
	);
	const id = (x: unknown) => (x as { id: number }).id;
	const aapl = id(sec.get('NASDAQ', 'stock', 'AAPL', 'Apple', 'aapl', 0));
	const msft = id(sec.get('NASDAQ', 'stock', 'MSFT', 'Microsoft', 'msft', 0));
	const xom = id(sec.get('NYSE', 'stock', 'XOM', 'Exxon', 'xom', 0));
	const xlk = id(sec.get('NYSE_ARCA', 'etf', 'XLK', 'Tech SPDR', 'xlk', 0));
	const prof = market.prepare(`insert into ref_security_profiles (security_id, kind, sector, industry, fetched_at) values (?, 'stock', ?, ?, '2026-05-01')`);
	prof.run(aapl, 'technology', 'Consumer Electronics');
	prof.run(msft, 'technology', 'Software - Infrastructure');
	prof.run(xom, 'energy', 'Oil & Gas Integrated');
	const px = market.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	for (const [s, a, b] of [
		[aapl, 100, 110],
		[msft, 300, 330],
		[xom, 90, 95],
		[xlk, 200, 210]
	] as const) {
		px.run(s, '2026-04-01', a - 1, a + 1, a);
		px.run(s, '2026-04-30', b - 1, b + 1, b);
		px.run(s, '2026-05-01', b - 1, b + 1, b);
	}
	const p = createPortfolio(app, { name: 'Мой', kind: 'real', currency: 'USD' });
	const pos = addEvent(app, market, { portfolioId: p.id, securityId: aapl, kind: 'buy', date: '2026-04-01', qty: 10, price: 100 }, NOW).positionId;
	return { app, market, aapl, msft, xom, xlk, p, pos };
}

describe('T-032 11а: the diary core', () => {
	it('an entry on a share with a personal tag: in the feed, its sector and its portfolio «через AAPL», with the moment', () => {
		const s = setup();
		const id = addEntry(s.app, s.market, { kind: 'observation', body: 'Отчёт сильный, **маржа** растёт', links: [{ type: 'security', id: s.aapl, primary: true }], tags: ['отчёты'] })!;
		const all = listEntries(s.app, s.market, {});
		expect(all.items.map((e) => e.id)).toEqual([id]);
		const e = all.items[0];
		expect(e.html).toContain('<strong>маржа</strong>');
		expect(e.tags.map((t) => (t as { name: string }).name).sort()).toEqual(['AAPL', 'отчёты']);
		const then = e.context.find((c) => c.type === 'security')!.then as { price: number; monthPct: number; restored?: boolean };
		expect(then.price).toBe(110);
		expect(then.monthPct).toBe(10);
		expect(e.context[0].restored).toBe(false);
		// upwards: the sector and the portfolio, marked
		const tech = listEntries(s.app, s.market, { scope: { type: 'sector', id: 'technology' } });
		expect(tech.items.map((x) => [x.id, x.via])).toEqual([[id, 'AAPL']]);
		expect(listEntries(s.app, s.market, { scope: { type: 'portfolio', id: String(s.p.id) } }).items.map((x) => x.via)).toEqual(['AAPL']);
		// the sector's ETF sees it too (it is the share's reference)
		expect(listEntries(s.app, s.market, { scope: { type: 'security', id: String(s.xlk) } }).items).toHaveLength(1);
		// not elsewhere, not downwards, and off with «включая записи бумаг» off
		expect(listEntries(s.app, s.market, { scope: { type: 'sector', id: 'energy' } }).items).toHaveLength(0);
		expect(listEntries(s.app, s.market, { scope: { type: 'security', id: String(s.msft) } }).items).toHaveLength(0);
		expect(listEntries(s.app, s.market, { scope: { type: 'sector', id: 'technology' }, inherit: false }).items).toHaveLength(0);
	});

	it('search (Russian, English, Hebrew), tags (several = AND), kind, period; the filter «personal»', () => {
		const s = setup();
		const a = addEntry(s.app, s.market, { body: 'Apple: тезис про сервисы', links: [{ type: 'security', id: s.aapl }], tags: ['идея', 'долго'] })!;
		const b = addEntry(s.app, s.market, { kind: 'decision', body: 'Продаю XOM — מחיר נפט', links: [{ type: 'security', id: s.xom }], tags: ['идея'] })!;
		const ids = (f: Parameters<typeof listEntries>[2]) => listEntries(s.app, s.market, f).items.map((e) => e.id);
		expect(ids({ q: 'серв' })).toEqual([a]);
		expect(ids({ q: 'apple' })).toEqual([a]);
		expect(ids({ q: 'נפט' })).toEqual([b]);
		const tag = (n: string) => (s.app.prepare('select id from tags where name = ?').get(n) as { id: number }).id;
		expect(ids({ tags: [tag('идея')] })).toEqual([b, a]);
		expect(ids({ tags: [tag('идея'), tag('долго')] })).toEqual([a]);
		expect(ids({ kind: 'decision' })).toEqual([b]);
		expect(ids({ only: 'personal' })).toEqual([a]);
		expect(ids({ from: '2000-01-01', to: '2000-12-31' })).toEqual([]);
		expect(tagCloud(s.app, s.market, null).find((t) => t.name === 'идея')!.n).toBe(2);
	});

	it('an edit is a revision; an answer folds under its entry; the archive and deleting for good', () => {
		const s = setup();
		const id = addEntry(s.app, s.market, { body: 'первый текст' })!;
		editEntry(s.app, id, { body: 'второй текст' });
		expect(revisions(s.app, id).map((r) => r.body)).toEqual(['первый текст', 'второй текст']);
		const kid = addEntry(s.app, s.market, { body: 'ответ', parentId: id })!;
		const feed = listEntries(s.app, s.market, {}).items;
		expect(feed.map((e) => e.id)).toEqual([id]);
		expect(feed[0].answers.map((e) => e.id)).toEqual([kid]);
		expect(feed[0].revisions).toBe(2);
		setArchived(s.app, id, true);
		expect(listEntries(s.app, s.market, {}).items).toHaveLength(0);
		expect(listEntries(s.app, s.market, { archived: true }).items).toHaveLength(1);
		expect(() => deleteEntry(s.app, id, 'да')).toThrow(/УДАЛИТЬ/);
		deleteEntry(s.app, id, 'удалить');
		expect(s.app.prepare('select count(*) as n from journal_entries').get()).toEqual({ n: 1 });
	});

	it('the old notes and theses move in once, with their own dates and a restored moment', () => {
		const s = setup();
		addEvent(s.app, s.market, { positionId: s.pos, kind: 'note', date: '2026-04-30', note: 'держу до отчёта' }, NOW);
		addEvent(s.app, s.market, { positionId: s.pos, kind: 'buy', date: '2026-04-30', qty: 1, price: 110, discipline: true, plan: { thesis: 'сервисы растут', stop: 90 } }, NOW);
		expect(syncJournal(s.app, s.market)).toBe(2);
		expect(syncJournal(s.app, s.market)).toBe(0);
		const feed = listEntries(s.app, s.market, { scope: { type: 'security', id: String(s.aapl) } }).items;
		const note = feed.find((e) => e.body === 'держу до отчёта')!;
		expect(note.createdAt.slice(0, 10)).toBe('2026-04-30');
		expect(note.context.find((c) => c.type === 'security')).toMatchObject({ restored: true, then: { price: 110 } });
		expect(feed.some((e) => e.body.startsWith('Тезис: сервисы растут'))).toBe(true);
	});

	it('the owner\'s markdown is shown without HTML of its own and without script links', () => {
		expect(render('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://a.b)')).not.toMatch(/<img|href="javascript/);
		expect(render('[y](https://a.b)')).toContain('href="https://a.b"');
	});
});
