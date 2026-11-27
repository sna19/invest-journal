/**
 * Owner 27.11.2026: the background work's bar. The app asks the server what it is doing — every 3 s while something
 * runs, every 30 s otherwise (only while the screen is visible); an action that starts heavy work calls `watchActivity`
 * to look at once.
 */
export interface Busy {
	key: string;
	label: string;
	since: number;
	done: number | null;
	total: number | null;
}
export const activity = $state<{ busy: Busy[]; last: { label: string; at: number } | null; finished: boolean }>({ busy: [], last: null, finished: false });

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function poll() {
	timer = null;
	if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return schedule(30_000);
	const j = await fetch('/api/activity')
		.then((r) => (r.ok ? r.json() : null))
		.catch(() => null);
	if (j) {
		const was = activity.busy.length > 0;
		activity.busy = j.busy;
		activity.last = j.last;
		if (was && !j.busy.length) activity.finished = true;
	}
	schedule(activity.busy.length ? 3000 : 30_000);
}
function schedule(ms: number) {
	if (timer) clearTimeout(timer);
	timer = setTimeout(poll, ms);
}

export function startActivity() {
	if (started) return;
	started = true;
	document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && schedule(0));
	schedule(500);
}

/** an action that may start background work: look now and a few times soon after */
export function watchActivity() {
	activity.finished = false;
	schedule(800);
}
