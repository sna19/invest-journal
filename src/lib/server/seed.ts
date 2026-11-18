import { sql } from 'drizzle-orm';
import type { AppDb, MarketDb } from './db.js';
import { sources } from './schema/app.js';
import { exchanges, providers, providerSymbols, securities, securitySymbols } from './schema/market.js';

/** Exchanges of the journal (spec section 4 and decision of 15.11.2026: five US venues + TASE). */
export const EXCHANGES = [
	{ code: 'NASDAQ', name: 'NASDAQ', country: 'US', currency: 'USD', timezone: 'America/New_York' },
	{ code: 'NYSE', name: 'NYSE', country: 'US', currency: 'USD', timezone: 'America/New_York' },
	{ code: 'NYSE_AMERICAN', name: 'NYSE American', country: 'US', currency: 'USD', timezone: 'America/New_York' },
	{ code: 'NYSE_ARCA', name: 'NYSE Arca', country: 'US', currency: 'USD', timezone: 'America/New_York' },
	{ code: 'CBOE_BZX', name: 'Cboe BZX', country: 'US', currency: 'USD', timezone: 'America/New_York' },
	{ code: 'TASE', name: 'TASE', country: 'IL', currency: 'ILS', timezone: 'Asia/Jerusalem' },
	{ code: 'INDEX_US', name: 'Индекс США', country: 'US', currency: 'USD', timezone: 'America/New_York' },
	// section 18: ETF UCITS bought through an Israeli broker on the London exchange — added by hand, one by one
	{ code: 'LSE', name: 'London SE', country: 'GB', currency: 'USD', timezone: 'Europe/London' }
];

export const PROVIDERS = [
	{ code: 'nasdaqtrader', name: 'Nasdaq Trader Symbol Directory', dataKind: 'listings', rateLimit: null, priority: 1 },
	{ code: 'tase', name: 'TASE site search index', dataKind: 'listings', rateLimit: null, priority: 1 },
	{ code: 'yahoo', name: 'Yahoo Finance chart API', dataKind: 'prices,actions', rateLimit: 6, priority: 1 },
	{ code: 'boi', name: 'Bank of Israel representative rates (SDMX)', dataKind: 'fx', rateLimit: null, priority: 1 }
];

/** Benchmarks (spec section 5): S&P 500 for US securities, TA-125 for TASE. Prices load by the same mechanism. */
export const BENCHMARKS = [
	{ key: 'benchmark:SPX', exchangeCode: 'INDEX_US', symbol: 'SPX', nameEn: 'S&P 500', nameHe: null, currency: 'USD', priceUnit: 'USD', yahoo: '^GSPC' },
	{ key: 'benchmark:TA125', exchangeCode: 'TASE', symbol: 'TA-125', nameEn: 'TA-125', nameHe: 'ת"א-125', currency: 'ILS', priceUnit: 'ILS', yahoo: '^TA125.TA' }
];

/** Idempotent: reference rows the loaders rely on. */
export function seedMarket(db: MarketDb) {
	db.transaction((tx) => {
		for (const e of EXCHANGES) tx.insert(exchanges).values(e).onConflictDoNothing().run();
		for (const p of PROVIDERS) tx.insert(providers).values(p).onConflictDoNothing().run();
		for (const b of BENCHMARKS) {
			const found = tx
				.select({ id: providerSymbols.securityId })
				.from(providerSymbols)
				.where(sql`${providerSymbols.providerCode} = 'seed' and ${providerSymbols.providerSymbol} = ${b.key}`)
				.get();
			if (found) continue;
			const { id } = tx
				.insert(securities)
				.values({
					exchangeCode: b.exchangeCode,
					type: 'index',
					symbol: b.symbol,
					nameEn: b.nameEn,
					nameHe: b.nameHe,
					currency: b.currency,
					priceUnit: b.priceUnit,
					isBenchmark: true,
					search: [b.symbol, b.nameEn, b.nameHe].filter(Boolean).join(' ').toLowerCase()
				})
				.returning({ id: securities.id })
				.get();
			tx.insert(providerSymbols).values({ securityId: id, providerCode: 'seed', providerSymbol: b.key }).run();
			tx.insert(providerSymbols).values({ securityId: id, providerCode: 'yahoo', providerSymbol: b.yahoo }).run();
			tx.insert(securitySymbols).values({ securityId: id, symbol: b.symbol, validFrom: '1900-01-01' }).run();
		}
	});
}

/** Spec section 17 — sources set up in advance; a link from the domain picks the source by itself. */
export const SOURCES = [
	{ name: 'Globes', domain: 'globes.co.il', kind: 'publication', market: 'IL' },
	{ name: 'TheMarker', domain: 'themarker.com', kind: 'publication', market: 'IL' },
	{ name: "Barron's", domain: 'barrons.com', kind: 'publication', market: 'US' },
	{ name: 'WSJ', domain: 'wsj.com', kind: 'publication', market: 'US' },
	{ name: 'Собственная идея', domain: null, kind: 'own', market: 'any' }
];

export function seedApp(db: AppDb) {
	db.transaction((tx) => {
		for (const s of SOURCES) tx.insert(sources).values(s).onConflictDoNothing().run();
	});
}
