import { lang, tx } from './i18n.js';
/** Spec section 8 — at most one help window open: the id of the icon whose window is open. */
export const help = $state<{ open: string | null }>({ open: null });

export interface HelpTopic {
	key: string;
	title: string;
	html: string;
}

const cache = new Map<string, Promise<HelpTopic>>();

/** Texts change only with a deploy, so a topic is fetched once per page load. */
export function loadTopic(key: string): Promise<HelpTopic> {
	// the language is in the cache key: after a switch the topic comes in the new language
	const ck = `${lang()}:${key}`;
	let p = cache.get(ck);
	if (!p) {
		p = fetch(`/api/help/${encodeURIComponent(key)}`).then(async (r) => {
			if (!r.ok) throw new Error(tx('Справка не загрузилась', 'Help did not load'));
			return r.json();
		});
		p.catch(() => cache.delete(ck));
		cache.set(ck, p);
	}
	return p;
}
