import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { searchSecurities, securityHit, type Kind, type Market } from '#lib/server/market/search.js';
import { searchSectors } from '#lib/server/sector.js';
import { SECTORS } from '#lib/allocation.js';
import { SORTS, sortHits, type SortKey } from '#lib/server/tickerSort.js';

/** GET /api/securities?q=…&market=us|il|all[&inactive=1][&kind=stock|etf|commodity][&sector=…][&offset=…] — the ticker field (spec section 4). */
export function GET({ url }) {
	const t0 = performance.now();
	// ?id= — one security (a form opened with it chosen, T-022)
	if (url.searchParams.get('id')) {
		const hit = securityHit(getMarket().sqlite, Number(url.searchParams.get('id')));
		return json({ items: hit ? [hit] : [], ms: 0 });
	}
	const m = url.searchParams.get('market');
	// owner 28.11.2026: browsing sorted by another key — all the matches sorted here, then the page cut
	const sort = SORTS.find((k) => k === url.searchParams.get('sort')) as SortKey | undefined;
	const browse = (url.searchParams.get('q') ?? '').trim().length < 2;
	const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
	const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
	const custom = !!sort && browse && !(sort === 'cap' && url.searchParams.get('dir') !== 'asc');
	const found = searchSecurities(getMarket().sqlite, url.searchParams.get('q') ?? '', {
		market: m === 'us' || m === 'il' ? (m as Market) : 'all',
		includeInactive: url.searchParams.get('inactive') === '1',
		noIndex: url.searchParams.get('noindex') === '1',
		withManual: url.searchParams.get('manual') === '1',
		kind: (['stock', 'etf', 'commodity'] as const).find((k: Kind) => k === url.searchParams.get('kind')),
		sector: /^[a-z_]{3,40}$/.test(url.searchParams.get('sector') ?? '') ? url.searchParams.get('sector')! : undefined,
		limit: custom ? 20000 : limit,
		offset: custom ? 0 : offset
	});
	const items = custom ? sortHits(getMarket().sqlite, found, sort!, url.searchParams.get('dir') !== 'asc').slice(offset, offset + limit) : found;
	// the «Тикеры» screen also finds sectors and industries by name (26.11.2026)
	const sectors = url.searchParams.get('sectors') === '1' ? searchSectors(getMarket().sqlite, url.searchParams.get('q') ?? '', SECTORS) : undefined;
	return json({ items, sectors, ms: Math.round((performance.now() - t0) * 10) / 10 });
}
