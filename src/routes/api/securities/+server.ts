import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { searchSecurities, type Kind, type Market } from '#lib/server/market/search.js';

/** GET /api/securities?q=…&market=us|il|all[&inactive=1][&kind=stock|etf|commodity][&sector=…][&offset=…] — the ticker field (spec section 4). */
export function GET({ url }) {
	const t0 = performance.now();
	const m = url.searchParams.get('market');
	const items = searchSecurities(getMarket().sqlite, url.searchParams.get('q') ?? '', {
		market: m === 'us' || m === 'il' ? (m as Market) : 'all',
		includeInactive: url.searchParams.get('inactive') === '1',
		noIndex: url.searchParams.get('noindex') === '1',
		withManual: url.searchParams.get('manual') === '1',
		kind: (['stock', 'etf', 'commodity'] as const).find((k: Kind) => k === url.searchParams.get('kind')),
		sector: /^[a-z_]{3,40}$/.test(url.searchParams.get('sector') ?? '') ? url.searchParams.get('sector')! : undefined,
		limit: Math.min(Number(url.searchParams.get('limit')) || 20, 100),
		offset: Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0))
	});
	return json({ items, ms: Math.round((performance.now() - t0) * 10) / 10 });
}
