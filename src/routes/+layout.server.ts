import { langFromRequest } from '#lib/server/auth.js';
import type { LayoutServerLoad } from './$types';

/** the signed-in user and the language every page speaks (the user's, or the cookie's / browser's on /login) */
export const load: LayoutServerLoad = ({ locals, cookies, request }) => ({
	user: locals.user ? { name: locals.user.name, login: locals.user.login, admin: locals.user.admin } : null,
	lang: locals.user?.lang ?? langFromRequest(cookies.get('lang'), request.headers.get('accept-language'))
});
