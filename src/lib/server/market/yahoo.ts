import type { Fetcher, RawPayload } from './types.js';

/**
 * Prices and corporate actions: Yahoo Finance chart API (stage 0). One request gives both — the closes and the
 * dividends and splits of the period — so fetch_prices and fetch_actions share it. Facts checked on 15.11.2026:
 * closes are already adjusted for splits (NVDA 2024-06-07: 120.89, not 1208.9), not for dividends; TASE shares
 * are quoted in agorot (currency ILA), indices in points; dividend amounts are in the same unit as the closes.
 */
export const YAHOO = 'yahoo';

export interface PriceRow {
	date: string;
	open: number | null;
	high: number | null;
	low: number | null;
	close: number;
	volume: number | null;
}

export interface ActionRow {
	exDate: string;
	kind: 'dividend' | 'split';
	ratio: number | null;
	amount: number | null;
}

export interface Parsed {
	/** USD | ILS | ILA, as the provider says */
	unit: string | null;
	rows: PriceRow[];
	actions: ActionRow[];
	/** rows without a close (TASE Fridays before 2026) — dropped */
	empty: number;
}

const day = (sec: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(sec * 1000));

export function chartUrl(symbol: string, from: string, to: string) {
	// period2 is exclusive: one day past `to`
	const p1 = Math.floor(Date.parse(from + 'T00:00:00Z') / 1000);
	const p2 = Math.floor(Date.parse(to + 'T00:00:00Z') / 1000) + 2 * 86400;
	return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit&includeAdjustedClose=true`;
}

export async function fetchPrices(get: Fetcher, symbol: string, from: string, to: string): Promise<RawPayload> {
	return { name: `${symbol.replace(/[^\w.-]/g, '_')}-${from}-${to}.json`, body: await get(chartUrl(symbol, from, to)) };
}

/** The same answer read for actions (spec section 14 names the two functions separately). */
export const fetchActions = fetchPrices;

export function parseChart(raw: RawPayload, from: string, to: string): Parsed {
	const j = JSON.parse(raw.body.toString('utf8'));
	const r = j?.chart?.result?.[0];
	if (!r) return { unit: null, rows: [], actions: [], empty: 0 };
	const tz: string = r.meta?.exchangeTimezoneName ?? 'UTC';
	const q = r.indicators?.quote?.[0] ?? {};
	const rows: PriceRow[] = [];
	let empty = 0;
	(r.timestamp ?? []).forEach((t: number, i: number) => {
		const close = q.close?.[i];
		if (close === null || close === undefined) return void empty++;
		const date = day(t, tz);
		if (date < from || date > to) return;
		const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
		rows.push({ date, open: n(q.open?.[i]), high: n(q.high?.[i]), low: n(q.low?.[i]), close, volume: n(q.volume?.[i]) });
	});
	// a day can appear twice when the last bar is still forming: keep the last
	const byDate = new Map(rows.map((x) => [x.date, x]));
	const actions: ActionRow[] = [];
	for (const d of Object.values<{ date: number; amount: number }>(r.events?.dividends ?? {}))
		actions.push({ exDate: day(d.date, tz), kind: 'dividend', ratio: null, amount: d.amount });
	for (const s of Object.values<{ date: number; numerator: number; denominator: number }>(r.events?.splits ?? {}))
		actions.push({ exDate: day(s.date, tz), kind: 'split', ratio: s.numerator / s.denominator, amount: null });
	return {
		unit: r.meta?.currency ?? null,
		rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
		actions: actions.filter((a) => a.exDate >= from && a.exDate <= to),
		empty
	};
}
