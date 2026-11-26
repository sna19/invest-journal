<script lang="ts">
	import ScoreDot from '#lib/ScoreDot.svelte';
	import { onMount } from 'svelte';
	import TopBar from '#lib/TopBar.svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import ScreenSwitch from '#lib/ScreenSwitch.svelte';
	import RecentCards from '#lib/RecentCards.svelte';
	import TvLink from '#lib/TvLink.svelte';
	import { SECTORS, sectorName } from '#lib/allocation.js';
	import { loc, tx } from '#lib/i18n.js';
	import { keepScroll } from '#lib/scroll.js';

	/**
	 * «Отмеченные» (owner's request 26.11.2026): the securities picked — a model's candidates opened from the model,
	 * any card with ☆ — at one glance: the numbers, a comparison table and their map of ties.
	 */
	interface Item {
		id: number;
		symbol: string;
		name: string;
		exchange: string;
		unit: string;
		origin: string | null;
		addedAt: string;
		price: number | null;
		dayPct: number | null;
		m1: number | null;
		m3: number | null;
		y1: number | null;
		sector: string | null;
		capUsd: number | null;
	}
	interface MapData {
		ids: number[];
		weeks: number[];
		vol: number[];
		corr: number[][];
		xy: [number, number][];
		links: [number, number, number][];
		loading: number[];
	}
	type Stat = Record<string, number | string | boolean | null>;

	let items = $state<Item[] | null>(null);
	let stats = $state<Record<number, Stat | null>>({});
	let map = $state<MapData | null>(null);
	let sortKey = $state<string>('y1');
	let sortDesc = $state(true);
	let selected = $state<number | null>(null);
	const scroll = keepScroll(() => 'shortlist');

	async function load() {
		const r = await fetch('/api/shortlist').then((x) => x.json()).catch(() => null);
		items = r?.items ?? [];
		void scroll.restore();
		if (items!.length) {
			const ids = items!.map((x) => x.id);
			// the ratios: 8 a call are loaded from the provider — ask until all are there
			for (let k = 0; k < 5; k++) {
				const s = await fetch(`/api/ratios?ids=${ids.join(',')}`).then((x) => x.json()).catch(() => null);
				const got = s?.items ?? {};
				stats = Object.fromEntries(Object.entries(got).map(([id, v]) => [Number(id), (v as { stats: Stat | null }).stats]));
				if (ids.every((id) => id in got)) break;
			}
			const m = await fetch('/api/shortlist/map').then((x) => x.json()).catch(() => null);
			map = m?.map ?? null;
		}
	}
	onMount(load);
	async function unpick(id: number) {
		await fetch('/api/shortlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ securityId: id, on: false }) });
		items = items?.filter((x) => x.id !== id) ?? null;
		const m = await fetch('/api/shortlist/map').then((x) => x.json()).catch(() => null);
		map = m?.map ?? null;
	}

	const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d).replace('.', tx(',', '.'))}%`);
	const num = (x: unknown, d = 1) => (typeof x === 'number' ? x.toFixed(d).replace('.', tx(',', '.')) : '—');
	const frac = (x: unknown, d = 0) => (typeof x === 'number' ? `${(x * 100).toFixed(d).replace('.', tx(',', '.'))}%` : '—');
	const price = (it: Item) => (it.price === null ? '—' : it.unit === 'ILA' ? `${(it.price / 100).toLocaleString(loc(), { maximumFractionDigits: 2 })} ₪` : `${it.price.toLocaleString(loc(), { maximumFractionDigits: 2 })} ${it.unit === 'ILS' ? '₪' : '$'}`);
	const cap = (x: number | null) => (x === null ? '—' : x >= 1e12 ? `${(x / 1e12).toFixed(1)} ${tx('трлн', 'T')}` : x >= 1e9 ? `${Math.round(x / 1e9)} ${tx('млрд', 'B')}` : `${Math.round(x / 1e6)} ${tx('млн', 'M')}`);

	// the comparison table: columns, a tap sorts by one
	const COLS: { key: string; ru: string; en: string; get: (it: Item) => number | null; fmt: (it: Item) => string }[] = [
		{ key: 'dayPct', ru: 'День', en: 'Day', get: (it) => it.dayPct, fmt: (it) => pct(it.dayPct) },
		{ key: 'm1', ru: '1М', en: '1M', get: (it) => it.m1, fmt: (it) => pct(it.m1) },
		{ key: 'm3', ru: '3М', en: '3M', get: (it) => it.m3, fmt: (it) => pct(it.m3) },
		{ key: 'y1', ru: '1Г', en: '1Y', get: (it) => it.y1, fmt: (it) => pct(it.y1) },
		{ key: 'pe', ru: 'P/E', en: 'P/E', get: (it) => (stats[it.id]?.pe as number) ?? null, fmt: (it) => num(stats[it.id]?.pe) },
		{ key: 'ps', ru: 'P/S', en: 'P/S', get: (it) => (stats[it.id]?.ps as number) ?? null, fmt: (it) => num(stats[it.id]?.ps) },
		{ key: 'beta', ru: 'Бета', en: 'Beta', get: (it) => (stats[it.id]?.beta as number) ?? null, fmt: (it) => num(stats[it.id]?.beta, 2) },
		{ key: 'margin', ru: 'Маржа', en: 'Margin', get: (it) => (stats[it.id]?.profitMargin as number) ?? null, fmt: (it) => frac(stats[it.id]?.profitMargin) },
		{ key: 'roe', ru: 'ROE', en: 'ROE', get: (it) => (stats[it.id]?.roe as number) ?? null, fmt: (it) => frac(stats[it.id]?.roe) },
		{ key: 'growth', ru: 'Рост выручки', en: 'Revenue growth', get: (it) => (stats[it.id]?.revenueGrowth as number) ?? null, fmt: (it) => frac(stats[it.id]?.revenueGrowth) },
		{ key: 'div', ru: 'Дивиденды', en: 'Dividend', get: (it) => (stats[it.id]?.dividendYield as number) ?? null, fmt: (it) => frac(stats[it.id]?.dividendYield, 1) },
		{ key: 'cap', ru: 'Капитализация', en: 'Market cap', get: (it) => it.capUsd, fmt: (it) => cap(it.capUsd) }
	];
	const sorted = $derived.by(() => {
		const col = COLS.find((c) => c.key === sortKey);
		if (!items || !col) return items ?? [];
		return [...items].sort((a, b) => {
			const x = col.get(a);
			const y = col.get(b);
			if (x === null && y === null) return 0;
			if (x === null) return 1;
			if (y === null) return -1;
			return sortDesc ? y - x : x - y;
		});
	});
	function sortBy(k: string) {
		if (sortKey === k) sortDesc = !sortDesc;
		else (sortKey = k), (sortDesc = true);
	}

	// the map
	const SECTOR_KEYS = Object.keys(SECTORS);
	const itemOf = (id: number) => items?.find((x) => x.id === id);
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

<svelte:head><title>{tx('Отмеченные', 'Picked')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Отмеченные', 'Picked')} help="shortlist.screen" back={{ href: '/more', label: tx('Ещё', 'More') }} />
<ScreenSwitch />
<RecentCards />

{#if items === null}
	<div class="skeleton"></div>
{:else if !items.length}
	<p class="muted">{tx('Пока ничего не отмечено. Кандидат модели, открытый из модели, отмечается сам; любую бумагу можно отметить ☆ в её карточке.', 'Nothing picked yet. A model\'s candidate opened from the model is picked by that; any security — with ☆ on its card.')}</p>
{:else}
	<Fold key="short-list" title={tx(`Отмеченные · ${items.length}`, `Picked · ${items.length}`)} summary={items.map((x) => x.symbol).join(' · ')}>
		{#snippet aside()}<HelpIcon topicKey="shortlist.screen" label={tx('отмеченные', 'picked')} />{/snippet}
		<ul class="list">
			{#each items as it (it.id)}
				<li>
					<a class="row" href="/security/{it.id}">
						<span class="who"><b>{it.symbol}</b><ScoreDot id={it.id} /> <span class="muted small">{it.name}</span><span class="muted small block">{it.sector ? sectorName(it.sector, tx) : ''}{it.origin ? ` · ${it.origin}` : ''}</span></span>
						<span class="vals"><b>{price(it)}</b><span class="small" class:up={(it.dayPct ?? 0) > 0} class:down={(it.dayPct ?? 0) < 0}>{pct(it.dayPct)}</span></span>
					</a>
					<span class="side"><TvLink exchange={it.exchange} symbol={it.symbol} /><button class="unpick" aria-label={tx('Снять отметку', 'Unpick')} onclick={() => unpick(it.id)}>★</button></span>
				</li>
			{/each}
		</ul>
	</Fold>

	<Fold key="short-compare" title={tx('Сравнение', 'Comparison')} summary={tx('доходность, оценка, риск, качество', 'return, valuation, risk, quality')}>
		{#snippet aside()}<HelpIcon topicKey="security.stats" label={tx('показатели', 'ratios')} />{/snippet}
		<div class="scroll">
			<table class="cmp">
				<thead>
					<tr>
						<th></th>
						{#each COLS as col (col.key)}<th><button class:on={sortKey === col.key} onclick={() => sortBy(col.key)}>{tx(col.ru, col.en)}{sortKey === col.key ? (sortDesc ? ' ↓' : ' ↑') : ''}</button></th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each sorted as it (it.id)}
						<tr>
							<th><a href="/security/{it.id}">{it.symbol}</a></th>
							{#each COLS as col (col.key)}<td class:sel={sortKey === col.key}>{col.fmt(it)}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small">{tx('Тап по заголовку — сортировка. Для бумаг TASE оценочные коэффициенты скрыты (Yahoo смешивает агороты и доллары).', 'Tap a header to sort. For TASE securities the price ratios are hidden (Yahoo mixes agorot and dollars).')}</p>
	</Fold>

	{#if map}
		<Fold key="short-map" title={tx('Карта связей', 'Map of ties')} summary={tx(`${map.links.length} сильных связей`, `${map.links.length} strong ties`)}>
			{#snippet aside()}<HelpIcon topicKey="portfolio.risk_map" label={tx('карта связей', 'map of ties')} />{/snippet}
			<svg class="map" viewBox="0 0 100 100" role="img" aria-label={tx('Карта связей отмеченных', 'Map of ties of the picked')}>
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
				<p class="small">{tx('Сильнее всего связана', 'Most tied')} <b>{itemOf(selected)?.symbol}</b>: {#each neighbours as x, k (x.id)}{k ? ' · ' : ''}{itemOf(x.id)?.symbol} {num(x.c, 2)}{/each}</p>
			{:else}
				<p class="muted small">{tx('Близко — движутся вместе (недельные доходности за 2 года, в долларах); линия — связь выше 0,7. Тап по кругу — его самые связанные соседи.', 'Close — they move together (weekly returns over 2 years, in dollars); a line — a tie above 0.7. Tap a circle — its most tied neighbours.')}{#if map.weeks.some((w) => w < 52)} {tx('* — меньше года истории.', '* — under a year of history.')}{/if}</p>
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
		</Fold>
	{/if}
{/if}

<style>
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.block {
		display: block;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: var(--s2);
		border-bottom: 1px solid var(--line);
	}
	.row {
		flex: 1;
		display: flex;
		justify-content: space-between;
		gap: var(--s2);
		padding: var(--s2) 0;
		color: var(--text);
		text-decoration: none;
		min-width: 0;
	}
	.who {
		min-width: 0;
	}
	.vals {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.side {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.unpick {
		border: none;
		background: none;
		font-size: 1.2rem;
		color: var(--warn-text, #b8860b);
		cursor: pointer;
	}
	.scroll {
		overflow-x: auto;
	}
	.cmp {
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.cmp th,
	.cmp td {
		padding: 5px 6px;
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	.cmp th:first-child {
		text-align: left;
		position: sticky;
		left: 0;
		background: var(--surface);
	}
	.cmp th button {
		border: none;
		background: none;
		padding: 0;
		color: var(--link);
		font: inherit;
		cursor: pointer;
	}
	.cmp th button.on {
		color: var(--text);
		font-weight: 700;
	}
	.cmp td.sel {
		font-weight: 600;
	}
	.cmp a {
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
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
