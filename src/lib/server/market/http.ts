import { request } from 'node:https';
import { gunzipSync } from 'node:zlib';
import type { Fetcher } from './types.js';

const UA = 'Mozilla/5.0';

export class HttpError extends Error {
	constructor(
		public status: number | string,
		url: string
	) {
		super(`${status} ${url}`);
	}
}

/** One GET through node:https: only the headers we pass. */
type Get = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: Buffer }>;

/**
 * Plain node:https rather than fetch: the TASE site's protection (Incapsula) answers 403 to Node's fetch
 * whatever the headers — it recognises the extra headers undici adds — and 200 to a bare request with
 * Origin and Referer (checked 15.11.2026).
 */
export const httpsGet: Get = (url, headers) =>
	new Promise((resolve, reject) => {
		const req = request(url, { headers: { 'Accept-Encoding': 'gzip', ...headers }, timeout: 60_000 }, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (c: Buffer) => chunks.push(c));
			res.on('end', () => {
				let body = Buffer.concat(chunks);
				if (res.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
				resolve({ status: res.statusCode ?? 0, body });
			});
			res.on('error', reject);
		});
		req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
		req.on('error', reject);
		req.end();
	});

/** For tests: the same contract on top of a fetch function. */
export const viaFetch =
	(f: typeof fetch): Get =>
	async (url, headers) => {
		const r = await f(url, { headers });
		return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
	};

/**
 * Step 1 of the pipeline: GET with three retries and a growing pause (2, 4, 8 s). The TASE site sometimes
 * answers 403 at random (stage 0), so 403 is retried too; 404 is final.
 */
export function makeFetcher(opts: { get?: Get; sleep?: (ms: number) => Promise<void>; retries?: number } = {}): Fetcher {
	const get = opts.get ?? httpsGet;
	const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const retries = opts.retries ?? 3;
	return async (url, headers = {}) => {
		for (let attempt = 0; ; attempt++) {
			let status: number | string;
			try {
				const r = await get(url, { 'User-Agent': UA, ...headers });
				if (r.status >= 200 && r.status < 300) return r.body;
				status = r.status;
			} catch (e) {
				status = (e as Error).name;
			}
			if (status === 404 || attempt >= retries) throw new HttpError(status, url);
			await sleep(2000 * 2 ** attempt);
		}
	};
}
