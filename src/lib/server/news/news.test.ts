import { describe, expect, it } from 'vitest';
import { openMarket } from '../db.js';
import { parseRss, type Get } from './feeds.js';
import { atrPct, attribution, collect, listNews, shortName, storeItems, titleKey, triggers } from './service.js';

const NOW = new Date('2026-11-20T12:00:00Z');

const rss = (items: { title: string; link: string; date: string; source?: string; desc?: string }[]) =>
	`<?xml version="1.0"?><rss><channel>${items
		.map(
			(i) =>
				`<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date}</pubDate>${i.source ? `<source url="x">${i.source}</source>` : ''}${i.desc ? `<description><![CDATA[${i.desc}]]></description>` : ''}</item>`
		)
		.join('')}</channel></rss>`;

function market() {
	const m = openMarket(':memory:').sqlite;
	const add = m.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search, active) values (?, ?, ?, ?, 'USD', 'USD', ?, 1) returning id`);
	const id = (add.get('NASDAQ', 'stock', 'NVDA', 'NVIDIA Corporation', 'nvda') as { id: number }).id;
	const soxx = (add.get('NASDAQ', 'etf', 'SOXX', 'iShares Semiconductor ETF', 'soxx') as { id: number }).id;
	m.prepare(`insert into ref_security_profiles (security_id, kind, sector, industry, fetched_at) values (?, 'stock', 'technology', 'Semiconductors', '2026-11-20')`).run(id);
	const px = m.prepare(`insert into market_prices_daily (security_id, date, low, high, close, provider_code) values (?, ?, ?, ?, ?, 'test')`);
	const spx = (m.prepare(`select security_id as id from ref_provider_symbols where provider_code = 'seed' and provider_symbol = 'benchmark:SPX'`).get() as { id: number }).id;
	// 19.11: NVDA 150 → 145.05 (−3.3%), SOXX 200 → 194.5 (−2.75%), S&P 500 6000 → 5878.8 (−2.02%)
	for (const [sid, a, b] of [
		[id, 150, 145.05],
		[soxx, 200, 194.5],
		[spx, 6000, 5878.8]
	] as const) {
		for (let d = 1; d <= 17; d++) px.run(sid, `2026-10-${String(d + 10).padStart(2, '0')}`, a * 0.99, a * 1.01, a);
		px.run(sid, '2026-11-18', a * 0.99, a * 1.01, a);
		px.run(sid, '2026-11-19', b * 0.99, b * 1.01, b);
	}
	return { m, id, soxx, spx };
}

describe('news «Почему двигается?» (T-022)', () => {
	it('reads an RSS feed: Google\'s « - Publisher» comes off the title into the publisher', () => {
		const items = parseRss(
			rss([
				{ title: 'Nvidia shares fall 3% on China probe - Reuters', link: 'https://news.google.com/a1', date: 'Wed, 19 Nov 2026 15:30:00 GMT', source: 'Reuters' },
				{ title: 'AT&amp;T &amp; Nvidia deal', link: 'https://x.com/b', date: 'Wed, 19 Nov 2026 16:00:00 GMT', desc: '<p>A deal &quot;worth&quot; billions.</p>' }
			])
		);
		expect(items[0]).toMatchObject({ title: 'Nvidia shares fall 3% on China probe', publisher: 'Reuters', publishedAt: '2026-11-19T15:30:00.000Z' });
		expect(items[1]).toMatchObject({ title: 'AT&T & Nvidia deal', snippet: 'A deal "worth" billions.' });
		expect(shortName('NVIDIA Corporation')).toBe('NVIDIA');
		expect(shortName('Applied Materials, Inc.')).toBe('Applied Materials');
	});

	it('merges duplicates by link and by a similar title, keeps the links to the security', () => {
		const { m, id } = market();
		const a = { url: 'https://a/1', title: 'Nvidia shares fall 3% on China probe', publisher: 'Reuters', publishedAt: '2026-11-19T15:30:00.000Z', snippet: null };
		expect(storeItems(m, [a, { ...a, url: 'https://b/2', title: 'NVIDIA shares fall 3% on China probe!' }, a], 'google', id, 'stock', NOW)).toBe(1);
		storeItems(m, [a], 'yahoo', id, 'sector', NOW);
		const list = listNews(m, id, 30, NOW);
		expect(list).toHaveLength(1);
		expect(list[0].roles.sort()).toEqual(['sector', 'stock']);
		expect(titleKey('Nvidia — shares, fall!')).toBe('nvidia shares fall');
	});

	it('collects the three circles, asks each feed at most every half hour', async () => {
		const { m, id } = market();
		const asked: string[] = [];
		const get: Get = async (url) => {
			asked.push(url);
			if (url.includes('finance/search')) return { status: 200, body: JSON.stringify({ news: [{ title: 'Nvidia earnings preview for the week', link: 'https://y/1', publisher: 'Yahoo', providerPublishTime: Date.parse('2026-11-19T10:00:00Z') / 1000, relatedTickers: ['NVDA'] }] }) };
			const n = asked.length;
			return { status: 200, body: rss([{ title: `Story number ${n} about chips`, link: `https://g/${n}`, date: 'Wed, 19 Nov 2026 12:00:00 GMT', source: 'Src' }]) };
		};
		const r = await collect(m, id, { get, now: NOW });
		expect(r.errors).toEqual([]);
		const roles = listNews(m, id, 30, NOW).flatMap((x) => x.roles);
		expect(roles).toContain('stock');
		expect(roles).toContain('market');
		const first = asked.length;
		await collect(m, id, { get, now: new Date(NOW.getTime() + 10 * 60_000) });
		expect(asked.length).toBe(first);
		await collect(m, id, { get, now: new Date(NOW.getTime() + 31 * 60_000) });
		expect(asked.length).toBeGreaterThan(first);
	});

	it('splits the day move: market, sector and the share itself, as by hand', () => {
		const { m, id } = market();
		m.prepare(`insert into ref_provider_symbols (security_id, provider_code, provider_symbol) select id, 'yahoo', symbol from ref_securities where symbol = 'SOXX'`).run();
		const a = attribution(m, id, () => null, '2026-11-19')!;
		// by hand: total −3.30; market −2.02; sector −2.75 − (−2.02) = −0.73; itself −3.30 − (−2.75) = −0.55
		expect(a.total).toBeCloseTo(-3.3, 2);
		expect(a.market).toBeCloseTo(-2.02, 2);
		expect(a.sector).toBeCloseTo(-0.73, 2);
		expect(a.own).toBeCloseTo(-0.55, 2);
		expect(a.sectorRef?.symbol).toBe('SOXX');
		expect((a.market ?? 0) + (a.sector ?? 0) + a.own).toBeCloseTo(a.total, 2);
	});

	it('the trigger: at least max(2 ATR%, 3%) — a test move fires, an ordinary one does not', () => {
		const { m, id } = market();
		const atr = atrPct(m, id, '2026-11-19')!;
		expect(atr).toBeCloseTo(2, 0);
		expect(triggers(-3.3, atr)).toBe(false); // 2 ATR = 4%: an ordinary day for this share
		expect(triggers(-4.5, atr)).toBe(true);
		expect(triggers(2.9, 0.5)).toBe(false); // a calm share: still at least 3%
		expect(triggers(-3.1, 0.5)).toBe(true);
	});
});
