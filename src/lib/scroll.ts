import { beforeNavigate } from '$app/navigation';
import { tick } from 'svelte';

/**
 * A screen remembers where it was scrolled to (owner's request 26.11.2026: back on the portfolio after a card, the
 * screen was at its top). Call in a component's script with a key (the screen and its query); after the screen's
 * data are on it, `restore()` scrolls back once. Kept for the browser tab's life (sessionStorage).
 */
export function keepScroll(key: () => string) {
	let done = false;
	beforeNavigate(() => {
		try {
			sessionStorage.setItem(`scroll:${key()}`, String(Math.round(window.scrollY)));
		} catch {
			/* private mode */
		}
	});
	return {
		async restore() {
			if (done) return;
			done = true;
			await tick();
			let y = 0;
			try {
				y = Number(sessionStorage.getItem(`scroll:${key()}`)) || 0;
			} catch {
				/* ignore */
			}
			// the layout still grows (charts, folds load after): try again while it does, until the place is reached;
			// a scroll by the person stops it
			if (y > 0) {
				let moved = false;
				const mark = () => (moved = true);
				window.addEventListener('touchstart', mark, { once: true, passive: true });
				window.addEventListener('wheel', mark, { once: true, passive: true });
				for (const ms of [0, 150, 400, 800, 1500, 2500]) {
					setTimeout(() => {
						if (!moved && Math.abs(window.scrollY - y) > 5) window.scrollTo(0, y);
					}, ms);
				}
			}
		}
	};
}
