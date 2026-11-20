import { describe, expect, it } from 'vitest';
import { tradingViewUrl } from './tradingview.js';

describe('TradingView links', () => {
	it('exchange prefix and ticker; indices by their own names', () => {
		expect(tradingViewUrl('NASDAQ', 'AMAT')).toBe('https://www.tradingview.com/chart/?symbol=NASDAQ%3AAMAT');
		expect(tradingViewUrl('NYSE_ARCA', 'SPY')).toBe('https://www.tradingview.com/chart/?symbol=AMEX%3ASPY');
		expect(tradingViewUrl('TASE', 'ESLT')).toBe('https://www.tradingview.com/chart/?symbol=TASE%3AESLT');
		expect(tradingViewUrl('INDEX_US', 'SPX')).toBe('https://www.tradingview.com/chart/?symbol=SP%3ASPX');
		expect(tradingViewUrl(null, 'CSPX')).toBe('https://www.tradingview.com/chart/?symbol=CSPX');
	});
});
