import type { ListingAdapter, ListingRow, RawPayload } from './types.js';

/**
 * TASE listings: the search index of the exchange's site (stage 0, variant Б). lang=1 — English names,
 * lang=0 — Hebrew. Type 1 = a traded security; SubType 1 shares, 42 equity ETF, 44 foreign equity ETF, 45 foreign bond ETF.
 * The TASE security number (Id) is the provider key: it stays when the symbol changes.
 */
const URL = 'https://api.tase.co.il/api/content/searchentities?lang=';
const HEADERS = { Origin: 'https://market.tase.co.il', Referer: 'https://market.tase.co.il/', Accept: 'application/json' };

/** 44 — foreign equity ETFs (iShares, Invesco UCITS lines), 45 — foreign bond ETFs (added 20.11.2026) */
const KIND: Record<string, ListingRow['type']> = { '1': 'stock', '42': 'etf', '44': 'etf', '45': 'etf' };

const ISSUER: Record<string, string> = { IS: 'iShares', IN: 'Invesco' };

/**
 * A foreign ETF's English name on TASE is a cut code («ISH.FRF MSCI EM», «INV.FRFS&P500EW»), so «iShares» or
 * «UCITS» finds nothing (owner's question 20.11.2026). The Hebrew name holds the full index name: build
 * «iShares MSCI EM UCITS ETF» from it; its «P 500&S» is S&P 500 written right to left.
 */
export function foreignEtfName(smb: string, en: string, he: string | null | undefined): string {
	const issuer = ISSUER[smb.split('.')[0]];
	if (!issuer || !he) return en;
	const tidy = (x: string) =>
		x
			.replace(/[\u0590-\u05FF]+/g, ' ')
			.replace(/UCITS(ETF)?|\bETF\b/gi, ' ')
			.replace(/MSCI(?=[A-Z])/g, 'MSCI ')
			.replace(/\s+/g, ' ')
			.trim()
			// «P 500&S», «P.HEALTCARE&S», «P &FINS» → «S&P 500 …»
			.replace(/^P[ .]?(.*)&S$/, 'S&P $1')
			.replace(/^P\s*&\s*(\w+)/, 'S&P $1')
			.replace(/(.*)&S$/, '$1')
			.replace(/\.+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	let rest = tidy(he.replace(/^[^ ]*חוץ\.?/, ''));
	// a Hebrew name with nothing after the issuer («אינבסקו.חוץ»): the English code without its prefix
	if (!rest) rest = tidy(en.replace(/^[A-Z]+\.?\s*FRF\.?\s*|^[A-Z]+\.F\s+/, ''));
	return rest ? `${issuer} ${rest} UCITS ETF` : en;
}

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
					nameEn: e.SubType === '44' || e.SubType === '45' ? foreignEtfName(e.Smb!, (e.Name ?? e.Smb!).trim(), he.get(e.Id)) : (e.Name ?? e.Smb!).trim(),
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
