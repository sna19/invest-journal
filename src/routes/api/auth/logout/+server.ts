import { json } from '@sveltejs/kit';
import { signOutEverywhere } from '#lib/server/auth.js';
import { clearSession } from '#lib/server/session.js';
import type { RequestHandler } from './$types';

/** POST /api/auth/logout {everywhere?} — sign out here, or on every device (the user's token version goes up) */
export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	if (body?.everywhere && event.locals.user) signOutEverywhere(event.locals.user.id);
	clearSession(event);
	return json({ ok: true });
};
