<script lang="ts" module>
	import { loc, tx } from '#lib/i18n.js';
	/** Colours of sources' marks and of compared lines: readable in both themes. */
	export const PALETTE = ['#2f7de1', '#d9822b', '#2e9e6b', '#b5479b', '#8a6fd8', '#c94040', '#1f9fb0', '#9a8a26'];
	export const colorOf = (n: number) => PALETTE[Math.abs(n) % PALETTE.length];
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, Time } from 'lightweight-charts';

	/**
	 * Spec section 19 — one line chart on Lightweight Charts (TradingView, Apache-2.0; its logo on the chart is
	 * the link the licence asks for). Pinch to zoom, drag to scroll; a long press shows the values on a date;
	 * a tap on a mark calls `onmarker`. Colours come from the design tokens and follow the theme.
	 */
	export interface Line {
		key: string;
		label: string;
		points: { date: string; value: number }[];
		color?: string;
		/** the main line carries the marks and the price scale label */
		main?: boolean;
		dashed?: boolean;
	}
	export interface Mark {
		id: string;
		date: string;
		price: number;
		kind: 'entry' | 'exit' | 'buy' | 'sell';
		color: string;
		text?: string;
		up?: boolean;
	}
	interface Props {
		lines: Line[];
		marks?: Mark[];
		/** percent values (portfolio returns) or prices */
		percent?: boolean;
		height?: number;
		onmarker?: (id: string) => void;
		/** how the price reads in the legend */
		format?: (v: number) => string;
	}
	let { lines, marks = [], percent = false, height = 260, onmarker, format }: Props = $props();

	let el: HTMLDivElement;
	let chart: IChartApi | null = null;
	let lib: typeof import('lightweight-charts') | null = null;
	let series: ISeriesApi<'Line'>[] = [];
	let markersApi: ISeriesMarkersPluginApi<Time> | null = null;
	let legend = $state<{ date: string; values: { label: string; color: string; value: string }[] } | null>(null);
	let media: MediaQueryList | null = null;

	const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	const fmt = (v: number) => (format ? format(v) : percent ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : v.toLocaleString(loc(), { maximumFractionDigits: 2 }));

	function theme() {
		return {
			layout: { background: { color: 'transparent' }, textColor: css('--muted'), fontFamily: css('--font'), attributionLogo: true },
			grid: { vertLines: { visible: false }, horzLines: { color: css('--line') } },
			rightPriceScale: { borderVisible: false },
			timeScale: { borderVisible: false },
			crosshair: { vertLine: { color: css('--muted') }, horzLine: { color: css('--muted') } }
		};
	}

	function draw() {
		if (!chart || !lib) return;
		for (const s of series) chart.removeSeries(s);
		series = [];
		markersApi = null;
		for (const l of lines) {
			const s = chart.addSeries(lib.LineSeries, {
				color: l.color ?? css('--accent'),
				lineWidth: l.main ? 2 : 1,
				lineStyle: l.dashed ? lib.LineStyle.Dashed : lib.LineStyle.Solid,
				priceLineVisible: false,
				lastValueVisible: !!l.main,
				crosshairMarkerRadius: 3,
				priceFormat: percent ? { type: 'custom', formatter: (v: number) => `${v.toFixed(0)}%`, minMove: 0.01 } : { type: 'price', precision: 2, minMove: 0.01 }
			});
			s.setData(l.points.map((p) => ({ time: p.date as Time, value: p.value })));
			series.push(s);
			if (l.main && marks.length) {
				markersApi = lib.createSeriesMarkers(
					s,
					marks.map((m) => ({
						id: m.id,
						time: m.date as Time,
						position: 'atPriceMiddle' as const,
						price: m.price,
						shape: m.kind === 'buy' ? ('arrowUp' as const) : m.kind === 'sell' ? ('arrowDown' as const) : m.kind === 'entry' ? ('circle' as const) : ('square' as const),
						color: m.color,
						size: 1.4,
						text: m.text
					}))
				);
			}
		}
		chart.timeScale().fitContent();
	}

	function onCross(p: MouseEventParams<Time>) {
		if (!p.time || !p.seriesData.size) return (legend = null);
		legend = {
			date: new Date(String(p.time) + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }),
			values: series
				.map((s, i) => {
					const d = p.seriesData.get(s) as { value?: number } | undefined;
					return d?.value === undefined ? null : { label: lines[i].label, color: lines[i].color ?? css('--accent'), value: fmt(d.value) };
				})
				.filter((x): x is { label: string; color: string; value: string } => !!x)
		};
	}

	function onClick(p: MouseEventParams<Time>) {
		if (p.hoveredObjectId && onmarker) onmarker(String(p.hoveredObjectId));
	}

	onMount(async () => {
		lib = await import('lightweight-charts');
		chart = lib.createChart(el, {
			height,
			autoSize: true,
			...theme(),
			localization: { locale: loc(), dateFormat: 'dd.MM.yy' },
			handleScale: { pinch: true, mouseWheel: false, axisPressedMouseMove: false },
			handleScroll: { horzTouchDrag: true, vertTouchDrag: false, pressedMouseMove: true }
		});
		chart.subscribeCrosshairMove(onCross);
		chart.subscribeClick(onClick);
		draw();
		media = matchMedia('(prefers-color-scheme: dark)');
		media.addEventListener('change', retheme);
	});
	const retheme = () => {
		chart?.applyOptions(theme());
		draw();
	};
	onDestroy(() => {
		media?.removeEventListener('change', retheme);
		chart?.remove();
		chart = null;
	});

	$effect(() => {
		// redraw when the data changes
		void lines;
		void marks;
		draw();
	});
	void markersApi;
</script>

<div class="wrap">
	<div class="legend" aria-live="polite">
		{#if legend}
			<span class="d">{legend.date}</span>
			{#each legend.values as v (v.label)}<span><i style:background={v.color}></i>{v.label} <b>{v.value}</b></span>{/each}
		{:else}
			{#each lines as l (l.key)}<span><i style:background={l.color ?? 'var(--accent)'} class:dash={l.dashed}></i>{l.label}</span>{/each}
		{/if}
	</div>
	<div class="chart" bind:this={el} style:height="{height}px" role="img" aria-label="{tx('График', 'Chart')}: {lines.map((l) => l.label).join(', ')}"></div>
</div>

<style>
	.wrap {
		position: relative;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 2px var(--s3);
		min-height: 20px;
		margin-bottom: var(--s1);
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.legend b {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.legend .d {
		color: var(--text);
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 3px;
		border-radius: 2px;
	}
	.legend i.dash {
		background: repeating-linear-gradient(90deg, currentColor 0 3px, transparent 3px 5px) !important;
	}
	.chart {
		width: 100%;
		touch-action: pan-y;
	}
</style>
