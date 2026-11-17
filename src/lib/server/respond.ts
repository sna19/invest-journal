import { json } from '@sveltejs/kit';
import { InputError, LockedError } from './journal.js';
import { ConfirmError } from './portfolio.js';

/** Errors of the journal as HTTP answers: 400 with field errors, 409 when a rule forbids the change. */
export function fail(e: unknown) {
	if (e instanceof InputError) return json({ message: e.message, errors: e.errors }, { status: 400 });
	if (e instanceof LockedError) return json({ message: e.message }, { status: 409 });
	// a price far from the day's range: the form asks and sends again with confirm
	if (e instanceof ConfirmError) return json({ message: e.message, confirm: true }, { status: 409 });
	// the database's own guard (triggers in drizzle/app/0002_lock_hypotheses.sql)
	if (e instanceof Error && e.name === 'SqliteError' && /locked|cancelled|never deleted|cannot change|24 hours/.test(e.message))
		return json({ message: e.message }, { status: 409 });
	throw e;
}

export async function body(request: Request): Promise<Record<string, unknown>> {
	const b = await request.json().catch(() => null);
	return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}
