/**
 * T-034: the quant scores on the client — asked for in one request per list (the ids of a screen are gathered for
 * a moment), kept for the page's life.
 */
export type Factor = 'quality' | 'growth' | 'valuation' | 'momentum';
export interface Score {
	id: number;
	sector: string | null;
	market: 'US' | 'IL' | null;
	color: 'green' | 'yellow' | 'red' | 'grey';
	total: number | null;
	factors: Record<Factor, { pct: number | null; grade: string | null; metrics: { key: string; value: number; pct: number; peers: number; scope: 'sector' | 'market' }[] }>;
	trend: { price: number; sma200: number; above: boolean } | null;
}
export const scores = $state<Record<number, Score>>({});
let queue = new Set<number>();
let timer: ReturnType<typeof setTimeout> | null = null;
const asked = new Set<number>();

export function wantScore(id: number) {
	if (asked.has(id)) return;
	asked.add(id);
	queue.add(id);
	if (timer) return;
	timer = setTimeout(async () => {
		const ids = [...queue];
		queue = new Set();
		timer = null;
		for (let i = 0; i < ids.length; i += 200) {
			const j = await fetch(`/api/score?ids=${ids.slice(i, i + 200).join(',')}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
			if (j) Object.assign(scores, j.items);
		}
	}, 30);
}
