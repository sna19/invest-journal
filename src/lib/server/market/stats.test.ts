import { describe, expect, it } from 'vitest';
import { parseStats } from './stats.js';

const body = (o: Record<string, Record<string, unknown>>) => JSON.stringify({ quoteSummary: { result: [o] } });
const raw = (x: number) => ({ raw: x, fmt: String(x) });

describe('the ratios of a security (26.11.2026)', () => {
	it('a US share: valuation, risk, quality, analysts', () => {
		const s = parseStats(
			body({
				summaryDetail: { trailingPE: raw(16.04), priceToSalesTrailing12Months: raw(9.96), beta: raw(2.247), dividendYield: raw(0.0064) },
				defaultKeyStatistics: { priceToBook: raw(13.5), forwardPE: raw(8.99), enterpriseToEbitda: raw(14.5), shortPercentOfFloat: raw(0.0132) },
				financialData: { profitMargins: raw(0.625), returnOnEquity: raw(1.17), debtToEquity: raw(14.3), targetMeanPrice: raw(242.4), recommendationKey: 'buy', numberOfAnalystOpinions: raw(59) }
			}),
			false
		)!;
		expect(s).toMatchObject({ kind: 'stock', pe: 16.04, ps: 9.96, pb: 13.5, forwardPe: 8.99, beta: 2.247, profitMargin: 0.625, target: 242.4, recommendation: 'buy', analysts: 59, priceRatiosHidden: false });
	});
	it('a TASE share: the price ratios are hidden (agorot over dollars), the rest stays', () => {
		const s = parseStats(body({ summaryDetail: { trailingPE: raw(50.2), beta: raw(-0.4) }, defaultKeyStatistics: { priceToBook: raw(2256) }, financialData: { profitMargins: raw(0.077), targetMeanPrice: raw(293556) } }), true)!;
		expect(s).toMatchObject({ pe: null, pb: null, target: null, beta: -0.4, profitMargin: 0.077, priceRatiosHidden: true });
	});
	it('a fund: its assets and returns', () => {
		const s = parseStats(body({ summaryDetail: { totalAssets: raw(7.9e11), yield: raw(0.01) }, defaultKeyStatistics: { legalType: 'Exchange Traded Fund', beta3Year: raw(0.97), ytdReturn: raw(0.062) } }), false)!;
		expect(s).toMatchObject({ kind: 'fund', totalAssets: 7.9e11, dividendYield: 0.01, beta3y: 0.97, ytd: 0.062 });
	});
});
