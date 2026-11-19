import { json } from '@sveltejs/kit';
import { upcoming } from '#lib/server/model/service.js';

/** GET /api/model/upcoming — whether the next quarter's candidates are to be shown (two weeks before it) */
export function GET() {
	return json(upcoming());
}
