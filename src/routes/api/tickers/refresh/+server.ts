import { json } from '@sveltejs/kit';
import { runListingsJob } from '#lib/server/jobs.js';

/** POST — the «Обновить» button: starts the listings job in the background (or joins the running one). */
export function POST() {
	void runListingsJob();
	return json({ started: true }, { status: 202 });
}
