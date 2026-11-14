import type { ListingAdapter, ListingRow, RawPayload } from './types.js';

/**
 * US listings: Nasdaq Trader Symbol Directory. nasdaqlisted.txt — NASDAQ; otherlisted.txt — the other
 * venues by the Exchange field. Five venues are kept (decision of 15.11.2026); IEX and others are not.
 */
const BASE = 'https://www.nasdaqtrader.com/dynamic/SymDir/';

const OTHER: Record<string, string> = { N: 'NYSE', A: 'NYSE_AMERICAN', P: 'NYSE_ARCA', Z: 'CBOE_BZX' };

/** Warrants, rights, units, preferred shares and notes are not stocks for the journal. ADRs stay. */
export const NOT_STOCK = /\b(warrants?|rights?|units?|preferred|notes due|debentures|subordinated)\b|%/i;

/** «Applied Materials, Inc. - Common Stock» → «Applied Materials, Inc.» */
export function cleanName(name: string): string {
	return name
		.replace(/\s+-\s+.*$/, '')
		.replace(/\s+(Class [A-Z] )?(Common Stock|Ordinary Shares?|Common Shares?|Shares of Beneficial Interest)\b.*$/i, '')
		.replace(/[\s,]+$/, '')
		.trim();
}

function table(text: string): Record<string, string>[] {
	const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('File Creation Time'));
	const head = lines[0].split('|');
	return lines.slice(1).map((l) => Object.fromEntries(l.split('|').map((v, i) => [head[i], v])));
}

/** Yahoo writes class shares with a dash: BRK.B → BRK-B */
export const yahooUs = (symbol: string) => symbol.replace(/\./g, '-');

function row(exchangeCode: string, symbol: string, name: string, etf: boolean): ListingRow {
	return {
		providerSymbol: `${exchangeCode}:${symbol}`,
		exchangeCode,
		symbol,
		type: etf ? 'etf' : 'stock',
		nameEn: cleanName(name) || name.trim(),
		currency: 'USD',
		priceUnit: 'USD',
		yahooSymbol: yahooUs(symbol)
	};
}

export const nasdaqTrader: ListingAdapter = {
	code: 'nasdaqtrader',

	async fetchListings(get) {
		return [
			{ name: 'nasdaqlisted.txt', body: await get(BASE + 'nasdaqlisted.txt') },
			{ name: 'otherlisted.txt', body: await get(BASE + 'otherlisted.txt') }
		];
	},

	parseListings(raw: RawPayload[]) {
		const out: ListingRow[] = [];
		const keep = (r: Record<string, string>) => r['Test Issue'] === 'N' && r['Security Name'] && !NOT_STOCK.test(r['Security Name']);
		for (const p of raw) {
			const rows = table(p.body.toString('utf8'));
			if (p.name === 'nasdaqlisted.txt') {
				for (const r of rows.filter(keep)) out.push(row('NASDAQ', r.Symbol, r['Security Name'], r.ETF === 'Y'));
			} else {
				for (const r of rows.filter(keep)) {
					const ex = OTHER[r.Exchange];
					if (ex) out.push(row(ex, r['ACT Symbol'], r['Security Name'], r.ETF === 'Y'));
				}
			}
		}
		return out;
	}
};
