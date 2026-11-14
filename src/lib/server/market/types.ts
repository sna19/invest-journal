/** Spec section 14 — the shape every provider adapter has; the rest of the code knows nothing about providers. */

/** One raw answer of a provider, kept compressed in /raw before it is parsed. */
export interface RawPayload {
	/** file name inside the run's folder, e.g. nasdaqlisted.txt */
	name: string;
	body: Buffer;
}

/** A listing row brought to the common shape. */
export interface ListingRow {
	/** the provider's own key for the security: stays the same across runs */
	providerSymbol: string;
	exchangeCode: string;
	symbol: string;
	/** stock | etf */
	type: 'stock' | 'etf';
	nameEn: string;
	nameHe?: string | null;
	isin?: string | null;
	currency: string;
	/** USD | ILS | ILA */
	priceUnit: string;
	/** how the price provider (Yahoo) calls it */
	yahooSymbol: string;
}

export interface Fetcher {
	(url: string, headers?: Record<string, string>): Promise<Buffer>;
}

export interface ListingAdapter {
	code: string;
	fetchListings(get: Fetcher): Promise<RawPayload[]>;
	parseListings(raw: RawPayload[]): ListingRow[];
}
