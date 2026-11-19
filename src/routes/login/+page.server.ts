import { fail, redirect } from '@sveltejs/kit';
import { AuthError, checkLogin, createUser, langFromRequest, sessionToken, userCount } from '#lib/server/auth.js';
import { setLangCookie, setSession } from '#lib/server/session.js';
import type { Actions, PageServerLoad } from './$types';

/** only a path inside the app: no way to send the browser elsewhere after a login */
const safeTo = (to: string | null) => (to && to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/login') ? to : '/portfolio');

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeTo(url.searchParams.get('to')));
	return { setup: userCount() === 0 };
};

export const actions: Actions = {
	login: async (event) => {
		const f = await event.request.formData();
		const login = String(f.get('login') ?? '');
		const user = checkLogin(login, f.get('password'));
		if (!user) return fail(400, { login, error: 'bad' as const });
		setSession(event, sessionToken(user));
		setLangCookie(event, user.lang);
		redirect(303, safeTo(event.url.searchParams.get('to')));
	},
	/** the very first account — only while there are no users; its owner keeps the journal that is already here */
	setup: async (event) => {
		if (userCount() > 0) return fail(400, { login: '', error: 'bad' as const });
		const f = await event.request.formData();
		const login = String(f.get('login') ?? '');
		try {
			const lang = langFromRequest(event.cookies.get('lang'), event.request.headers.get('accept-language'));
			const user = createUser({ login, name: f.get('name'), password: f.get('password'), lang, admin: true });
			setSession(event, sessionToken(user));
			setLangCookie(event, user.lang);
		} catch (e) {
			if (e instanceof AuthError) return fail(400, { login, error: e.message as 'login' | 'password' | 'taken' });
			throw e;
		}
		redirect(303, '/portfolio');
	}
};
