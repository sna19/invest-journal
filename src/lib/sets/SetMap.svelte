<script lang="ts">
	import { SECTORS } from '../allocation.js';
	import { onMount } from 'svelte';
	import { tx } from '../i18n.js';
	import Sheet from '../Sheet.svelte';
	import TickerSearch, { type Security } from '../TickerSearch.svelte';
	import type { SetItem } from './types.js';

	/**
	 * A set's map of ties (the picked ones, a saved set): close — they move together (weekly returns over 2 years, in
	 * dollars); a line — a tie above 0.7; a tap on a circle — its most tied neighbours; the matrix under it.
	 */
	/**
	 * Owner 27.11.2026: the same widget everywhere — the portfolios can be joined to the set by their buttons, any share
	 * added with «+», any member taken off the map with ×; the choice is remembered on the device under `storeKey`.
	 */
	let { items: base, storeKey = null }: { items: SetItem[]; storeKey?: string | null } = $props();
	type Port = { id: number; name: string; kind: string; auto_source_id: number | null; archived_at?: string | null };
	let ports = $state<Port[]>([]);
	let portsOn = $state<number[]>([]);
	let extra = $state<number[]>([]);
	let hidden = $state<number[]>([]);
	let added = $state<(SetItem & { portfolios: number[] })[]>([]);
	let picking = $state(false);
	onMount(() => {
		if (storeKey)
			try {
				const v = JSON.parse(localStorage.getItem(`setmap:${storeKey}`) ?? '{}');
				if (Array.isArray(v.portsOn)) portsOn = v.portsOn;
				if (Array.isArray(v.extra)) extra = v.extra;
				if (Array.isArray(v.hidden)) hidden = v.hidden;
			} catch {
				/* ignore */
			}
		void fetch('/api/portfolios')
			.then((r) => r.json())
			.then((j) => (ports = ((j.items ?? []) as Port[]).filter((p) => !p.auto_source_id && !p.archived_at)))
			.catch(() => {});
	});
	function remember() {
		if (!storeKey) return;
		try {
			localStorage.setItem(`setmap:${storeKey}`, JSON.stringify({ portsOn, extra, hidden }));
		} catch {
			/* ignore */
		}
	}
	// the portfolios' holdings and the added shares
	$effect(() => {
		const q = new URLSearchParams();
		if (extra.length) q.set('ids', extra.join(','));
		if (portsOn.length) q.set('portfolios', portsOn.join(','));
		if (!extra.length && !portsOn.length) return void (added = []);
		fetch(`/api/sets/items?${q}`)
			.then((r) => r.json())
			.then((j) => (added = j.items ?? []))
			.catch(() => (added = []));
	});
	const items = $derived.by(() => {
		const out: SetItem[] = [...base];
		for (const a of added) if (!out.some((x) => x.id === a.id)) out.push(a);
		return out.filter((x) => !hidden.includes(x.id)).slice(0, 30);
	});
	const togglePort = (id: number) => ((portsOn = portsOn.includes(id) ? portsOn.filter((x) => x !== id) : [...portsOn, id]), remember());
	const addShare = (id: number) => ((hidden = hidden.filter((x) => x !== id)), base.some((x) => x.id === id) || extra.includes(id) || (extra = [...extra, id]), remember());
	const takeOff = (id: number) => (extra.includes(id) ? (extra = extra.filter((x) => x !== id)) : (hidden = [...hidden, id]), remember());
	const portOf = (id: number) => (added.find((x) => x.id === id)?.portfolios ?? []).map((p) => ports.find((q) => q.id === p)?.name).filter(Boolean);
	interface MapData {
		ids: number[];
		weeks: number[];
		vol: number[];
		corr: number[][];
		xy: [number, number][];
		links: [number, number, number][];
		loading: number[];
	}
	let map = $state<MapData | null>(null);
	let loaded = $state(false);
	let selected = $state<number | null>(null);
	$effect(() => {
		const ids = items.map((x) => x.id);
		loaded = false;
		if (ids.length < 2) return void ((map = null), (loaded = true));
		fetch(`/api/sets/map?ids=${ids.join(',')}`)
			.then((r) => r.json())
			.then((j) => ((map = j.map ?? null), (loaded = true)))
			.catch(() => ((map = null), (loaded = true)));
	});
	const num = (x: unknown, d = 1) => (typeof x === 'number' ? x.toFixed(d).replace('.', tx(',', '.')) : '—');
	const SECTOR_KEYS = Object.keys(SECTORS);
	const itemOf = (id: number) => items.find((x) => x.id === id);
	const colorOf = (id: number) => {
		const s = itemOf(id)?.sector;
		return s && SECTOR_KEYS.includes(s) ? `var(--series-${(SECTOR_KEYS.indexOf(s) % 8) + 1})` : 'var(--series-muted)';
	};
	const box = $derived.by(() => {
		if (!map) return { x0: 0, y0: 0, k: 1 };
		const xs = map.xy.map((p) => p[0]);
		const ys = map.xy.map((p) => p[1]);
		const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.2);
		return { x0: (Math.max(...xs) + Math.min(...xs)) / 2 - span / 2, y0: (Math.max(...ys) + Math.min(...ys)) / 2 - span / 2, k: 76 / span };
	});
	const px = (i: number): [number, number] => (map ? [12 + (map.xy[i][0] - box.x0) * box.k, 12 + (map.xy[i][1] - box.y0) * box.k] : [0, 0]);
	const neighbours = $derived.by(() => {
		if (!map || selected === null) return [];
		const i = map.ids.indexOf(selected);
		if (i < 0) return [];
		return map.ids
			.map((id, j) => ({ id, c: map!.corr[i][j] }))
			.filter((x) => x.id !== selected)
			.sort((a, b) => b.c - a.c)
			.slice(0, 3);
	});
	const heat = (c: number) => (c >= 0 ? `color-mix(in srgb, var(--down) ${Math.round(c * 85)}%, var(--surface))` : `color-mix(in srgb, var(--series-1) ${Math.round(-c * 85)}%, var(--surface))`);
</script>

<div class="ctl" role="group" aria-label={tx('Что на карте', 'What is on the map')}>
	{#each ports as p (p.id)}
		<button class:on={portsOn.includes(p.id)} aria-pressed={portsOn.includes(p.id)} onclick={() => togglePort(p.id)}>{p.name}</button>
	{/each}
	<button class="add" onclick={() => (picking = true)}>+ {tx('акция', 'share')}</button>
</div>
<div class="members">
	{#each items as it (it.id)}
		<span class="m" title={portOf(it.id).join(', ')}>{it.symbol}{#if portOf(it.id).length && !base.some((x) => x.id === it.id)}<small> · {portOf(it.id).join(', ')}</small>{/if}<button aria-label={tx(`Убрать ${it.symbol} с карты`, `Take ${it.symbol} off the map`)} onclick={() => takeOff(it.id)}>×</button></span>
	{/each}
	{#if hidden.length}<button class="link" onclick={() => ((hidden = []), remember())}>{tx(`вернуть убранные (${hidden.length})`, `bring back the removed (${hidden.length})`)}</button>{/if}
</div>

{#if picking}
	<Sheet title={tx('Добавить на карту', 'Add to the map')} onclose={() => (picking = false)}>
		<div class="pick">
			<TickerSearch noIndex multi label={tx('Найти тикер — можно несколько подряд', 'Find a ticker — several in a row')} onselect={(s: Security) => addShare(s.id)} />
			<p class="muted small">{tx(`На карте ${items.length} из 30`, `On the map ${items.length} of 30`)}</p>
			<button class="primary" onclick={() => (picking = false)}>{tx('Готово', 'Done')}</button>
		</div>
	</Sheet>
{/if}

{#if !loaded}
	<div class="skeleton"></div>
{:else if !map}
	<p class="muted small">{tx('Для карты нужно хотя бы две бумаги с историей цен.', 'The map needs at least two securities with price history.')}</p>
{:else}
	<svg class="map" viewBox="0 0 100 100" role="img" aria-label={tx('Карта связей', 'Map of ties')}>
		{#each map.links as [a, b, c] (a + '-' + b)}
			{@const pa = px(a)}
			{@const pb = px(b)}
			<line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} class="link" style:stroke-width={0.2 + (c - 0.7) * 2} />
		{/each}
		{#each map.ids as id, i (id)}
			{@const p = px(i)}
			<g class="node" class:sel={selected === id} role="button" tabindex="0" aria-label={itemOf(id)?.symbol} onclick={() => (selected = selected === id ? null : id)} onkeydown={(e) => e.key === 'Enter' && (selected = id)}>
				<circle cx={p[0]} cy={p[1]} r="4" fill={colorOf(id)} />
				<text x={p[0]} y={p[1] + 7}>{itemOf(id)?.symbol}{map.weeks[i] < 52 ? '*' : ''}</text>
			</g>
		{/each}
	</svg>
	{#if selected !== null && neighbours.length}
		<p class="small">{tx('Сильнее всего связана', 'Most tied')} <a href="/security/{selected}"><b>{itemOf(selected)?.symbol}</b></a>: {#each neighbours as x, k (x.id)}{k ? ' · ' : ''}{itemOf(x.id)?.symbol} {num(x.c, 2)}{/each}</p>
	{:else}
		<p class="muted small">{tx('Близко — движутся вместе (недельные доходности за 2 года, в долларах); линия — связь выше 0,7. Тап по кругу — его самые связанные соседи.', 'Close — they move together (weekly returns over 2 years, in dollars); a line — a tie above 0.7. Tap a circle — its most tied neighbours.')}{#if map.weeks.some((w) => w < 52)} {tx('* — меньше года истории.', '* — under a year of history.')}{/if}{#if map.loading.length} {tx('Часть историй ещё загружается.', 'Some histories are still loading.')}{/if}</p>
	{/if}
	<div class="scroll">
		<table class="heat">
			<thead><tr><th></th>{#each map.ids as id (id)}<th>{itemOf(id)?.symbol}</th>{/each}</tr></thead>
			<tbody>
				{#each map.ids as a, i (a)}
					<tr>
						<th>{itemOf(a)?.symbol}</th>
						{#each map.ids as b, j (b)}<td style:background={i === j ? 'var(--bg)' : heat(map.corr[i][j])}>{i === j ? '' : num(map.corr[i][j], 1)}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.ctl {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: var(--s2);
	}
	.ctl button {
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.ctl button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.ctl .add {
		border-style: dashed;
		color: var(--link);
	}
	.members {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		margin-bottom: var(--s2);
		font-size: var(--fs-xs);
	}
	.m {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.m small {
		color: var(--muted);
	}
	.m button,
	.link {
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
		font-size: var(--fs-xs);
		padding: 4px;
	}
	.link {
		color: var(--link);
	}
	.pick {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.primary {
		min-height: 44px;
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
	}
	.skeleton {
		height: 240px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.small a {
		color: var(--link);
	}
	.scroll {
		overflow-x: auto;
	}
	.map {
		width: 100%;
		max-width: 420px;
		display: block;
		margin: 0 auto;
		aspect-ratio: 1;
	}
	.map .link {
		stroke: var(--muted);
		opacity: 0.6;
	}
	.node {
		cursor: pointer;
	}
	.node circle {
		stroke: var(--surface);
		stroke-width: 0.5;
		opacity: 0.85;
	}
	.node.sel circle {
		stroke: var(--text);
		stroke-width: 0.8;
	}
	.node text {
		font-size: 3px;
		text-anchor: middle;
		fill: var(--text);
	}
	.heat {
		border-collapse: collapse;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		margin-top: var(--s3);
	}
	.heat th,
	.heat td {
		padding: 3px 4px;
		text-align: center;
		white-space: nowrap;
	}
</style>
