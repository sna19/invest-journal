import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { isCrossSiteForm } from '#lib/server/csrf.js';
import { getApp, getMarket } from '#lib/server/db.js';
import { loadHelp } from '#lib/server/help.js';
import { startScheduler } from '#lib/server/jobs.js';

/** Start: open both databases, load help texts, start the jobs (JOBS=off turns them off, e.g. in tests). */
export const init: ServerInit = () => {
	if (building) return;
	getMarket();
	console.log(`help topics: ${loadHelp(getApp().db)}`);
	if (process.env.JOBS !== 'off') startScheduler();
};

export const handle: Handle = ({ event, resolve }) => {
	if (isCrossSiteForm(event.request, event.url)) {
		return new Response('Cross-site form submissions are forbidden', { status: 403 });
	}
	return resolve(event);
};

/** A data file is the usual failure on the NAS (volume permissions): say so on screen. */
export const handleError: HandleServerError = ({ error }) => {
	console.error(error);
	if (error instanceof Error && error.name === 'SqliteError') {
		return { message: `файл данных недоступен (${error.message})` };
	}
	return { message: 'Internal Error' };
};
