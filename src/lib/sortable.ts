/**
 * Spec section 13 — blocks of the «Статистика» screen change places by long press and drag. Put it on the
 * list; its children carry `data-key`. Dragging starts after holding a child (or at once on its `data-handle`,
 * the ≡ icon); `preview` gets the live order, `drop` the final one when it changed.
 */
export interface SortableParams {
	preview?: (keys: string[] | null) => void;
	drop: (keys: string[]) => void;
}

const HOLD_MS = 450;

export function moveTo<T>(list: T[], item: T, to: number): T[] {
	const rest = list.filter((x) => x !== item);
	return [...rest.slice(0, to), item, ...rest.slice(to)];
}

export function sortable(node: HTMLElement, params: SortableParams) {
	let p = params;
	let dragKey: string | null = null;
	let start: string[] = [];
	let keys: string[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let origin: { x: number; y: number } | null = null;

	const items = () => [...node.children].filter((c) => (c as HTMLElement).dataset.key) as HTMLElement[];

	function begin(item: HTMLElement) {
		dragKey = item.dataset.key!;
		start = keys = items().map((c) => c.dataset.key!);
		node.classList.add('sorting');
		item.classList.add('dragging');
		navigator.vibrate?.(10);
	}

	function down(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const item = (e.target as HTMLElement).closest('[data-key]') as HTMLElement | null;
		if (!item || item.parentElement !== node) return;
		if ((e.target as HTMLElement).closest('a, button:not([data-handle]), input, select, textarea, [role="button"]')) return;
		origin = { x: e.clientX, y: e.clientY };
		window.addEventListener('pointermove', move, { passive: false });
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
		if ((e.target as HTMLElement).closest('[data-handle]')) {
			e.preventDefault();
			begin(item);
		} else timer = setTimeout(() => begin(item), HOLD_MS);
	}

	function move(e: PointerEvent) {
		if (dragKey === null) {
			// the finger moved before the hold: it is a scroll, not a drag
			if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 8) stop();
			return;
		}
		e.preventDefault();
		const others = items().filter((c) => c.dataset.key !== dragKey);
		const to = others.filter((c) => {
			const r = c.getBoundingClientRect();
			return r.top + r.height / 2 < e.clientY;
		}).length;
		const next = moveTo(keys, dragKey, to);
		if (next.join() !== keys.join()) {
			keys = next;
			p.preview?.(keys);
		}
	}

	function stop() {
		if (timer) clearTimeout(timer);
		timer = null;
		origin = null;
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', up);
	}

	function up() {
		stop();
		if (dragKey === null) return;
		node.classList.remove('sorting');
		node.querySelector('.dragging')?.classList.remove('dragging');
		const changed = keys.join() !== start.join();
		const final = keys;
		dragKey = null;
		if (changed) p.drop(final);
		p.preview?.(null);
	}

	// a held block must not open the iOS callout or select text
	const noMenu = (e: Event) => dragKey !== null && e.preventDefault();
	node.addEventListener('pointerdown', down);
	node.addEventListener('contextmenu', noMenu);
	return {
		update(n: SortableParams) {
			p = n;
		},
		destroy() {
			stop();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('contextmenu', noMenu);
		}
	};
}

/** The saved order, with blocks added later put at the end and unknown ones dropped. */
export function orderOf(saved: unknown, all: readonly string[]): string[] {
	const s = Array.isArray(saved) ? saved.filter((k): k is string => typeof k === 'string' && all.includes(k)) : [];
	return [...new Set([...s, ...all])];
}
