import { request } from 'node:https';
import { gunzipSync } from 'node:zlib';

/**
 * T-022: the news feeds, checked from the NAS on 20.11.2026 (stage 0): Google News RSS (search by name and
 * symbol, English and Hebrew), Yahoo Finance search (news with their related symbols), the TASE reports site
 * Maya (its own JSON — not an official API), the Globes and TheMarker RSS feeds. Only the title, the link, the
 * publisher, the time and a short fragment are kept — never an article's text.
 */

export interface FeedItem {
	url: string;
	title: string;
	publisher: string | null;
	publishedAt: string;
	snippet: string | null;
	/** Yahoo: the symbols the item is about */
	tickers?: string[];
}

export type Get = (url: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ status: number; body: string }>;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/** plain node:https — the TASE site's protection answers 403 to Node's fetch (see market/http.ts) */
export const httpGet: Get = (url, opts = {}) =>
	new Promise((resolve, reject) => {
		const body = opts.body;
		const req = request(
			url,
			{
				method: opts.method ?? 'GET',
				headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip', ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}), ...opts.headers },
				timeout: 20_000
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c: Buffer) => chunks.push(c));
				res.on('end', () => {
					let b = Buffer.concat(chunks);
					try {
						if (res.headers['content-encoding'] === 'gzip') b = gunzipSync(b);
					} catch {
						b = Buffer.alloc(0);
					}
					resolve({ status: res.statusCode ?? 0, body: b.toString('utf8') });
				});
				res.on('error', reject);
			}
		);
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.on('error', reject);
		req.end(body);
	});

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s: string) =>
	s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
			e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e.toLowerCase()] ?? m)
		);
const strip = (s: string) => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (x: string, name: string) => {
	const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(x);
	return m ? m[1] : null;
};
const iso = (d: string | null) => {
	const t = d ? Date.parse(d) : NaN;
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** an RSS feed's items; Google's titles end in « - Publisher» — taken off, the publisher kept */
export function parseRss(xml: string): FeedItem[] {
	const out: FeedItem[] = [];
	for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
		const x = m[1];
		const link = strip(tag(x, 'link') ?? '');
		let title = strip(tag(x, 'title') ?? '');
		const at = iso(strip(tag(x, 'pubDate') ?? '')) ?? iso(strip(tag(x, 'dc:date') ?? ''));
		if (!link || !title || !at) continue;
		let publisher = tag(x, 'source') ? strip(tag(x, 'source')!) : null;
		if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -publisher.length - 3).trim();
		const desc = strip(tag(x, 'description') ?? '');
		// Google's description repeats the title and the publisher: no fragment there
		const snippet = desc && !desc.startsWith(title.slice(0, 30)) ? desc.slice(0, 300) : null;
		out.push({ url: link, title, publisher, publishedAt: at, snippet });
	}
	return out;
}

export const googleUrl = (q: string, he = false) =>
	`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${he ? 'hl=iw&gl=IL&ceid=IL:he' : 'hl=en-US&gl=US&ceid=US:en'}`;

export async function google(get: Get, q: string, he = false): Promise<FeedItem[]> {
	const r = await get(googleUrl(q, he));
	if (r.status !== 200) throw new Error(`google ${r.status}`);
	return parseRss(r.body);
}

/** Yahoo's search: news with the symbols they are about; answers 429 if asked often */
export async function yahoo(get: Get, symbol: string): Promise<FeedItem[]> {
	const r = await get(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=20&quotesCount=0`);
	if (r.status !== 200) throw new Error(`yahoo ${r.status}`);
	const j = JSON.parse(r.body) as { news?: { title: string; publisher?: string; link: string; providerPublishTime: number; relatedTickers?: string[] }[] };
	return (j.news ?? []).map((n) => ({
		url: n.link,
		title: n.title,
		publisher: n.publisher ?? null,
		publishedAt: new Date(n.providerPublishTime * 1000).toISOString(),
		snippet: null,
		tickers: n.relatedTickers ?? []
	}));
}

const mayaHeaders = { Accept: 'application/json, text/plain, */*', Origin: 'https://maya.tase.co.il', Referer: 'https://maya.tase.co.il/he/reports/companies' };

/** the Maya company of a TASE security number (the TASE «מספר נייר») */
export async function mayaCompany(get: Get, taseNumber: string): Promise<number | null> {
	const r = await get(`https://maya.tase.co.il/api/v1/tradingdata?securityId=${encodeURIComponent(taseNumber)}`, { headers: mayaHeaders });
	if (r.status !== 200) throw new Error(`maya ${r.status}`);
	const id = (JSON.parse(r.body) as { companyId?: number }).companyId;
	return typeof id === 'number' ? id : null;
}

/** «2026-11-20T16:05:09.69» on Maya is Israel time without a zone */
function israelIso(local: string) {
	const guess = Date.parse(local + 'Z');
	if (!Number.isFinite(guess)) return null;
	const inIsrael = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
	const asUtc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
	return new Date(guess - (inIsrael.getTime() - asUtc.getTime())).toISOString();
}

/** the company's last reports on Maya */
export async function maya(get: Get, companyId: number): Promise<FeedItem[]> {
	const r = await get('https://maya.tase.co.il/api/v1/reports/companies', {
		method: 'POST',
		body: JSON.stringify({ companyId, limit: 20, offset: 0 }),
		headers: { ...mayaHeaders, 'Content-Type': 'application/json' }
	});
	if (r.status !== 200) throw new Error(`maya ${r.status}`);
	const list = JSON.parse(r.body) as { id: number; title: string; publishDate: string; companies?: { companyId: number; name: string }[] }[];
	return list
		.filter((x) => !x.companies?.length || x.companies.some((c) => c.companyId === companyId))
		.map((x) => {
			const name = x.companies?.find((c) => c.companyId === companyId)?.name;
			return { url: `https://maya.tase.co.il/he/reports/${x.id}`, title: name ? `${name}: ${x.title}` : x.title, publisher: 'מאיה', publishedAt: israelIso(x.publishDate) ?? new Date().toISOString(), snippet: null };
		});
}

export const GLOBES_MARKETS = 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=585';
export const THEMARKER = 'https://www.themarker.com/cmlink/1.145';

export async function rss(get: Get, url: string): Promise<FeedItem[]> {
	const r = await get(url);
	if (r.status !== 200) throw new Error(`rss ${r.status}`);
	return parseRss(r.body);
}
