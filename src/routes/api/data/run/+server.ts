import { error, json } from '@sveltejs/kit';
import { runGapsJob, runListingsJob, runMonthlyJob, runPricesJob, runQuotesJob } from '#lib/server/jobs.js';
import { body } from '#lib/server/respond.js';

/** POST { job: prices | listings | gaps | quotes | monthly } — «Обновить сейчас» (spec section 10); runs in the background; «quotes» is awaited (a few seconds) so the screen can reload right after. */
export async function POST({ request }) {
	const job = String((await body(request)).job ?? '');
	if (job === 'quotes') {
		const s = await runQuotesJob().catch((e) => ({ error: String(e) }));
		return json({ done: job, ...s });
	}
	// monthly: the owner's choice 19.11.2026 — load all that are due now, not only at night (about an hour)
	const run = { prices: runPricesJob, listings: runListingsJob, gaps: runGapsJob, monthly: () => runMonthlyJob(100_000, 10_000) }[job];
	if (!run) error(400, 'unknown job');
	void run().catch((e) => console.error(`${job}: ${e}`));
	return json({ started: job }, { status: 202 });
}
