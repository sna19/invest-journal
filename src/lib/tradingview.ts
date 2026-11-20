/**
 * A link to the security's chart on TradingView (owner's request 20.11.2026): opens in a new window, by
 * exchange and ticker. Our exchange codes → TradingView's prefixes; NYSE Arca lines trade there as AMEX.
 */
const PREFIX: Record<string, string> = {
	NASDAQ: 'NASDAQ',
	NYSE: 'NYSE',
	NYSE_AMERICAN: 'AMEX',
	NYSE_ARCA: 'AMEX',
	CBOE_BZX: 'CBOE',
	TASE: 'TASE',
	LSE: 'LSE'
};
const INDEX: Record<string, string> = { SPX: 'SP:SPX', 'TA-125': 'TASE:TA125' };

export function tradingViewUrl(exchange: string | null | undefined, symbol: string): string {
	const s = INDEX[symbol] ?? (PREFIX[exchange ?? ''] ? `${PREFIX[exchange!]}:${symbol}` : symbol);
	return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s)}`;
}
