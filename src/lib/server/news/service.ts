import type Database from 'better-sqlite3';
import { compareRefs } from '../compare.js';
import { google, GLOBES_MARKETS, httpGet, maya, mayaCompany, rss, THEMARKER, yahoo, type FeedItem, type Get } from './feeds.js';

/**
 * T-022 «Почему двигается?»: the news of a security, its sector and its market in one place, and its day move
 * split into the market, the sector and the share itself.
 */

export type Role = 'stock' | 'sector' | 'market';

interface Sec {
	id: number;
	symbol: string;
	nameEn: string;
	nameHe: string | null;
	type: string;
	exchange: string;
	country: string;
	sector: string | null;
	industry: string | null;
	tase: string | null;
}

export function secOf(market: Database.Database, id: number): Sec | null {
	return (
		(market
			.prepare(
				`select s.id, s.symbol, s.name_en as nameEn, s.name_he as nameHe, s.type, s.exchange_code as exchange, e.country, p.sector, p.industry,
				        (select provider_symbol from ref_provider_symbols t where t.security_id = s.id and t.provider_code = 'tase') as tase
				   from ref_securities s join ref_exchanges e on e.code = s.exchange_code left join ref_security_profiles p on p.security_id = s.id where s.id = ?`
			)
			.get(id) as Sec | undefined) ?? null
	);
}

const benchmarkId = (market: Database.Database, key: string) =>
	(market.prepare(`select security_id as id from ref_provider_symbols where provider_code = 'seed' and provider_symbol = ?`).get(key) as { id: number } | undefined)?.id;

/** «NVIDIA Corporation» → «NVIDIA», «Applied Materials, Inc.» → «Applied Materials» */
export function shortName(name: string) {
	return (
		name
			.replace(/\b(class [a-z]|common stock|ordinary shares|american depositary shares|ads|adr)\b.*$/i, '')
			.replace(/[,.]?\s*\b(incorporated|inc|corporation|corp|company|co|ltd|limited|plc|holdings?|group|n\.?v|s\.?a|ag|se)\b\.?/gi, '')
			.replace(/\s+/g, ' ')
			.trim() || name
	);
}

/** the title's key: the same story from two feeds — lower case, letters and digits only */
export const titleKey = (t: string) =>
	t
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.slice(0, 90);

/** the five largest neighbours by market cap in the share's industry (or sector) on its market; or the edited list */
export function peersOf(market: Database.Database, s: Sec): { id: number; symbol: string; name: string }[] {
	const edited = (market.prepare('select value from ops_settings where key = ?').get(`news_peers:${s.id}`) as { value: string } | undefined)?.value;
	const bySym = market.prepare(`select id, symbol, name_en as name from ref_securities where symbol = ? and active = 1 and type = 'stock' order by exchange_code = 'TASE' = ? desc limit 1`);
	if (edited !== undefined)
		return edited
			.split(',')
			.map((x) => x.trim().toUpperCase())
			.filter(Boolean)
			.map((x) => bySym.get(x, s.country === 'IL' ? 1 : 0) as { id: number; symbol: string; name: string } | undefined)
			.filter((x): x is { id: number; symbol: string; name: string } => !!x);
	if (!s.industry && !s.sector) return [];
	return market
		.prepare(
			`select s.id, s.symbol, s.name_en as name from ref_securities s join ref_exchanges e on e.code = s.exchange_code join ref_security_profiles p on p.security_id = s.id
			  where s.active = 1 and s.type = 'stock' and s.id <> ? and e.country = ? and ${s.industry ? 'p.industry = ?' : 'p.sector = ?'} and p.market_cap is not null
			  order by p.market_cap desc limit 5`
		)
		.all(s.id, s.country, s.industry ?? s.sector) as { id: number; symbol: string; name: string }[];
}

export function setPeers(market: Database.Database, id: number, symbols: string | null) {
	if (symbols === null) market.prepare('delete from ops_settings where key = ?').run(`news_peers:${id}`);
	else
		market
			.prepare('insert into ops_settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value')
			.run(`news_peers:${id}`, symbols.toUpperCase().replace(/[^A-Z0-9.,]/g, ''));
}

/** stores the items, merging duplicates by link and by title within two days; links each to the security */
export function storeItems(market: Database.Database, items: FeedItem[], provider: string, securityId: number, role: Role, now = new Date()) {
	const byUrl = market.prepare('select id from news_items where url = ?');
	const byKey = market.prepare('select id from news_items where title_key = ? and published_at between ? and ? limit 1');
	const put = market.prepare(
		`insert into news_items (url, title, title_key, publisher, provider, published_at, snippet, fetched_at) values (?, ?, ?, ?, ?, ?, ?, ?) returning id`
	);
	const link = market.prepare('insert or ignore into news_links (news_id, security_id, role) values (?, ?, ?)');
	let added = 0;
	market.transaction(() => {
		for (const it of items) {
			const key = titleKey(it.title);
			if (key.length < 8) continue;
			const t = Date.parse(it.publishedAt);
			const from = new Date(t - 2 * 86_400_000).toISOString();
			const to = new Date(t + 2 * 86_400_000).toISOString();
			let id = (byUrl.get(it.url) as { id: number } | undefined)?.id ?? (byKey.get(key, from, to) as { id: number } | undefined)?.id;
			if (!id) {
				id = (put.get(it.url, it.title.slice(0, 400), key, it.publisher, provider, it.publishedAt, it.snippet?.slice(0, 400) ?? null, now.toISOString()) as { id: number }).id;
				added++;
			}
			link.run(id, securityId, role);
		}
	})();
	return added;
}

/** a feed asked for the same key not more often than every `minutes` */
async function throttled(market: Database.Database, key: string, minutes: number, f: () => Promise<number>, now: Date) {
	const r = market.prepare('select fetched_at as at from news_fetches where key = ?').get(key) as { at: string } | undefined;
	if (r && now.getTime() - Date.parse(r.at) < minutes * 60_000) return 0;
	const mark = market.prepare(
		`insert into news_fetches (key, fetched_at, items, error) values (?, ?, ?, ?) on conflict (key) do update set fetched_at = excluded.fetched_at, items = excluded.items, error = excluded.error`
	);
	try {
		const n = await f();
		mark.run(key, now.toISOString(), n, null);
		return n;
	} catch (e) {
		mark.run(key, now.toISOString(), 0, String(e).slice(0, 200));
		return 0;
	}
}

const recent = (items: FeedItem[], days: number, now: Date) => items.filter((x) => Date.parse(x.publishedAt) > now.getTime() - days * 86_400_000);
const q = (s: string) => `"${s.replace(/"/g, '')}"`;

export interface CollectSummary {
	added: number;
	errors: string[];
}

/**
 * Collects the news of a security's three circles: the share (Google by name and symbol, Yahoo, Maya for a TASE
 * share), the sector (its industry and the five largest neighbours) and the market (the day's market news).
 * Each feed is asked at most every half hour; the items are kept with their links to the security.
 */
export async function collect(market: Database.Database, id: number, opts: { get?: Get; now?: Date; minutes?: number } = {}): Promise<CollectSummary> {
	const get = opts.get ?? httpGet;
	const now = opts.now ?? new Date();
	const minutes = opts.minutes ?? 30;
	const s = secOf(market, id);
	const out: CollectSummary = { added: 0, errors: [] };
	if (!s) return out;
	const il = s.country === 'IL';
	const name = shortName(s.nameEn);
	const run = async (key: string, role: Role, provider: string, f: () => Promise<FeedItem[]>, days: number) => {
		out.added += await throttled(
			market,
			`${key}|${id}|${role}`,
			minutes,
			async () => storeItems(market, recent(await f(), days, now), provider, id, role, now),
			now
		).catch((e) => (out.errors.push(String(e)), 0));
	};
	// the share itself
	const symbolOk = s.symbol.length >= 3 && !/\d/.test(s.symbol);
	if (il) {
		if (s.nameHe) await run(`google-he:${s.nameHe}`, 'stock', 'google', () => google(get, `${q(s.nameHe!)} when:7d`, true), 7);
		await run(`google:${name}`, 'stock', 'google', () => google(get, `${q(name)} when:7d`), 7);
		if (s.tase) {
			let company = (market.prepare('select company_id as c from news_maya_companies where security_id = ?').get(id) as { c: number | null } | undefined)?.c;
			if (company === undefined) {
				company = await mayaCompany(get, s.tase).catch(() => null);
				market.prepare('insert or replace into news_maya_companies (security_id, company_id, fetched_at) values (?, ?, ?)').run(id, company, now.toISOString());
			}
			if (company) await run(`maya:${company}`, 'stock', 'maya', () => maya(get, company!), 14);
		}
	} else {
		await run(`google:${name}:${s.symbol}`, 'stock', 'google', () => google(get, `(${q(name)}${symbolOk ? ` OR ${q(s.symbol)}` : ''}) when:7d`), 7);
		if (symbolOk)
			await run(
				`yahoo:${s.symbol}`,
				'stock',
				'yahoo',
				async () => {
					// Yahoo's search mixes in general market news: only the ones about this share
					const about = new RegExp(`\\b(${s.symbol}|${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
					return (await yahoo(get, s.symbol)).filter((x) => x.tickers?.includes(s.symbol) || about.test(x.title));
				},
				7
			);
	}
	// the sector: its industry's news and its largest neighbours
	const peers = peersOf(market, s);
	if (peers.length)
		await run(
			`google-peers:${peers.map((p) => p.symbol).join(',')}`,
			'sector',
			'google',
			() => google(get, `(${peers.map((p) => q(shortName(p.name))).join(' OR ')}) when:3d`, false),
			3
		);
	if (s.industry && !il) await run(`google-ind:${s.industry}`, 'sector', 'google', () => google(get, `${q(s.industry!)} stocks when:2d`), 2);
	// the market
	if (il) {
		await run('globes:markets', 'market', 'globes', () => rss(get, GLOBES_MARKETS), 2);
		await run('themarker', 'market', 'themarker', () => rss(get, THEMARKER), 2);
	} else await run('google:market', 'market', 'google', () => google(get, `("stock market" OR "Wall Street" OR "S&P 500") when:1d`), 2);
	return out;
}

export interface NewsRow {
	id: number;
	url: string;
	title: string;
	publisher: string | null;
	provider: string;
	publishedAt: string;
	snippet: string | null;
	roles: Role[];
}

/** a security's news, newest first; `days` back from `now` */
export function listNews(market: Database.Database, id: number, days = 30, now = new Date()): NewsRow[] {
	const from = new Date(now.getTime() - days * 86_400_000).toISOString();
	const rows = market
		.prepare(
			`select n.id, n.url, n.title, n.publisher, n.provider, n.published_at as publishedAt, n.snippet, group_concat(l.role) as roles
			   from news_links l join news_items n on n.id = l.news_id
			  where l.security_id = ? and n.published_at >= ? group by n.id order by n.published_at desc limit 400`
		)
		.all(id, from) as (Omit<NewsRow, 'roles'> & { roles: string })[];
	return rows.map((r) => ({ ...r, roles: [...new Set(r.roles.split(','))] as Role[] }));
}

// ── the day move split ─────────────────────────────────────────────────────────

export interface Attribution {
	date: string;
	live: boolean;
	total: number;
	market: number | null;
	sector: number | null;
	own: number;
	sectorRef: { id: number; symbol: string; label: string } | null;
	benchLabel: string;
}

type DayMove = { now: number; prev: number; date: string; live: boolean } | null;

/** the change of a security's daily close on `date` against the close before */
function dailyChange(market: Database.Database, id: number, date: string): number | null {
	const d = market.prepare('select close from market_prices_daily where security_id = ? and date = ?').get(id, date) as { close: number } | undefined;
	const b = market.prepare('select close from market_prices_daily where security_id = ? and date < ? order by date desc limit 1').get(id, date) as { close: number } | undefined;
	return d && b && b.close > 0 ? (d.close / b.close - 1) * 100 : null;
}

/**
 * The day move split by plain subtraction: the market is the benchmark's move; the sector — its ETF's move less
 * the market's; the share itself — the rest. Live quotes when all three have them for the same day; otherwise the
 * daily closes of the share's last day (or of `date`).
 */
export function attribution(market: Database.Database, id: number, dayMove: (id: number) => DayMove, date?: string): Attribution | null {
	const s = secOf(market, id);
	if (!s) return null;
	const refs = compareRefs(market, id);
	const ref = refs.find((r) => r.role === 'industry') ?? refs.find((r) => r.role === 'sector') ?? null;
	const benchId = benchmarkId(market, s.country === 'IL' ? 'benchmark:TA125' : 'benchmark:SPX') ?? null;
	const benchLabel = s.country === 'IL' ? 'ТА-125' : 'S&P 500';
	const pct = (m: DayMove) => (m && m.prev > 0 ? (m.now / m.prev - 1) * 100 : null);
	const split = (total: number, b: number | null, e: number | null, d: string, live: boolean): Attribution => {
		const r = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
		const sector = e !== null && b !== null ? e - b : null;
		const own = total - (e ?? b ?? 0);
		return { date: d, live, total: r(total)!, market: r(b), sector: r(sector), own: r(own)!, sectorRef: ref ? { id: ref.id, symbol: ref.symbol, label: ref.label } : null, benchLabel };
	};
	if (!date) {
		const me = dayMove(id);
		const b = benchId ? dayMove(benchId) : null;
		const e = ref ? dayMove(ref.id) : null;
		const total = pct(me);
		if (me && total !== null && (!b || b.date === me.date) && (!e || e.date === me.date) && me.live) return split(total, pct(b), pct(e), me.date, true);
		const last = market.prepare('select date from market_prices_daily where security_id = ? order by date desc limit 1').get(id) as { date: string } | undefined;
		if (!last) return null;
		date = last.date;
	}
	const total = dailyChange(market, id, date);
	if (total === null) return null;
	return split(total, benchId ? dailyChange(market, benchId, date) : null, ref ? dailyChange(market, ref.id, date) : null, date, false);
}

// ── the trigger ────────────────────────────────────────────────────────────────

/** the average true range of the last 14 days, % of the close */
export function atrPct(market: Database.Database, id: number, upTo?: string): number | null {
	const rows = (
		market
			.prepare(`select date, low, high, close from market_prices_daily where security_id = ? ${upTo ? 'and date < ?' : ''} order by date desc limit 15`)
			.all(...(upTo ? [id, upTo] : [id])) as { date: string; low: number | null; high: number | null; close: number }[]
	).reverse();
	if (rows.length < 6) return null;
	const tr: number[] = [];
	for (let i = 1; i < rows.length; i++) {
		const p = rows[i - 1].close;
		const x = rows[i];
		if (!(p > 0)) continue;
		const range = x.high !== null && x.low !== null ? Math.max(x.high - x.low, Math.abs(x.high - p), Math.abs(x.low - p)) : Math.abs(x.close - p);
		tr.push((range / p) * 100);
	}
	return tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : null;
}

/** the spec's threshold: a day move of at least max(2 ATR%, 3%) */
export const triggers = (movePct: number, atr: number | null) => Math.abs(movePct) >= Math.max(2 * (atr ?? 0), 3);
