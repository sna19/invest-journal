/** a security of a set at a glance (the picked ones, a saved set) */
export interface SetItem {
	id: number;
	symbol: string;
	name: string;
	exchange: string;
	unit: string;
	origin: string | null;
	addedAt: string | null;
	price: number | null;
	dayPct: number | null;
	m1: number | null;
	m3: number | null;
	y1: number | null;
	sector: string | null;
	capUsd: number | null;
}
