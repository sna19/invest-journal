import { beforeEach, describe, expect, it } from 'vitest';
import { appFileOf, asUser, AuthError, authForTests, checkLogin, createUser, currentUserId, forEachUser, langFromRequest, listUsers, sessionToken, setPassword, signOutEverywhere, userFromToken } from './auth.js';

describe('users', () => {
	beforeEach(() => {
		authForTests();
	});

	it('the first user is the admin, the next is not', () => {
		const a = createUser({ login: 'alice', password: 'secret1' });
		const b = createUser({ login: 'bob', name: 'Bob', password: 'secret2', lang: 'en' });
		expect(a.admin).toBe(true);
		expect(b).toMatchObject({ admin: false, name: 'Bob', lang: 'en' });
		expect(listUsers().map((u) => u.login)).toEqual(['alice', 'bob']);
	});

	it('refuses a bad login, a short password and a taken login (whatever the case)', () => {
		createUser({ login: 'alice', password: 'secret1' });
		const code = (f: () => unknown) => {
			try {
				f();
			} catch (e) {
				return e instanceof AuthError ? e.message : 'other';
			}
		};
		expect(code(() => createUser({ login: 'a b', password: 'secret1' }))).toBe('login');
		expect(code(() => createUser({ login: 'bob', password: '123' }))).toBe('password');
		expect(code(() => createUser({ login: 'ALICE', password: 'secret1' }))).toBe('taken');
	});

	it('checks the password', () => {
		createUser({ login: 'alice', password: 'secret1' });
		expect(checkLogin('alice', 'secret1')?.login).toBe('alice');
		expect(checkLogin('Alice', 'secret1')?.login).toBe('alice');
		expect(checkLogin('alice', 'secret2')).toBeNull();
		expect(checkLogin('nobody', 'secret1')).toBeNull();
	});

	it('a session token names the user until signed out everywhere or the password changes', () => {
		const u = createUser({ login: 'alice', password: 'secret1' });
		const tok = sessionToken(u);
		expect(userFromToken(tok)?.id).toBe(u.id);
		expect(userFromToken(tok.slice(0, -2) + 'xx')).toBeNull();
		expect(userFromToken('garbage')).toBeNull();
		signOutEverywhere(u.id);
		expect(userFromToken(tok)).toBeNull();
		const tok2 = sessionToken(u);
		setPassword(u.id, 'secret9');
		expect(userFromToken(tok2)).toBeNull();
		expect(checkLogin('alice', 'secret9')).not.toBeNull();
	});

	it('a token of one user cannot be turned into another (the signature covers the id)', () => {
		const a = createUser({ login: 'alice', password: 'secret1' });
		createUser({ login: 'bob', password: 'secret2' });
		const [data, mac] = sessionToken(a).split('.');
		const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64url').toString()), u: 2 })).toString('base64url');
		expect(userFromToken(`${forged}.${mac}`)).toBeNull();
	});
});

describe('the user of a request or a job', () => {
	beforeEach(() => {
		authForTests();
	});

	it('each user has a journal file of his own; the first keeps app.db', () => {
		expect(appFileOf(1)).toBe('app.db');
		expect(appFileOf(2)).toBe('app-u2.db');
	});

	it('asUser holds across awaits and does not leak between concurrent runs', async () => {
		const seen: (number | null)[] = [];
		const run = (id: number, ms: number) =>
			asUser(id, async () => {
				await new Promise((r) => setTimeout(r, ms));
				seen.push(currentUserId());
			});
		await Promise.all([run(1, 20), run(2, 5)]);
		expect(seen).toEqual([2, 1]);
		expect(currentUserId()).toBeNull();
	});

	it('forEachUser runs for every user, or for the journal that is there before any user', async () => {
		expect(await forEachUser(() => currentUserId())).toEqual([1]);
		createUser({ login: 'alice', password: 'secret1' });
		createUser({ login: 'bob', password: 'secret2' });
		expect(await forEachUser(() => currentUserId())).toEqual([1, 2]);
	});

	it('the language: the cookie, else the browser', () => {
		expect(langFromRequest('en', 'ru-RU')).toBe('en');
		expect(langFromRequest(undefined, 'en-US,en')).toBe('en');
		expect(langFromRequest(undefined, 'ru')).toBe('ru');
		expect(langFromRequest(undefined, null)).toBe('ru');
	});
});
