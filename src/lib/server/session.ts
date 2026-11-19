import type { RequestEvent } from '@sveltejs/kit';
import { COOKIE, COOKIE_AGE } from './auth.js';

/** the login cookie for a year («remember me»); Secure when the app is reached by https */
export function setSession(event: Pick<RequestEvent, 'cookies' | 'url' | 'request'>, token: string) {
	event.cookies.set(COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: COOKIE_AGE,
		secure: event.url.protocol === 'https:' || event.request.headers.get('x-forwarded-proto') === 'https'
	});
}

export function clearSession(event: Pick<RequestEvent, 'cookies'>) {
	event.cookies.delete(COOKIE, { path: '/' });
}

/** the language choice is also kept in a cookie, so the login page speaks it */
export function setLangCookie(event: Pick<RequestEvent, 'cookies'>, lang: 'ru' | 'en') {
	event.cookies.set('lang', lang, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: COOKIE_AGE, secure: false });
}
