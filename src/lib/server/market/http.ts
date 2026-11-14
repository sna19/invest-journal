import type { Fetcher } from './types.js';

const UA = 'Mozilla/5.0 (compatible; invest-journal)';

export class HttpError extends Error {
	constructor(
		public status: number | string,
		url: string
	) {
		super(`${status} ${url}`);
	}
}

/**
 * Step 1 of the pipeline: GET with three retries and a growing pause (2, 4, 8 s). The TASE site sometimes
 * answers 403 at random (stage 0), so 403 is retried too; 404 is final.
 */
export function makeFetcher(opts: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; retries?: number } = {}): Fetcher {
	const f = opts.fetch ?? fetch;
	const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const retries = opts.retries ?? 3;
	return async (url, headers = {}) => {
		for (let attempt = 0; ; attempt++) {
			let status: number | string;
			try {
				const r = await f(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(60_000) });
				if (r.ok) return Buffer.from(await r.arrayBuffer());
				status = r.status;
			} catch (e) {
				status = (e as Error).name;
			}
			if (status === 404 || attempt >= retries) throw new HttpError(status, url);
			await sleep(2000 * 2 ** attempt);
		}
	};
}
