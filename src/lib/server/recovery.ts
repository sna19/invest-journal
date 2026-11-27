import type Database from 'better-sqlite3';
import { barsOf } from './protection.js';

/**
 * Owner 27.11.2026: a share that fell deep while held without a stop — «вижу только фиаско, не вижу, что она на пути
 * подъёма». The price's state after the fall, from the daily closes: how far above the 3-month low it is, where it
 * stands against its SMA50 and SMA200, the month's move, and the high since the purchase. The stage:
 * falling — under the SMA50 and within 8% of the low; basing — the fall stopped (over 8% above the low) but under the
 * SMA50; recovering — above the SMA50; uptrend — above both the SMA50 and the SMA200.
 */
export type RecoveryStage = 'falling' | 'basing' | 'recovering' | 'uptrend';

export function recoveryStage(last: number, sma50: number | null, sma200: number | null, fromLow: number): RecoveryStage {
	if (sma50 !== null && last > sma50 && sma200 !== null && last > sma200) return 'uptrend';
	if (sma50 !== null && last > sma50) return 'recovering';
	return fromLow > 0.08 ? 'basing' : 'falling';
}

export function recoveryOf(market: Database.Database, securityId: number, since: string | null = null) {
	const b = barsOf(market, securityId, 400);
	if (b.length < 60) return null;
	const closes = b.map((x) => x.close);
	const last = closes.at(-1)!;
	const avg = (n: number) => (closes.length >= n ? closes.slice(-n).reduce((a, x) => a + x, 0) / n : null);
	const sma50 = avg(50);
	const sma200 = avg(200);
	const q = b.slice(-63);
	const low = q.reduce((m, x) => (x.close < m.close ? x : m), q[0]);
	const held = since ? b.filter((x) => x.date >= since) : b;
	const high = (held.length ? held : b).reduce((m, x) => (x.close > m.close ? x : m), (held.length ? held : b)[0]);
	const fromLow = last / low.close - 1;
	const r4 = (x: number) => Math.round(x * 10000) / 10000;
	return {
		date: b.at(-1)!.date,
		last,
		sma50,
		sma200,
		low: low.close,
		lowDate: low.date,
		fromLow: r4(fromLow),
		high: high.close,
		highDate: high.date,
		fromHigh: r4(last / high.close - 1),
		month: closes.length > 21 ? r4(last / closes.at(-22)! - 1) : null,
		stage: recoveryStage(last, sma50, sma200, fromLow)
	};
}
