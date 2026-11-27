import { lang } from './i18n.js';

/**
 * T-019: the «Напоминание» lines of the help topics, fetched once per page load (and again after a language switch);
 * the screens show a block's line under its title unless the owner turned them off in «Настройки».
 */
export const rem = $state<{ show: boolean; items: Record<string, string>; lang: string | null }>({ show: true, items: {}, lang: null });
let loading: Promise<void> | null = null;
export function loadReminders() {
	if (rem.lang === lang() || loading) return;
	loading = fetch('/api/help')
		.then((r) => (r.ok ? r.json() : null))
		.then((j) => {
			if (j) ((rem.show = j.show), (rem.items = j.items), (rem.lang = lang()));
		})
		.catch(() => {})
		.finally(() => (loading = null));
}
export async function setShowReminders(show: boolean) {
	rem.show = show;
	await fetch('/api/help', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ show }) }).catch(() => {});
}
