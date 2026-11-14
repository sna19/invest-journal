import type { ListingAdapter, ListingRow, RawPayload } from './types.js';

/**
 * TASE listings: the search index of the exchange's site (stage 0, variant Б). lang=1 — English names,
 * lang=0 — Hebrew. Type 1 = a traded security; SubType 1 shares, 42 equity ETF, 44 foreign equity ETF.
 * The TASE security number (Id) is the provider key: it stays when the symbol changes.
 */
const URL = 'https://api.tase.co.il/api/content/searchentities?lang=';
const HEADERS = { Origin: 'https://market.tase.co.il', Referer: 'https://market.tase.co.il/', Accept: 'application/json' };

const KIND: Record<string, ListingRow['type']> = { '1': 'stock', '42': 'etf', '44': 'etf' };

interface Entity {
	Id: string;
	Name: string | null;
	Smb: string | null;
	ISIN: string | null;
	Type: number;
	SubType: string | null;
}

/** Yahoo: KSM.F208 → KSM-F208.TA, LUMI → LUMI.TA */
export const yahooTase = (symbol: string) => symbol.replace(/\./g, '-') + '.TA';

export const tase: ListingAdapter = {
	code: 'tase',

	async fetchListings(get) {
		return [
			{ name: 'searchentities-en.json', body: await get(URL + '1', HEADERS) },
			{ name: 'searchentities-he.json', body: await get(URL + '0', HEADERS) }
		];
	},

	parseListings(raw: RawPayload[]) {
		const read = (name: string) => JSON.parse(raw.find((p) => p.name === name)!.body.toString('utf8')) as Entity[];
		const traded = (e: Entity) => e.Type === 1 && e.SubType !== null && e.SubType in KIND && e.Smb;
		const he = new Map(read('searchentities-he.json').filter(traded).map((e) => [e.Id, e.Name]));
		return read('searchentities-en.json')
			.filter(traded)
			.map(
				(e): ListingRow => ({
					providerSymbol: e.Id,
					exchangeCode: 'TASE',
					symbol: e.Smb!,
					type: KIND[e.SubType!],
					nameEn: (e.Name ?? e.Smb!).trim(),
					nameHe: he.get(e.Id)?.trim() || null,
					isin: e.ISIN,
					currency: 'ILS',
					// shares and ETFs on TASE are quoted in agorot (confirmed at stage 0: Yahoo currency ILA)
					priceUnit: 'ILA',
					yahooSymbol: yahooTase(e.Smb!)
				})
			);
	}
};
