import { page } from '$app/state';
import { invalidateAll } from '$app/navigation';
import { EN, PATTERNS } from './i18n-en.js';

/**
 * Two languages, Russian and English (owner's request 19.11.2026: the second user reads English). The language belongs to
 * the user (users.lang) and is also kept in the «lang» cookie for the login page. `t(key)` reads the language of
 * the current page, so a switch re-renders everything at once.
 */
export type Lang = 'ru' | 'en';
export type L10n = { ru: string; en: string };

export function lang(): Lang {
	try {
		return (page.data?.lang as Lang) ?? 'ru';
	} catch {
		// outside a page (server code that shares a helper): Russian, as before
		return 'ru';
	}
}

/** a text written in place, in both languages: tx('Портфель', 'Portfolio') */
export const tx = (ru: string, en: string) => (lang() === 'en' ? en : ru);

/** a text that came as data (a label or a message from the server): its English, when known */
export function tl(text: string | null | undefined): string {
	if (!text) return text ?? '';
	if (lang() !== 'en') return text;
	const hit = EN[text];
	if (hit) return hit;
	// a pattern's parts are looked up too: a message can carry another message inside
	for (const [re, en] of PATTERNS) {
		const m = text.match(re);
		if (m) return en.replace(/\$(\d)/g, (_, i) => tl(m[Number(i)] ?? ''));
	}
	return text;
}

/** the locale for numbers and dates */
export const loc = () => (lang() === 'en' ? 'en-GB' : 'ru-RU');

/** pick the current language from a pair */
export function tr(x: L10n | string): string {
	return typeof x === 'string' ? x : x[lang()];
}

export async function setLang(l: Lang) {
	await fetch('/api/auth/lang', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: l }) });
	document.documentElement.lang = l;
	await invalidateAll();
}

const D = {
	'app.name': { ru: 'Журнал гипотез', en: 'Hypothesis journal' },
	// tabs
	'tab.portfolio': { ru: 'Портфель', en: 'Portfolio' },
	'tab.hypotheses': { ru: 'Гипотезы', en: 'Hypotheses' },
	'tab.sources': { ru: 'Источники', en: 'Sources' },
	'tab.stats': { ru: 'Статистика', en: 'Stats' },
	'tab.more': { ru: 'Ещё', en: 'More' },
	'tab.sections': { ru: 'Разделы', en: 'Sections' },
	'tab.new': { ru: 'Новая гипотеза', en: 'New hypothesis' },
	// more
	'more.tickers': { ru: 'Тикеры', en: 'Tickers' },
	'more.settings': { ru: 'Настройки', en: 'Settings' },
	'more.account': { ru: 'Учётная запись', en: 'Account' },
	'more.credits': {
		ru: 'Графики — TradingView Lightweight Charts™, Copyright © 2025 TradingView, Inc.',
		en: 'Charts — TradingView Lightweight Charts™, Copyright © 2025 TradingView, Inc.'
	},
	'more.licence': { ru: 'лицензия Apache 2.0.', en: 'Apache 2.0 licence.' },
	'more.sources': {
		ru: 'Курс доллара — Банк Израиля. Цены — Yahoo Finance; списки бумаг — Nasdaq Trader и TASE.',
		en: 'Dollar rate — Bank of Israel. Prices — Yahoo Finance; security lists — Nasdaq Trader and TASE.'
	},
	// login
	'login.title': { ru: 'Вход', en: 'Sign in' },
	'login.setup': { ru: 'Первый вход', en: 'First sign-in' },
	'login.setupNote': {
		ru: 'Пользователей ещё нет. Заведите свою учётную запись — журнал, который уже есть, станет вашим.',
		en: 'No users yet. Create your account — the journal that is already here becomes yours.'
	},
	'login.login': { ru: 'Логин', en: 'Login' },
	'login.name': { ru: 'Имя', en: 'Name' },
	'login.password': { ru: 'Пароль', en: 'Password' },
	'login.submit': { ru: 'Войти', en: 'Sign in' },
	'login.create': { ru: 'Создать и войти', en: 'Create and sign in' },
	'login.remember': { ru: 'Вход запоминается на этом устройстве на год.', en: 'The sign-in is remembered on this device for a year.' },
	'login.bad': { ru: 'Неверный логин или пароль', en: 'Wrong login or password' },
	// errors of account forms
	'err.login': { ru: 'Логин: 2–32 латинских буквы, цифры, точка, дефис или _', en: 'Login: 2–32 Latin letters, digits, dot, hyphen or _' },
	'err.password': { ru: 'Пароль — не короче 6 символов', en: 'The password must be at least 6 characters' },
	'err.taken': { ru: 'Такой логин уже есть', en: 'This login is taken' },
	'err.mismatch': { ru: 'Пароли не совпадают', en: 'The passwords do not match' },
	'err.old': { ru: 'Текущий пароль неверен', en: 'The current password is wrong' },
	// account
	'acc.title': { ru: 'Учётная запись', en: 'Account' },
	'acc.you': { ru: 'Вы вошли как', en: 'Signed in as' },
	'acc.lang': { ru: 'Язык', en: 'Language' },
	'acc.password': { ru: 'Сменить пароль', en: 'Change password' },
	'acc.old': { ru: 'Текущий пароль', en: 'Current password' },
	'acc.new': { ru: 'Новый пароль', en: 'New password' },
	'acc.repeat': { ru: 'Повторите новый пароль', en: 'Repeat the new password' },
	'acc.save': { ru: 'Сохранить', en: 'Save' },
	'acc.saved': { ru: 'Пароль сменён. Другие устройства выйдут из журнала.', en: 'Password changed. Other devices are signed out.' },
	'acc.logout': { ru: 'Выйти', en: 'Sign out' },
	'acc.logoutAll': { ru: 'Выйти на всех устройствах', en: 'Sign out on all devices' },
	'acc.users': { ru: 'Пользователи', en: 'Users' },
	'acc.usersNote': {
		ru: 'У каждого пользователя свой журнал: портфели, гипотезы, источники. Рыночные данные общие.',
		en: 'Each user has a journal of their own: portfolios, hypotheses, sources. Market data are shared.'
	},
	'acc.admin': { ru: 'админ', en: 'admin' },
	'acc.add': { ru: 'Добавить пользователя', en: 'Add a user' },
	'acc.added': { ru: 'Пользователь добавлен', en: 'User added' },
	'acc.reset': { ru: 'Новый пароль', en: 'New password' },
	'acc.resetDone': { ru: 'Пароль задан', en: 'Password set' },
	'acc.back': { ru: 'Ещё', en: 'More' }
} satisfies Record<string, L10n>;

export type Key = keyof typeof D;

export function t(key: Key, vars?: Record<string, string | number>): string {
	let s = D[key][lang()];
	if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
	return s;
}
