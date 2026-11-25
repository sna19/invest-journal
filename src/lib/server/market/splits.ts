import type Database from 'better-sqlite3';

/**
 * Daily closes in the current split scale (owner's question 25.11.2026: EMBJ «80 → 18» — the 4:1 split of
 * 16.11.2026 was not applied to the closes before it, by Yahoo either). For each split the closes around its ex-date
 * tell whether the history is already adjusted: the close before against the first on or after it — near the
 * split's ratio means not adjusted, near 1 means adjusted (then nothing is done, so a later re-adjusted load is not
 * divided twice). Returns the divisor for a date's close: the product of the ratios of the unadjusted splits after it.
 */
export function splitScale(market: Database.Database, id: number): (date: string) => number {
	const splits = market
		.prepare(`select ex_date as date, ratio from market_corporate_actions where security_id = ? and kind = 'split' and ratio > 0 and ratio <> 1 order by ex_date`)
		.all(id) as { date: string; ratio: number }[];
	if (!splits.length) return () => 1;
	const before = market.prepare('select close from market_prices_daily where security_id = ? and date < ? order by date desc limit 1');
	const after = market.prepare('select close from market_prices_daily where security_id = ? and date >= ? order by date limit 1');
	const open: { date: string; ratio: number }[] = [];
	for (const s of splits) {
		const b = (before.get(id, s.date) as { close: number } | undefined)?.close;
		const a = (after.get(id, s.date) as { close: number } | undefined)?.close;
		if (!b || !a) continue;
		const jump = Math.log(b / a);
		// nearer to the split's ratio than to «no change»: the closes before it are in the old scale
		if (Math.abs(jump - Math.log(s.ratio)) < Math.abs(jump)) open.push(s);
	}
	if (!open.length) return () => 1;
	return (date: string) => open.filter((s) => s.date > date).reduce((f, s) => f * s.ratio, 1);
}

/** the rows' closes brought to the current split scale */
export function adjustRows<T extends { date: string; close: number }>(market: Database.Database, id: number, rows: T[]): T[] {
	const f = splitScale(market, id);
	return rows.map((r) => {
		const k = f(r.date);
		return k === 1 ? r : { ...r, close: r.close / k };
	});
}
