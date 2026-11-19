<script lang="ts">
	import { tx } from '#lib/i18n.js';
	/**
	 * Spec section 13 — the small chart in a list row: the security (solid) against its benchmark (dashed) over the
	 * hypothesis's term, both from 100 at the entry.
	 */
	let { points, width = 72, height = 28 }: { points: [number, number][] | null; width?: number; height?: number } = $props();
	const lines = $derived.by(() => {
		if (!points || points.length < 2) return null;
		const all = points.flat();
		const lo = Math.min(...all);
		const hi = Math.max(...all);
		const span = hi - lo || 1;
		const x = (i: number) => ((i / (points.length - 1)) * (width - 2) + 1).toFixed(1);
		const y = (v: number) => (height - 1 - ((v - lo) / span) * (height - 2)).toFixed(1);
		const path = (k: 0 | 1) => points.map((p, i) => `${x(i)},${y(p[k])}`).join(' ');
		return { s: path(0), b: path(1) };
	});
</script>

{#if lines}
	<svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={tx('Бумага против бенчмарка', 'Security vs benchmark')}>
		<polyline points={lines.b} class="b" />
		<polyline points={lines.s} class="s" />
	</svg>
{/if}

<style>
	svg {
		flex: none;
		overflow: visible;
	}
	polyline {
		fill: none;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.s {
		stroke: var(--text);
		stroke-width: 1.8;
	}
	.b {
		stroke: var(--muted);
		stroke-width: 1.2;
		stroke-dasharray: 3 2;
	}
</style>
