/**
 * Owner 27.11.2026: every table sorts by a tap on its column's header — no rows of sort buttons. The first tap sorts
 * by the column (numbers — the biggest first, text — A to Z), the second turns it over, the third goes back to the
 * table's own order. Empty values always go last.
 */
export type Val = number | string | null | undefined;

export class TableSort<K extends string = string> {
	key = $state<K | null>(null);
	desc = $state(true);
	/** the first tap's direction of the column now sorted */
	#first = true;
	constructor(key: K | null = null, desc = true) {
		this.key = key;
		this.desc = desc;
		this.#first = desc;
	}
	by(k: K, firstDesc = true) {
		if (this.key !== k) {
			this.key = k;
			this.desc = this.#first = firstDesc;
		} else if (this.desc === this.#first) this.desc = !this.desc;
		else this.key = null;
	}
	rows<T>(list: T[], get: (row: T, key: K) => Val): T[] {
		const k = this.key;
		if (k === null) return list;
		const d = this.desc ? -1 : 1;
		return [...list].sort((a, b) => {
			const x = get(a, k);
			const y = get(b, k);
			const nx = x === null || x === undefined || (typeof x === 'number' && !Number.isFinite(x));
			const ny = y === null || y === undefined || (typeof y === 'number' && !Number.isFinite(y));
			if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;
			if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
			return String(x).localeCompare(String(y)) * d;
		});
	}
}
