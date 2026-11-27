/**
 * Owner 27.11.2026: ☆ right in the lists (signals, …) without opening the card. The picked ids are asked once a page
 * and kept here; a tap picks or unpicks at once.
 */
export const picked = $state<{ ids: Set<number>; loaded: boolean }>({ ids: new Set(), loaded: false });
let asking: Promise<void> | null = null;

export function wantPicked() {
	if (picked.loaded || asking) return;
	asking = fetch('/api/shortlist')
		.then((r) => (r.ok ? r.json() : null))
		.then((j) => {
			picked.ids = new Set(((j?.items ?? []) as { id: number }[]).map((x) => x.id));
			picked.loaded = true;
		})
		.catch(() => {})
		.finally(() => (asking = null));
}

export async function setPicked(id: number, on: boolean, origin: string) {
	const next = new Set(picked.ids);
	if (on) next.add(id);
	else next.delete(id);
	picked.ids = next;
	await fetch('/api/shortlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ securityId: id, on, origin }) }).catch(() => null);
}
