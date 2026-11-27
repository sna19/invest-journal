import { json } from '@sveltejs/kit';
import { activities } from '#lib/server/activity.js';

/** GET — what the server is doing in the background now (owner 27.11.2026: the bar «Делаю пересчёт…») */
export function GET() {
	return json(activities());
}
