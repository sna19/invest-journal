import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Users (owner's request 19.11.2026: his son Osher uses the app too). Each user has a journal of his own — a
 * separate app database (the first user keeps app.db, the others app-u<id>.db); market data are shared. Login and
 * password (scrypt with a salt), a signed session cookie for a year («remember me»); «sign out everywhere» bumps
 * the user's token version. The Caddy lock in front of the app stays.
 */

export interface User {
	id: number;
	login: string;
	name: string;
	lang: 'ru' | 'en';
	admin: boolean;
}

let db: Database.Database | null = null;
let secret: Buffer | null = null;

export function authDb(dir: string): Database.Database {
	if (db) return db;
	mkdirSync(dir, { recursive: true });
	db = new Database(join(dir, 'auth.db'));
	db.pragma('journal_mode = WAL');
	db.exec(`create table if not exists users (
		id integer primary key autoincrement,
		login text not null unique collate nocase,
		name text not null,
		pass text not null,
		lang text not null default 'ru',
		admin integer not null default 0,
		token_version integer not null default 1,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	)`);
	const f = join(dir, 'auth.secret');
	if (!existsSync(f)) {
		writeFileSync(f, randomBytes(32).toString('hex'));
		try {
			chmodSync(f, 0o600);
		} catch {
			/* a volume without chmod */
		}
	}
	secret = Buffer.from(readFileSync(f, 'utf8').trim(), 'hex');
	return db;
}

/** for tests: a fresh in-memory store */
export function authForTests() {
	db = new Database(':memory:');
	db.exec(`create table users (id integer primary key autoincrement, login text not null unique collate nocase, name text not null, pass text not null,
		lang text not null default 'ru', admin integer not null default 0, token_version integer not null default 1, created_at text not null default '')`);
	secret = randomBytes(32);
	return db;
}

const need = () => {
	if (!db || !secret) throw new Error('auth store is not open');
	return db;
};

export class AuthError extends Error {}

function hash(password: string): string {
	const salt = randomBytes(16);
	return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function verify(password: string, stored: string): boolean {
	const [s, h] = stored.split(':');
	if (!s || !h) return false;
	const got = scryptSync(password, Buffer.from(s, 'hex'), 32);
	const want = Buffer.from(h, 'hex');
	return got.length === want.length && timingSafeEqual(got, want);
}

const row2user = (r: { id: number; login: string; name: string; lang: string; admin: number }): User => ({
	id: r.id,
	login: r.login,
	name: r.name,
	lang: r.lang === 'en' ? 'en' : 'ru',
	admin: !!r.admin
});

export const userCount = () => (need().prepare('select count(*) as n from users').get() as { n: number }).n;
export const listUsers = (): User[] => (need().prepare('select id, login, name, lang, admin from users order by id').all() as never[]).map(row2user);
export const getUser = (id: number): User | null => {
	const r = need().prepare('select id, login, name, lang, admin from users where id = ?').get(id) as never;
	return r ? row2user(r) : null;
};

export function createUser(input: { login?: unknown; name?: unknown; password?: unknown; lang?: unknown; admin?: boolean }): User {
	const login = String(input.login ?? '').trim();
	const password = String(input.password ?? '');
	if (!/^[a-zA-Z0-9._-]{2,32}$/.test(login)) throw new AuthError('login');
	if (password.length < 6) throw new AuthError('password');
	if (need().prepare('select 1 from users where login = ?').get(login)) throw new AuthError('taken');
	const name = String(input.name ?? '').trim().slice(0, 60) || login;
	const lang = input.lang === 'en' ? 'en' : 'ru';
	// the very first user is the owner: the admin, and the journal that already exists is his
	const admin = input.admin || userCount() === 0 ? 1 : 0;
	const r = need().prepare('insert into users (login, name, pass, lang, admin) values (?, ?, ?, ?, ?) returning id, login, name, lang, admin').get(login, name, hash(password), lang, admin);
	return row2user(r as never);
}

export function checkLogin(login: unknown, password: unknown): User | null {
	const r = need().prepare('select id, login, name, lang, admin, pass from users where login = ?').get(String(login ?? '').trim()) as (Parameters<typeof row2user>[0] & { pass: string }) | undefined;
	// the same work for an unknown login, so the time does not tell which logins exist
	if (!r) {
		verify(String(password ?? ''), `${'0'.repeat(32)}:${'0'.repeat(64)}`);
		return null;
	}
	return verify(String(password ?? ''), r.pass) ? row2user(r) : null;
}

export function setPassword(id: number, password: unknown) {
	const p = String(password ?? '');
	if (p.length < 6) throw new AuthError('password');
	need().prepare('update users set pass = ?, token_version = token_version + 1 where id = ?').run(hash(p), id);
}

export function setLang(id: number, lang: 'ru' | 'en') {
	need().prepare('update users set lang = ? where id = ?').run(lang, id);
}

export function signOutEverywhere(id: number) {
	need().prepare('update users set token_version = token_version + 1 where id = ?').run(id);
}

// ── session cookie ───────────────────────────────────────────────────────────

export const COOKIE = 'ij_session';
export const COOKIE_AGE = 365 * 24 * 3600;

const sign = (data: string) => createHmac('sha256', secret!).update(data).digest('base64url');

export function sessionToken(user: User): string {
	const v = (need().prepare('select token_version as v from users where id = ?').get(user.id) as { v: number }).v;
	const data = Buffer.from(JSON.stringify({ u: user.id, v, t: Date.now() })).toString('base64url');
	return `${data}.${sign(data)}`;
}

export function userFromToken(token: string | undefined): User | null {
	if (!token || !secret) return null;
	const [data, mac] = token.split('.');
	if (!data || !mac) return null;
	const want = Buffer.from(sign(data));
	const got = Buffer.from(mac);
	if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
	try {
		const { u, v } = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
		const r = need().prepare('select id, login, name, lang, admin, token_version as v from users where id = ?').get(u) as (Parameters<typeof row2user>[0] & { v: number }) | undefined;
		return r && r.v === v ? row2user(r) : null;
	} catch {
		return null;
	}
}

/** when a valid token was issued (ms), to renew a long-lived login before it runs out */
export function tokenIssued(token: string): number {
	try {
		return Number(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).t) || 0;
	} catch {
		return 0;
	}
}

/** the «lang» cookie, else the browser's language (Russian for Russian, Ukrainian, Belarusian; else English) */
export function langFromRequest(cookie: string | undefined, accept: string | null): 'ru' | 'en' {
	if (cookie === 'ru' || cookie === 'en') return cookie;
	return !accept || /^(ru|uk|be)/i.test(accept) ? 'ru' : 'en';
}

// ── the user of the current request or job ──────────────────────────────────

const current = new AsyncLocalStorage<{ userId: number }>();

/** runs `f` as `userId`: getApp() inside it opens that user's journal */
export const asUser = <T>(userId: number, f: () => T): T => current.run({ userId }, f);
export const currentUserId = (): number | null => current.getStore()?.userId ?? null;

/** the journal file of a user: the first keeps app.db (the journal that was there before users) */
export const appFileOf = (userId: number) => (userId === 1 ? 'app.db' : `app-u${userId}.db`);

/** runs `f` once for every user (background jobs), each in its own journal */
export async function forEachUser<T>(f: (u: User) => Promise<T> | T): Promise<T[]> {
	const out: T[] = [];
	const users = db ? listUsers() : [];
	// before the first user exists the jobs still run on the journal that is there
	for (const u of users.length ? users : [{ id: 1, login: 'owner', name: 'owner', lang: 'ru' as const, admin: true }]) out.push(await asUser(u.id, () => f(u)));
	return out;
}
