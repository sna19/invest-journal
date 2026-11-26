/**
 * T-015: the trade's risk — what is lost if the stop is hit: (entry − stop) × quantity, in the portfolio's currency
 * and in % of the portfolio's value. `factor` — of the price unit (agorot → shekels 0.01), `toPc` — the position's
 * currency in the portfolio's.
 */
export function tradeRisk(o: { entry: number | null; stop: number | null; qty: number | null; factor: number; toPc: number | null; portfolioValue: number | null }) {
	const { entry, stop, qty, factor, toPc, portfolioValue } = o;
	if (stop === null || !entry || !qty || toPc === null || stop >= entry) return null;
	const money = (entry - stop) * qty * factor * toPc;
	return { money, pct: portfolioValue ? (money / portfolioValue) * 100 : null, stopPct: (1 - stop / entry) * 100 };
}
