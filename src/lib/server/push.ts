import type Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { dataDir } from './db.js';
import { signals, type Signal, type SignalKind } from './discipline.js';
import { InputError } from './journal.js';
import type { Errors } from '../hypothesis.js';

/**
 * T-015, Web Push (owner 26.11.2026: «Да. Делать»): the signals of the trade discipline reach the phone. The home-screen
 * app on an iPhone (iOS 16.4+) and browsers allow it once; the server sends through the device's push service (an
 * outgoing https call — no port is opened). The VAPID key pair is made on first use and kept in the data folder, never
 * in the repository. Each signal goes once per version of the position's conditions.
 */

const SUBJECT = process.env.PUSH_SUBJECT ?? 'https://github.com/sna19/invest-journal';
export type PushKind = SignalKind | 'reminder' | 'ideas';
/** «reminder» — the diary's reminders (T-032 Д-32: off by default) */
export const PUSH_KINDS: PushKind[] = ['stop', 'no_stop', 'target', 'review', 'model_end', 'path', 'reminder', 'ideas'];
/** owner 26.11.2026: only «стоп пробит» is on until the others are turned on in the settings */
export const PUSH_DEFAULT: PushKind[] = ['stop', 'no_stop', 'ideas'];

let keys: { publicKey: string; privateKey: string } | null = null;
export function vapid(dir = dataDir) {
	if (keys) return keys;
	const file = join(dir, 'vapid.json');
	if (existsSync(file)) keys = JSON.parse(readFileSync(file, 'utf8'));
	else {
		keys = webpush.generateVAPIDKeys();
		writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
	}
	webpush.setVapidDetails(SUBJECT, keys!.publicKey, keys!.privateKey);
	return keys!;
}

export function pushKinds(app: Database.Database): PushKind[] {
	const r = app.prepare(`select value from user_settings where key = 'push_kinds'`).get() as { value: string } | undefined;
	if (!r) return PUSH_DEFAULT;
	try {
		return (JSON.parse(r.value) as string[]).filter((k): k is PushKind => (PUSH_KINDS as string[]).includes(k));
	} catch {
		return PUSH_DEFAULT;
	}
}

export function setPushKinds(app: Database.Database, kinds: unknown) {
	const list = Array.isArray(kinds) ? PUSH_KINDS.filter((k) => kinds.includes(k)) : null;
	if (!list) throw new InputError({ kinds: 'Список сигналов' } as Errors);
	app.prepare(`insert into user_settings (key, value) values ('push_kinds', ?) on conflict(key) do update set value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run(JSON.stringify(list));
	return list;
}

export function subscribe(app: Database.Database, market: Database.Database, sub: unknown, device: unknown) {
	const s = sub as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
	if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string')
		throw new InputError({ subscription: 'Подписка устройства без адреса или ключей' } as Errors);
	app.prepare(
		`insert into push_subscriptions (endpoint, p256dh, auth, device) values (?, ?, ?, ?)
		 on conflict(endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`
	).run(s.endpoint, s.keys.p256dh, s.keys.auth, typeof device === 'string' ? device.slice(0, 120) : null);
	// what is already signalled now is not sent again to the new device as news
	markCurrent(app, market);
}

export function unsubscribe(app: Database.Database, endpoint: unknown) {
	app.prepare('delete from push_subscriptions where endpoint = ?').run(String(endpoint ?? ''));
}

export function devices(app: Database.Database) {
	return app.prepare('select endpoint, device, created_at as createdAt from push_subscriptions order by created_at').all() as { endpoint: string; device: string | null; createdAt: string }[];
}

const keyOf = (s: Signal) => `${s.kind}|${s.positionId}|${s.planId}`;

/** the first device: the signals standing now count as sent — the banner shows them, the push is for new ones */
function markCurrent(app: Database.Database, market: Database.Database) {
	if ((app.prepare('select count(*) as n from push_subscriptions').get() as { n: number }).n > 1) return;
	const put = app.prepare('insert or ignore into push_sent (key) values (?)');
	for (const s of signals(app, market)) put.run(keyOf(s));
}

const FLAG_RU: Record<string, string> = { fading: 'выдыхается', stuck: 'застряла', spike: 'всплеск', bounce: 'отскок' };
const fmt = (x: number | null) => (x === null ? '—' : x.toLocaleString('ru-RU', { maximumFractionDigits: 2 }));

/** the notification of a signal: short, the symbol first; a tap opens the position */
export function messageOf(s: Signal) {
	const title =
		s.kind === 'path'
			? `${s.symbol}: ${FLAG_RU[s.flag ?? ''] ?? 'метка пути'}`
			: s.kind === 'no_stop'
			? `${s.symbol}: позиция без защиты`
			: s.kind === 'stop'
			? `${s.symbol}: стоп пробит`
			: s.kind === 'target'
				? `${s.symbol}: цель достигнута`
				: s.kind === 'model_end'
					? `${s.symbol}: период модели закончился`
					: `${s.symbol}: пора пересмотреть`;
	const body =
		s.kind === 'path'
			? `Характер движения изменился. Открой «Как набиралась прибыль» и проверь тезис.`
			: s.kind === 'no_stop'
			? `Куплено без подтверждённого стопа. Открой «Защиту»: шпаргалка для брокера и «Я выставил».`
			: s.kind === 'stop'
			? s.order
				? `Цена ${fmt(s.price)} ≤ стоп ${fmt(s.stop)}: стоп у брокера должен был сработать. Проверь исполнение и внеси продажу.`
				: `Цена ${fmt(s.price)} ≤ стоп ${fmt(s.stop)}. Проверь исполнение у брокера и внеси продажу.`
			: s.kind === 'target'
				? `Цена ${fmt(s.price)} ≥ цель ${fmt(s.target)}. Продать или пересмотреть?`
				: s.kind === 'model_end'
					? `Правило 2: сделка по модели закрывается в конце её квартала.`
					: `Дата пересмотра ${s.reviewDate?.split('-').reverse().join('.') ?? ''}. Тезис ещё жив?`;
	return { title, body: `${body} · ${s.portfolio}`, url: `/position/${s.positionId}`, tag: keyOf(s) };
}

type Send = (sub: webpush.PushSubscription, payload: string) => Promise<unknown>;
const realSend: Send = (sub, payload) => {
	vapid();
	return webpush.sendNotification(sub, payload, { TTL: 24 * 3600, urgency: 'high' });
};

/** sends one message to every device of the journal; a device the push service no longer knows is removed */
export async function sendAll(app: Database.Database, msg: { title: string; body: string; url: string; tag?: string }, send: Send = realSend) {
	const subs = app.prepare('select endpoint, p256dh, auth from push_subscriptions').all() as { endpoint: string; p256dh: string; auth: string }[];
	let ok = 0;
	for (const s of subs) {
		try {
			await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg));
			ok++;
		} catch (e) {
			const code = (e as { statusCode?: number }).statusCode;
			if (code === 404 || code === 410) app.prepare('delete from push_subscriptions where endpoint = ?').run(s.endpoint);
			else console.error(`push: ${code ?? ''} ${(e as Error).message}`);
		}
	}
	return ok;
}

/**
 * The common way to notify (owner 26.11.2026: later the diary's reminders, T-032, and the day's moves, T-022, come the
 * same way): a message under a key goes to the journal's devices once; the key is kept in `push_sent`. Without devices
 * nothing is sent or kept. Returns whether it went.
 */
export async function notifyOnce(app: Database.Database, key: string, msg: { title: string; body: string; url: string; tag?: string }, send: Send = realSend) {
	if (app.prepare('select 1 from push_sent where key = ?').get(key)) return false;
	if (!(app.prepare('select count(*) as n from push_subscriptions').get() as { n: number }).n) return false;
	// marked first: a failure of one device does not send it again and again
	app.prepare('insert or ignore into push_sent (key) values (?)').run(key);
	return (await sendAll(app, { tag: key, ...msg }, send)) > 0;
}

/**
 * The job (every 5 minutes, after the live quotes): the journal's signals not sent yet, of the kinds it chose, go to
 * its devices. Without devices nothing is marked — the banner in the app is the record.
 */
export async function sendSignals(app: Database.Database, market: Database.Database, send: Send = realSend, today?: string) {
	if (!(app.prepare('select count(*) as n from push_subscriptions').get() as { n: number }).n) return 0;
	const kinds = new Set(pushKinds(app));
	let n = 0;
	for (const s of signals(app, market, today)) if (kinds.has(s.kind) && (await notifyOnce(app, keyOf(s), messageOf(s), send))) n++;
	// T-032 Д-32: the diary's reminders that fired
	if (kinds.has('reminder'))
		for (const r of app.prepare(`select id, title, entry_id as e, fired_at as f from reminders where state = 'fired'`).all() as { id: number; title: string; e: number; f: string }[])
			if (await notifyOnce(app, `reminder|${r.id}|${r.f}`, { title: 'Напоминание', body: r.title, url: '/' }, send)) n++;
	return n;
}
