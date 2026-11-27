import { json } from '@sveltejs/kit';
import { getMarket } from '#lib/server/db.js';
import { catalog } from '#lib/server/sector.js';

/** GET — every sector, industry and index (owner 27.11.2026, the «Тикеры» screen) */
export function GET() {
	return json(catalog(getMarket().sqlite));
}
