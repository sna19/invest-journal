import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { redirect } from '@sveltejs/kit';
import { setSession } from '#lib/server/session.js';
import { asUser, authDb, COOKIE, sessionToken, tokenIssued, userFromToken } from '#lib/server/auth.js';
import { building } from '$app/env';
import { isCrossSiteForm } from '#lib/server/csrf.js';
import { closeAll, dataDir, getApp, getMarket, onAppOpened, volumeReport } from '#lib/server/db.js';
import { loadHelp } from '#lib/server/help.js';
import { startScheduler, stopScheduler } from '#lib/server/jobs.js';
import { setStartError } from '#lib/server/start.js';

/** Start: open both databases, load help texts, start the jobs (JOBS=off turns them off, e.g. in tests). */
export const init: ServerInit = () => {
	if (building) return;
	// SIGTERM (docker stop, a deploy): adapter-node closes the HTTP server, then this. A history load cut here
	// goes on at the next start (the task queue), so stopping at once is safe.
	process.once('sveltekit:shutdown', (reason) => {
		stopScheduler();
		closeAll();
		console.log(`stopped (${reason})`);
		process.exit(0);
	});
	const vol = volumeReport();
	for (const l of vol.lines) console.log(`volume ${l}`);
	try {
		authDb(dataDir);
		getMarket();
		// every user's journal gets the help texts when it is first opened
		let topics = 0;
		onAppOpened((db) => (topics = loadHelp(db)));
		getApp();
		console.log(`help topics: ${topics}`);
	} catch (e) {
		// stay up: /health answers 503 with the reason instead of the container restarting in a loop
		setStartError(`${(e as Error).message}${vol.ok ? '' : ' — ' + vol.lines.join('; ')}`);
		console.error('start failed');
		return;
	}
	if (process.env.JOBS !== 'off') startScheduler();
};

/**
 * What opens without a login: the login page (and its data), the health check, the auth API, built assets.
 * Static files never get here (adapter-node serves them first).
 */
const open = (p: string) => p === '/login' || p === '/login/__data.json' || p === '/health' || p.startsWith('/api/auth/') || p.startsWith('/_app/');
const RENEW_AFTER = 7 * 24 * 3600 * 1000;

/**
 * Users (19.11.2026): the session cookie names the user; the request runs «as» that user, so getApp() is his journal.
 * Without a login a page goes to /login, an API call gets 401. A login older than a week is renewed for another year.
 */
export const handle: Handle = ({ event, resolve }) => {
	if (isCrossSiteForm(event.request, event.url)) {
		return new Response('Cross-site form submissions are forbidden', { status: 403 });
	}
	const token = event.cookies.get(COOKIE);
	let user = null;
	try {
		user = userFromToken(token);
	} catch {
		/* the auth store did not open — /health tells why */
	}
	event.locals.user = user;
	const p = event.url.pathname;
	if (!user) {
		if (open(p)) return resolve(event);
		if (p.startsWith('/api/')) return new Response(JSON.stringify({ error: 'login' }), { status: 401, headers: { 'content-type': 'application/json' } });
		redirect(303, `/login?to=${encodeURIComponent(p + event.url.search)}`);
	}
	if (token && Date.now() - tokenIssued(token) > RENEW_AFTER) setSession(event, sessionToken(user));
	return asUser(user.id, () => resolve(event));
};

/** A data file is the usual failure on the NAS (volume permissions): say so on screen. */
export const handleError: HandleServerError = ({ error, event }) => {
	// the path too: «Not Found» alone does not say what was missing
	console.error(event.request.method, event.url.pathname, error);
	if (error instanceof Error && error.name === 'SqliteError') {
		return { message: `файл данных недоступен (${error.message})` };
	}
	return { message: 'Internal Error' };
};
