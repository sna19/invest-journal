import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addMonths, horizonFor, israelDate, validate } from '../hypothesis.js';
import { openApp, openMarket } from './db.js';
import {
	cancelHypothesis,
	createHypothesis,
	getHypothesis,
	InputError,
	listAuthors,
	listHypotheses,
	LockedError,
	restoreHypothesis,
	sourceForUrl,
	updateHypothesis
} from './journal.js';
import { hypotheses, sources } from './schema/app.js';
import { securities } from './schema/market.js';
import { titleFromHtml } from './article.js';

function setup() {
	const app = openApp(':memory:');
	const market = openMarket(':memory:');
	const add = (symbol: string, exchangeCode: string, nameEn: string, priceUnit = 'USD') =>
		market.db
			.insert(securities)
			.values({ symbol, exchangeCode, nameEn, type: 'stock', currency: priceUnit === 'ILA' ? 'ILS' : 'USD', priceUnit, search: symbol.toLowerCase() })
			.returning()
			.get().id;
	const amat = add('AMAT', 'NASDAQ', 'Applied Materials, Inc.');
	const lumi = add('LUMI', 'TASE', 'LEUMI', 'ILA');
	const src = (name: string) => app.db.select().from(sources).where(eq(sources.name, name)).get()!.id;
	return { app, market, amat, lumi, src };
}

const NOW = new Date('2026-11-15T09:00:00Z');

function base(s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
	return {
		url: 'https://www.barrons.com/articles/amat-buy-123',
		sourceId: s.src("Barron's"),
		author: 'Morgan Stanley',
		securityId: s.amat,
		signalType: 'recommendation',
		direction: 'long',
		thesis: 'Spending on chip tools will recover in 2027',
		invalidation: 'Guidance cut next quarter',
		horizon: 'none',
		...over
	};
}

describe('sources (section 17)', () => {
	it('five sources set up in advance', () => {
		const { app } = setup();
		expect(app.db.select({ n: sources.name }).from(sources).all().map((s) => s.n).sort()).toEqual(
			["Barron's", 'Globes', 'TheMarker', 'WSJ', 'Собственная идея'].sort()
		);
	});
	it('a link picks the source by its domain, with www. or a subdomain', () => {
		const { app } = setup();
		expect(sourceForUrl(app.db, 'https://www.barrons.com/articles/x')?.name).toBe("Barron's");
		expect(sourceForUrl(app.db, 'barrons.com/x')?.name).toBe("Barron's");
		expect(sourceForUrl(app.db, 'https://en.globes.co.il/en/article-1')?.name).toBe('Globes');
		expect(sourceForUrl(app.db, 'https://notbarrons.com/x')).toBeNull();
		expect(sourceForUrl(app.db, 'nonsense')).toBeNull();
	});
});

describe('createHypothesis', () => {
	it('copies the security, picks the benchmark by market, waits for the entry price', () => {
		const s = setup();
		const h = createHypothesis(s.app.db, s.market.sqlite, base(s), NOW);
		expect(h).toMatchObject({
			symbol: 'AMAT',
			securityName: 'Applied Materials, Inc.',
			benchmarkSymbol: 'SPX',
			entryDate: '2026-11-15',
			entryPrice: null,
			benchmarkEntry: null,
			status: 'open',
			mode: 'sim',
			directionSource: 'article',
			confidencePct: null
		});
		const il = createHypothesis(s.app.db, s.market.sqlite, base(s, { securityId: s.lumi, sourceId: s.src('Globes'), url: null }), NOW);
		expect(il).toMatchObject({ benchmarkSymbol: 'TA-125', priceUnit: 'ILA' });
	});

	it('no term in the article: 3 months, marked default; a chosen term is «from the article»', () => {
		const s = setup();
		expect(createHypothesis(s.app.db, s.market.sqlite, base(s), NOW)).toMatchObject({ horizonDate: '2027-02-15', horizonSource: 'default' });
		expect(createHypothesis(s.app.db, s.market.sqlite, base(s, { horizon: '12' }), NOW)).toMatchObject({ horizonDate: '2027-11-15', horizonSource: 'article' });
		expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
		expect(horizonFor('date', '2027-01-10', '2026-11-15')).toEqual({ horizonDate: '2027-01-10', horizonSource: 'article' });
	});

	it('«News» always gets direction_source «mine»', () => {
		const s = setup();
		const h = createHypothesis(s.app.db, s.market.sqlite, base(s, { signalType: 'news', directionSource: 'article' }), NOW);
		expect(h.directionSource).toBe('mine');
		const op = createHypothesis(s.app.db, s.market.sqlite, base(s, { signalType: 'opinion', directionSource: 'mine' }), NOW);
		expect(op.directionSource).toBe('mine');
	});

	it('an own idea always gets direction_source «mine», whatever the form sent (T-007)', () => {
		const s = setup();
		const h = createHypothesis(s.app.db, s.market.sqlite, base(s, { sourceId: s.src('Собственная идея'), url: null, directionSource: 'article' }), NOW);
		expect(h.directionSource).toBe('mine');
	});

	it('one article, several hypotheses; the author is remembered for autocomplete', () => {
		const s = setup();
		const a = createHypothesis(s.app.db, s.market.sqlite, base(s), NOW);
		const b = createHypothesis(s.app.db, s.market.sqlite, base(s, { securityId: s.lumi, author: '' }), NOW);
		expect(b.articleId).toBe(a.articleId);
		expect(listAuthors(s.app.db, s.src("Barron's"))).toEqual(['Morgan Stanley']);
	});

	it('refuses missing fields, an unknown or inactive security, an index', () => {
		const s = setup();
		const errors = (over: Record<string, unknown>) => {
			try {
				createHypothesis(s.app.db, s.market.sqlite, base(s, over), NOW);
				return {};
			} catch (e) {
				return (e as InputError).errors;
			}
		};
		expect(Object.keys(errors({ thesis: '', securityId: null, signalType: null }))).toEqual(
			expect.arrayContaining(['thesis', 'securityId', 'signalType'])
		);
		expect(errors({ securityId: 999 }).securityId).toBeTruthy();
		expect(errors({ confidencePct: 120 }).confidencePct).toBeTruthy();
		expect(errors({ confidencePct: '' })).toEqual({});
		s.market.db.update(securities).set({ active: false }).where(eq(securities.id, s.amat)).run();
		expect(errors({}).securityId).toMatch(/списках/);
		const spx = s.market.db.select().from(securities).where(eq(securities.symbol, 'SPX')).get()!.id;
		expect(errors({ securityId: spx }).securityId).toMatch(/бенчмарк/);
	});

	it('partial validation while typing judges only filled fields', () => {
		expect(validate({ thesis: '' }, '2026-11-15', true)).toEqual({});
		expect(validate({ confidencePct: '150' }, '2026-11-15', true).confidencePct).toBeTruthy();
		expect(validate({ horizon: 'date', horizonDate: '2026-11-01' }, '2026-11-15', true).horizonDate).toBeTruthy();
	});
});

describe('lock (section 6)', () => {
	it('key fields cannot change through the app', () => {
		const s = setup();
		const h = createHypothesis(s.app.db, s.market.sqlite, base(s), NOW);
		expect(() => updateHypothesis(s.app.db, h.id, { direction: 'short' })).toThrow(LockedError);
		expect(() => updateHypothesis(s.app.db, h.id, { note: 'ok', horizonDate: '2030-01-01' })).toThrow(LockedError);
		expect(updateHypothesis(s.app.db, h.id, { note: 'перечитать отчёт', tags: 'Полупроводники, полупроводники' })).toMatchObject({
			note: 'перечитать отчёт',
			tags: 'полупроводники'
		});
		expect(() => updateHypothesis(s.app.db, h.id, { lesson: 'рано' })).toThrow(LockedError);
	});

	it('…nor by a direct SQL update; delete is refused; the entry price is set once', () => {
		const s = setup();
		const h = createHypothesis(s.app.db, s.market.sqlite, base(s), NOW);
		const sql = s.app.sqlite;
		for (const stmt of [
			'update hypotheses set direction = "short" where id = ?',
			'update hypotheses set security_id = 2 where id = ?',
			'update hypotheses set horizon_date = "2030-01-01" where id = ?',
			'update hypotheses set confidence_pct = 90 where id = ?',
			'update hypotheses set invalidation = "x" where id = ?',
			'update hypotheses set signal_type = "news" where id = ?',
			'delete from hypotheses where id = ?'
		])
			expect(() => sql.prepare(stmt).run(h.id), stmt).toThrow();
		sql.prepare('update hypotheses set entry_price = 100.5, benchmark_entry = 6000 where id = ?').run(h.id);
		expect(() => sql.prepare('update hypotheses set entry_price = 90 where id = ?').run(h.id)).toThrow(/locked/);
		expect(getHypothesis(s.app.db, h.id)!.h).toMatchObject({ direction: 'long', entryPrice: 100.5 });
	});

	it('cancel only within 24 hours; restore within the same window', () => {
		const s = setup();
		const h = createHypothesis(s.app.db, s.market.sqlite, base(s), new Date());
		expect(cancelHypothesis(s.app.db, h.id)).toMatchObject({ status: 'cancelled' });
		expect(listHypotheses(s.app.db, { status: 'all' })).toHaveLength(0);
		expect(restoreHypothesis(s.app.db, h.id)).toMatchObject({ status: 'open', cancelledAt: null });
		// a day and a minute later
		s.app.sqlite.prepare("update hypotheses set note = 'x' where id = ?").run(h.id);
		s.app.sqlite.exec("drop trigger hypotheses_locked_fields"); // only to age the row in this test
		s.app.sqlite.prepare("update hypotheses set created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day', '-1 minute') where id = ?").run(h.id);
		expect(() => cancelHypothesis(s.app.db, h.id)).toThrow(LockedError);
		expect(() => s.app.sqlite.prepare("update hypotheses set status = 'cancelled' where id = ?").run(h.id)).toThrow(/24 hours/);
	});
});

describe('lists', () => {
	it('filters by status, mode, market and default term', () => {
		const s = setup();
		createHypothesis(s.app.db, s.market.sqlite, base(s), NOW);
		createHypothesis(s.app.db, s.market.sqlite, base(s, { securityId: s.lumi, mode: 'real', horizon: '6', url: null, sourceId: s.src('Globes') }), NOW);
		const n = (f: Parameters<typeof listHypotheses>[1]) => listHypotheses(s.app.db, f).map((r) => r.h.symbol);
		expect(n({ status: 'open' })).toHaveLength(2);
		expect(n({ mode: 'real' })).toEqual(['LUMI']);
		expect(n({ market: 'us' })).toEqual(['AMAT']);
		expect(n({ defaultHorizon: true })).toEqual(['AMAT']);
		expect(n({ status: 'closed' })).toEqual([]);
		expect(listHypotheses(s.app.db, {})[0]).toMatchObject({ sourceName: expect.any(String) });
		expect(s.app.db.select().from(hypotheses).all()).toHaveLength(2);
	});
});

describe('article title', () => {
	it('og:title first, then <title>, entities decoded', () => {
		expect(titleFromHtml('<meta property="og:title" content="Buy AMAT &amp; hold"><title>x</title>')).toBe('Buy AMAT & hold');
		expect(titleFromHtml('<title>\n  Leumi &#8211; results </title>')).toBe('Leumi – results');
		expect(titleFromHtml('<p>no title</p>')).toBeNull();
		expect(israelDate(new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15');
	});
});
