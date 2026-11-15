import { normalizeUrl } from '../hypothesis.js';
import { httpsGet } from './market/http.js';

/**
 * Spec section 13 — the article's title comes by itself. Best effort: og:title or <title> of the page, a few
 * seconds at most; paywalled sites often refuse robots, then the field stays empty for the user to fill.
 */
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

export function titleFromHtml(html: string): string | null {
	const meta = /<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*>/i.exec(html)?.[0];
	const content = meta && /content=["']([^"']*)["']/i.exec(meta)?.[1];
	const raw = content || /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
	const t = raw ? decodeEntities(raw).replace(/\s+/g, ' ').trim() : '';
	return t ? t.slice(0, 300) : null;
}

export async function fetchTitle(rawUrl: string, timeoutMs = 5000): Promise<string | null> {
	let url = normalizeUrl(rawUrl);
	const deadline = Date.now() + timeoutMs;
	for (let hop = 0; url && hop < 4 && Date.now() < deadline; hop++) {
		const r = await Promise.race([
			httpsGetFollow(url),
			new Promise<null>((res) => setTimeout(() => res(null), Math.max(0, deadline - Date.now())))
		]).catch(() => null);
		if (!r) return null;
		if (r.location) {
			url = new URL(r.location, url).toString();
			continue;
		}
		if (r.status !== 200) return null;
		return titleFromHtml(r.body.subarray(0, 300_000).toString('utf8'));
	}
	return null;
}

async function httpsGetFollow(url: string) {
	if (!url.startsWith('https:')) return null;
	const r = await httpsGet(url, { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'he,en;q=0.8,ru;q=0.6' }, true);
	return { status: r.status, body: r.body, location: r.status >= 300 && r.status < 400 ? r.location : undefined };
}
