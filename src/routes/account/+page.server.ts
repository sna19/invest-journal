import { error, fail } from '@sveltejs/kit';
import { AuthError, checkLogin, createUser, listUsers, sessionToken, setPassword } from '#lib/server/auth.js';
import { setSession } from '#lib/server/session.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	users: locals.user?.admin ? listUsers().map((u) => ({ id: u.id, login: u.login, name: u.name, admin: u.admin })) : []
});

const authFail = (form: string, e: unknown, extra: Record<string, unknown> = {}) => {
	if (e instanceof AuthError) return fail(400, { form, error: e.message as 'login' | 'password' | 'taken', ...extra });
	throw e;
};

export const actions: Actions = {
	/** own password: the current one, the new one twice; other devices are signed out, this one stays */
	password: async (event) => {
		const me = event.locals.user!;
		const f = await event.request.formData();
		if (!checkLogin(me.login, f.get('old'))) return fail(400, { form: 'password', error: 'old' as const });
		if (f.get('new') !== f.get('repeat')) return fail(400, { form: 'password', error: 'mismatch' as const });
		try {
			setPassword(me.id, f.get('new'));
		} catch (e) {
			return authFail('password', e);
		}
		setSession(event, sessionToken(me));
		return { form: 'password', ok: true };
	},
	/** the admin adds a user: a journal of his own is opened at his first sign-in */
	add: async (event) => {
		if (!event.locals.user?.admin) error(403);
		const f = await event.request.formData();
		try {
			const u = createUser({ login: f.get('login'), name: f.get('name'), password: f.get('password'), lang: f.get('lang') });
			return { form: 'add', ok: true, login: u.login };
		} catch (e) {
			return authFail('add', e, { login: String(f.get('login') ?? '') });
		}
	},
	/** the admin sets a forgotten password; that user's devices are signed out */
	reset: async (event) => {
		if (!event.locals.user?.admin) error(403);
		const f = await event.request.formData();
		const id = Number(f.get('id'));
		if (!listUsers().some((u) => u.id === id)) error(404);
		try {
			setPassword(id, f.get('password'));
		} catch (e) {
			return authFail(`reset-${id}`, e);
		}
		if (id === event.locals.user.id) setSession(event, sessionToken(event.locals.user));
		return { form: `reset-${id}`, ok: true };
	}
};
