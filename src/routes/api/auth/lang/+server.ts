import { json } from '@sveltejs/kit';
import { setLang } from '#lib/server/auth.js';
import { setLangCookie } from '#lib/server/session.js';
import type { RequestHandler } from './$types';

/** POST /api/auth/lang {lang} — the language of the signed-in user (and of the login page on this device) */
export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const lang = body?.lang === 'en' ? 'en' : 'ru';
	if (event.locals.user) setLang(event.locals.user.id, lang);
	setLangCookie(event, lang);
	return json({ lang });
};
