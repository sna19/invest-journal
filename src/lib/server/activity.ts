/**
 * Owner 27.11.2026: «Если пересчёт берёт так много времени — дай статус „Делаю пересчёт“ … но не зависшие окна». What
 * the server is doing in the background now — the app shows it in a thin bar, and the work itself goes in portions
 * so that the screens keep answering meanwhile.
 */
export interface Activity {
	key: string;
	label: string;
	since: number;
	done: number | null;
	total: number | null;
}

const now = new Map<string, Activity>();
/** the last finished one, shown for a moment as «готово» */
let last: { label: string; at: number } | null = null;

export function begin(key: string, label: string, total: number | null = null) {
	const a: Activity = { key, label, since: Date.now(), done: total === null ? null : 0, total };
	now.set(key, a);
	return {
		progress(done: number, total?: number) {
			a.done = done;
			if (total !== undefined) a.total = total;
		},
		end() {
			if (now.get(key) === a) now.delete(key);
			last = { label: a.label, at: Date.now() };
		}
	};
}

export function activities() {
	return { busy: [...now.values()], last: last && Date.now() - last.at < 60_000 ? last : null };
}

/** lets the server answer requests between portions of work */
export const breathe = () => new Promise<void>((r) => setImmediate(r));
