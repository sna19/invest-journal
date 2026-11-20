import type Database from 'better-sqlite3';
import { fetchGet, session, type ProfileGet } from './profiles.js';
import { securitiesForPrices } from './prices.js';

/**
 * T-013: the calendar of a company's earnings reports and dividends — the reason labels of the quarterly model read
 * it. Checked 21.11.2026: Yahoo's earnings calendar (the «visualization» query its earnings pages use — the same
 * cookie and crumb as the profiles) gives the past reports since 2000–2014, for TASE shares too, but nothing after
 * May 2025; the next report comes from the share's calendar (quoteSummary calendarEvents). The dividends' ex-dates
 * come from the chart's events, 15 years. Free — no budget needed.
 */

export interface Events {
	earnings: string[];
	dividends: string[];
}

/** POST through the fetch the profiles use; tests pass their own */
export type Post = (url: string, body: string, cookie: string) => Promise<{ status: number; body: string }>;
export const fetchPost: Post = async (url, body, cookie) => {
	const r = await fetch(url, { method: 'POST', body, headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json', Cookie: cookie }, signal: AbortSignal.timeout(20_000) });
	return { status: r.status, body: await r.text() };
};

/** a time from Yahoo's calendar as the day it happened on the exchange: a report after the US close stays that day */
const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export function parseCalendar(body: string, tz: string): string[] {
	const doc = JSON.parse(body)?.finance?.result?.[0]?.documents?.[0];
	if (!doc) return [];
	const col = (doc.columns as { id: string }[]).findIndex((c) => c.id === 'startdatetime');
	if (col < 0) return [];
	return [...new Set((doc.rows as unknown[][]).map((r) => String(r[col] ?? '')).filter((x) => /^\d{4}-\d{2}-\d{2}T/.test(x)).map((x) => dayOf(x, tz)))].sort();
}

export function parseDividends(body: string, tz: string): string[] {
	const d = JSON.parse(body)?.chart?.result?.[0]?.events?.dividends ?? {};
	return [...new Set(Object.values(d as Record<string, { date: number }>).map((x) => dayOf(new Date(x.date * 1000).toISOString(), tz)))].sort();
}

export function parseNext(body: string, tz: string): { earnings: string[]; dividends: string[] } {
	const c = JSON.parse(body)?.quoteSummary?.result?.[0]?.calendarEvents ?? {};
	const at = (x: { raw?: number } | undefined) => (typeof x?.raw === 'number' ? dayOf(new Date(x.raw * 1000).toISOString(), tz) : null);
	return {
		earnings: ((c.earnings?.earningsDate ?? []) as { raw?: number }[]).map(at).filter((x): x is string => !!x).slice(0, 1),
		// the ex-date is a date given as midnight UTC, not a moment: read it in UTC
		dividends: [typeof c.exDividendDate?.raw === 'number' ? new Date(c.exDividendDate.raw * 1000).toISOString().slice(0, 10) : null].filter((x): x is string => !!x)
	};
}

const DAY = 86_400_000;

/** the securities of `ids` whose events are not loaded or older than 30 days */
export function eventsDue(market: Database.Database, ids: number[], now = new Date()): number[] {
	const q = market.prepare('select fetched_at as at, status from ops_events_loads where security_id = ?');
	return ids.filter((id) => {
		const r = q.get(id) as { at: string; status: string } | undefined;
		// an error is asked again in three days, the rest in a month
		return !r || now.getTime() - Date.parse(r.at) > (r.status === 'error' ? 3 : 30) * DAY;
	});
}

export interface EventsSummary {
	securities: number;
	loaded: number;
	none: number;
	errors: string[];
}

export async function loadEvents(
	market: Database.Database,
	ids: number[],
	opts: { get?: ProfileGet; post?: Post; now?: Date; pause?: number } = {}
): Promise<EventsSummary> {
	const now = opts.now ?? new Date();
	const get = opts.get ?? fetchGet;
	const post = opts.post ?? fetchPost;
	const secs = securitiesForPrices(market, eventsDue(market, ids, now)).filter((s) => !s.isBenchmark);
	const out: EventsSummary = { securities: secs.length, loaded: 0, none: 0, errors: [] };
	if (!secs.length) return out;
	const { cookie, crumb } = await session(get);
	const tzOf = market.prepare(`select e.country from ref_securities s join ref_exchanges e on e.code = s.exchange_code where s.id = ?`);
	const del = market.prepare(`delete from ref_security_events where security_id = ? and provider_code in ('yahoo-calendar', 'yahoo-chart', 'yahoo-next')`);
	const put = market.prepare('insert or ignore into ref_security_events (security_id, kind, date, provider_code) values (?, ?, ?, ?)');
	const mark = market.prepare(
		`insert into ops_events_loads (security_id, fetched_at, status, earnings, dividends, error) values (?, ?, ?, ?, ?, ?)
		 on conflict (security_id) do update set fetched_at = excluded.fetched_at, status = excluded.status, earnings = excluded.earnings, dividends = excluded.dividends, error = excluded.error`
	);
	const pause = () => (opts.pause === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, opts.pause ?? 300)));
	for (const sec of secs) {
		const tz = (tzOf.get(sec.id) as { country: string } | undefined)?.country === 'IL' ? 'Asia/Jerusalem' : 'America/New_York';
		try {
			const body = JSON.stringify({
				size: 100,
				query: { operator: 'and', operands: [{ operator: 'eq', operands: ['ticker', sec.yahoo] }, { operator: 'eq', operands: ['eventtype', '2'] }] },
				sortField: 'startdatetime',
				sortType: 'DESC',
				entityIdType: 'earnings',
				includeFields: ['startdatetime', 'eventtype']
			});
			const cal = await post(`https://query1.finance.yahoo.com/v1/finance/visualization?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`, body, cookie);
			if (cal.status !== 200) throw new Error(`calendar ${cal.status}`);
			const earnings = parseCalendar(cal.body, tz);
			await pause();
			const ch = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sec.yahoo)}?range=15y&interval=3mo&events=div`, cookie);
			if (ch.status !== 200 && ch.status !== 404) throw new Error(`chart ${ch.status}`);
			const dividends = ch.status === 200 ? parseDividends(ch.body, tz) : [];
			await pause();
			const nx = await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sec.yahoo)}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`, cookie);
			const next = nx.status === 200 ? parseNext(nx.body, tz) : { earnings: [], dividends: [] };
			market.transaction(() => {
				del.run(sec.id);
				for (const d of earnings) put.run(sec.id, 'earnings', d, 'yahoo-calendar');
				for (const d of dividends) put.run(sec.id, 'dividend', d, 'yahoo-chart');
				for (const d of next.earnings) put.run(sec.id, 'earnings', d, 'yahoo-next');
				for (const d of next.dividends) put.run(sec.id, 'dividend', d, 'yahoo-next');
				const n = earnings.length + dividends.length;
				mark.run(sec.id, now.toISOString(), n ? 'ok' : 'none', earnings.length, dividends.length, null);
			})();
			if (earnings.length + dividends.length) out.loaded++;
			else out.none++;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			mark.run(sec.id, now.toISOString(), 'error', 0, 0, msg.slice(0, 200));
			out.errors.push(`${sec.symbol}: ${msg}`);
		}
		await pause();
	}
	return out;
}
