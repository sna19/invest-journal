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
	let p = cache.get(key);
	if (!p) {
		p = fetch(`/api/help/${encodeURIComponent(key)}`).then(async (r) => {
			if (!r.ok) throw new Error('Справка не загрузилась');
			return r.json();
		});
		p.catch(() => cache.delete(key));
		cache.set(key, p);
	}
	return p;
}
