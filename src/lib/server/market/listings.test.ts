import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openMarket } from '../db.js';
import { providerSymbols, rawFiles, securities, securitySymbols } from '../schema/market.js';
import { httpsGet, makeFetcher, viaFetch } from './http.js';
import { cleanName, nasdaqTrader } from './nasdaqtrader.js';
import { checkListings, isSuspicious, runListings } from './pipeline.js';
import { searchSecurities } from './search.js';
import { tase } from './tase.js';
import type { Fetcher, ListingAdapter } from './types.js';

const FIX = join(import.meta.dirname, 'fixtures');
const fixture = (name: string) => readFileSync(join(FIX, name));

/** Fetcher that serves the fixture files by the URL's last part. */
const files: Fetcher = async (url) => {
	if (url.includes('nasdaqlisted')) return fixture('nasdaqlisted.txt');
	if (url.includes('otherlisted')) return fixture('otherlisted.txt');
	if (url.endsWith('lang=1')) return fixture('searchentities-en.json');
	if (url.endsWith('lang=0')) return fixture('searchentities-he.json');
	throw new Error('unexpected ' + url);
};

function setup() {
	const { db, sqlite } = openMarket(':memory:');
	const rawDir = mkdtempSync(join(tmpdir(), 'raw-'));
	return { db, sqlite, rawDir };
}

describe('Nasdaq Trader adapter', () => {
	const rows = nasdaqTrader.parseListings([
		{ name: 'nasdaqlisted.txt', body: fixture('nasdaqlisted.txt') },
		{ name: 'otherlisted.txt', body: fixture('otherlisted.txt') }
	]);
	const by = (s: string) => rows.find((r) => r.symbol === s);
	it('keeps stocks and ETFs of the five venues; drops test issues, warrants, preferred and IEX', () => {
		expect(rows.map((r) => `${r.exchangeCode}:${r.symbol}`).sort()).toEqual(
			['NASDAQ:AAPL', 'NASDAQ:AMAT', 'NASDAQ:NVDA', 'NASDAQ:QQQ', 'NYSE:BRK.B', 'NYSE:TEVA', 'NYSE_ARCA:GLD', 'NYSE_ARCA:IVV', 'NYSE_ARCA:SPY', 'CBOE_BZX:AAAA', 'CBOE_BZX:AAAB'].sort()
		);
	});
	it('names without «Common Stock»; ETF type; Yahoo symbol with a dash', () => {
		expect(by('AMAT')).toMatchObject({ nameEn: 'Applied Materials, Inc.', type: 'stock', currency: 'USD', yahooSymbol: 'AMAT' });
		expect(by('SPY')).toMatchObject({ type: 'etf', exchangeCode: 'NYSE_ARCA' });
		expect(by('BRK.B')).toMatchObject({ nameEn: 'Berkshire Hathaway Inc. New', yahooSymbol: 'BRK-B' });
		expect(cleanName('Teva Pharmaceutical Industries Limited Ordinary Shares')).toBe('Teva Pharmaceutical Industries Limited');
	});
});

describe('TASE adapter', () => {
	const rows = tase.parseListings([
		{ name: 'searchentities-en.json', body: fixture('searchentities-en.json') },
		{ name: 'searchentities-he.json', body: fixture('searchentities-he.json') }
	]);
	it('shares and equity ETFs only, with Hebrew names, ISIN, agorot and the Yahoo symbol', () => {
		expect(rows.map((r) => r.symbol).sort()).toEqual(['ESLT', 'KSM.F208', 'LUMI', 'NICE', 'TEVA']);
		expect(rows.find((r) => r.symbol === 'LUMI')).toMatchObject({
			providerSymbol: '604611',
			nameHe: 'לאומי',
			isin: 'IL0006046119',
			priceUnit: 'ILA',
			yahooSymbol: 'LUMI.TA'
		});
		expect(rows.find((r) => r.symbol === 'KSM.F208')).toMatchObject({ type: 'etf', yahooSymbol: 'KSM-F208.TA' });
	});
});

describe('retries (pipeline step 1)', () => {
	it('retries 403 three times with a growing pause, 404 is final', async () => {
		const pauses: number[] = [];
		let calls = 0;
		const get = makeFetcher({
			get: viaFetch((async () => new Response('x', { status: ++calls < 3 ? 403 : 200 })) as typeof fetch),
			sleep: async (ms) => void pauses.push(ms)
		});
		expect((await get('u')).toString()).toBe('x');
		expect(pauses).toEqual([2000, 4000]);
		const notFound = makeFetcher({ get: viaFetch((async () => new Response('', { status: 404 })) as typeof fetch), sleep: async () => {} });
		await expect(notFound('u')).rejects.toThrow('404');
	});
});

describe('httpsGet', () => {
	it.skipIf(!process.env.NET)('reaches the TASE search index (run with NET=1)', async () => {
		const r = await httpsGet('https://api.tase.co.il/api/content/searchentities?lang=1', {
			'User-Agent': 'Mozilla/5.0',
			Origin: 'https://market.tase.co.il',
			Referer: 'https://market.tase.co.il/',
			Accept: 'application/json'
		});
		expect(r.status).toBe(200);
		expect(JSON.parse(r.body.toString()).length).toBeGreaterThan(5000);
	});
});

describe('runListings', () => {
	it('loads, keeps raw answers, and a rerun adds no rows', async () => {
		const { db, rawDir } = setup();
		const first = await runListings(db, nasdaqTrader, { get: files, rawDir });
		const t1 = await runListings(db, tase, { get: files, rawDir });
		expect(first).toMatchObject({ status: 'ok', received: 11, added: 11, updated: 0 });
		expect(t1).toMatchObject({ status: 'ok', received: 5, added: 5 });
		const count = () => db.select().from(securities).all().length;
		const n = count();
		expect(n).toBe(11 + 5 + 2); // + the two benchmarks
		const again = await runListings(db, nasdaqTrader, { get: files, rawDir });
		await runListings(db, tase, { get: files, rawDir });
		expect(again).toMatchObject({ status: 'ok', added: 0, updated: 0, deactivated: 0 });
		expect(count()).toBe(n);
		expect(db.select().from(rawFiles).all()).toHaveLength(8);
		expect(readdirSync(join(rawDir, 'tase')).length).toBe(1);
	});

	it('a security gone from the list is kept inactive; it comes back active', async () => {
		const { db, rawDir } = setup();
		await runListings(db, nasdaqTrader, { get: files, rawDir });
		const without: Fetcher = async (url) =>
			url.includes('nasdaqlisted') ? Buffer.from(fixture('nasdaqlisted.txt').toString().replace(/^NVDA\|.*\n/m, '')) : files(url);
		const s = await runListings(db, nasdaqTrader, { get: without, rawDir });
		expect(s.deactivated).toBe(1);
		const nvda = () => db.select().from(securities).where(eq(securities.symbol, 'NVDA')).get()!;
		expect(nvda()).toMatchObject({ active: false });
		expect(nvda().delistedAt).toBeTruthy();
		await runListings(db, nasdaqTrader, { get: files, rawDir });
		expect(nvda()).toMatchObject({ active: true, delistedAt: null });
	});

	it('a TASE ticker change keeps the security number and writes the history', async () => {
		const { db, rawDir } = setup();
		await runListings(db, tase, { get: files, rawDir });
		const lumi = db.select().from(securities).where(eq(securities.symbol, 'LUMI')).get()!;
		const renamed: Fetcher = async (url) =>
			url.endsWith('lang=1') ? Buffer.from(fixture('searchentities-en.json').toString().replace('"Smb": "LUMI"', '"Smb": "LUMI2"')) : files(url);
		const s = await runListings(db, tase, { get: renamed, rawDir, now: new Date('2030-01-02T08:00:00Z') });
		expect(s.updated).toBe(1);
		expect(db.select().from(securities).where(eq(securities.id, lumi.id)).get()!.symbol).toBe('LUMI2');
		const hist = db.select().from(securitySymbols).where(eq(securitySymbols.securityId, lumi.id)).all();
		expect(hist.map((h) => [h.symbol, h.validTo])).toEqual([
			['LUMI', '2030-01-02'],
			['LUMI2', null]
		]);
		const yahoo = db.select().from(providerSymbols).where(eq(providerSymbols.securityId, lumi.id)).all();
		expect(yahoo.find((p) => p.providerCode === 'yahoo')?.providerSymbol).toBe('LUMI2.TA');
	});

	it('a provider failure is an error run, nothing changes', async () => {
		const { db, rawDir } = setup();
		const s = await runListings(db, tase, { get: async () => Promise.reject(new Error('403 blocked')), rawDir });
		expect(s).toMatchObject({ status: 'error', error: '403 blocked', added: 0 });
	});

	it('a list less than half the usual is suspicious: nothing is deactivated', async () => {
		expect(isSuspicious(40, 100)).toBe(true);
		expect(isSuspicious(60, 100)).toBe(false);
		expect(isSuspicious(10, undefined)).toBe(false);
		const { db, rawDir } = setup();
		await runListings(db, nasdaqTrader, { get: files, rawDir });
		const short: Fetcher = async (url) =>
			url.includes('otherlisted') ? Buffer.from(fixture('otherlisted.txt').toString().split('\n').slice(0, 2).join('\n')) : files(url);
		const s = await runListings(db, nasdaqTrader, { get: short, rawDir });
		expect(s).toMatchObject({ status: 'suspicious', deactivated: 0 });
	});

	it('bad rows go to quality issues', () => {
		const ok = { providerSymbol: 'x', exchangeCode: 'NYSE', symbol: 'X', type: 'stock' as const, nameEn: 'X', currency: 'USD', priceUnit: 'USD', yahooSymbol: 'X' };
		const { good, issues } = checkListings(
			[ok, { ...ok }, { ...ok, providerSymbol: 'y', symbol: 'A B' }, { ...ok, providerSymbol: 'z', exchangeCode: 'LSE' }],
			new Set(['NYSE'])
		);
		expect(good).toHaveLength(1);
		expect(issues.map((i) => i.rule)).toEqual(['listing.duplicate', 'listing.bad_symbol', 'listing.unknown_exchange']);
	});
});

describe('search', () => {
	async function loaded() {
		const { db, sqlite, rawDir } = setup();
		for (const a of [nasdaqTrader, tase] as ListingAdapter[]) await runListings(db, a, { get: files, rawDir });
		return sqlite;
	}
	it('finds AMAT, SPY, TEVA on both exchanges and Leumi by its Hebrew name', async () => {
		const sqlite = await loaded();
		const sym = (q: string, m?: 'us' | 'il') => searchSecurities(sqlite, q, { market: m }).map((h) => `${h.symbol}@${h.exchangeCode}`);
		expect(sym('amat')[0]).toBe('AMAT@NASDAQ');
		expect(sym('spy')[0]).toBe('SPY@NYSE_ARCA');
		expect(sym('teva')).toEqual(expect.arrayContaining(['TEVA@NYSE', 'TEVA@TASE']));
		expect(sym('teva', 'il')).toEqual(['TEVA@TASE']);
		expect(sym('לאומי')).toEqual(['LUMI@TASE']);
		expect(sym('applied')[0]).toBe('AMAT@NASDAQ');
	});
	it('needs two characters; % and _ are plain characters', async () => {
		const sqlite = await loaded();
		expect(searchSecurities(sqlite, 'a')).toEqual([]);
		expect(searchSecurities(sqlite, '%%')).toEqual([]);
	});
	it('exact symbol first, then symbol start, then a word of the name', async () => {
		const sqlite = await loaded();
		expect(searchSecurities(sqlite, 'nv').map((h) => h.symbol)[0]).toBe('NVDA');
		const sp = searchSecurities(sqlite, 's&p').map((h) => h.symbol);
		expect(sp.slice(0, 1)).toEqual(['SPX']); // the benchmark index: «S&P 500»
	});
});

describe('TASE foreign ETF names (20.11.2026)', async () => {
	const { foreignEtfName } = await import('./tase.js');
	it('the full name from the Hebrew one, so «iShares» and «UCITS» find them', () => {
		expect(foreignEtfName('IS.FF505', 'ISHAR.F MSCI AC', 'איישרס.חוץ MSCI AC WORLD')).toBe('iShares MSCI AC WORLD UCITS ETF');
		expect(foreignEtfName('IS.FF702', 'ISH.FRF SP 500', 'איישרס.חוץ P 500&S')).toBe('iShares S&P 500 UCITS ETF');
		expect(foreignEtfName('IN.FF6', 'INV.FRFMSCIEM', 'אינבסקו.חוץMSCIEMUCITSETF')).toBe('Invesco MSCI EM UCITS ETF');
		expect(foreignEtfName('IN.FF1', 'INV.FRFS&P 500', 'אינבסקו.חוץ')).toBe('Invesco S&P 500 UCITS ETF');
		expect(foreignEtfName('IS.FFIND', 'ISHARE.F INDIA', 'איישרס.חוץ הודו INDIA')).toBe('iShares INDIA UCITS ETF');
		expect(foreignEtfName('KSM.F208', 'KSM ETF', 'קסם')).toBe('KSM ETF');
	});
});
