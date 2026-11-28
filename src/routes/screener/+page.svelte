<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import TopBar from '#lib/TopBar.svelte';
	import ScreenSwitch from '#lib/ScreenSwitch.svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import ScoreDot from '#lib/ScoreDot.svelte';
	import StarToggle from '#lib/StarToggle.svelte';
	import SortHead from '#lib/SortHead.svelte';
	import { TableSort } from '#lib/tablesort.svelte.js';
	import { SECTORS, sectorName } from '#lib/allocation.js';
	import { showToast } from '#lib/toast.svelte.js';
	import { loc, tx } from '#lib/i18n.js';

	/**
	 * Owner 28.11.2026: «полнофункциональный поисковик по различным аспектам» — the screener: the shares of both markets
	 * by size, valuation, dividends, growth, quality, risk, return, liquidity, the quant score and the trend; ready
	 * presets, the owner's saved screens, the results sorted by any column; the results as a set (chart, map, risk…).
	 */
	type Range = { min: string; max: string };
	type F = {
		market: '' | 'US' | 'IL';
		sector: string;
		industry: string;
		caps: string[];
		colors: string[];
		trendUp: boolean;
		liquid: boolean;
		pe: Range;
		ps: Range;
		div: Range;
		growth: Range;
		roe: Range;
		margin: Range;
		debt: Range;
		beta: Range;
		y1: Range;
		m3: Range;
	};
	const r = (min = '', max = ''): Range => ({ min, max });
	const empty = (): F => ({ market: '', sector: '', industry: '', caps: [], colors: [], trendUp: false, liquid: false, pe: r(), ps: r(), div: r(), growth: r(), roe: r(), margin: r(), debt: r(), beta: r(), y1: r(), m3: r() });
	const PRESETS: [string, string, string, () => F][] = [
		['green', 'Зелёные в тренде', 'Green in a trend', () => ({ ...empty(), colors: ['green'], trendUp: true, liquid: true })],
		['div', 'Дивидендные', 'Dividend', () => ({ ...empty(), div: r('3'), pe: r('', '25'), liquid: true })],
		['value', 'Дешёвые и качественные', 'Cheap and sound', () => ({ ...empty(), pe: r('', '15'), roe: r('15'), debt: r('', '100'), liquid: true })],
		['growth', 'Быстрый рост', 'Fast growth', () => ({ ...empty(), growth: r('20'), y1: r('0'), liquid: true })],
		['calm', 'Спокойные крупные', 'Calm and big', () => ({ ...empty(), beta: r('', '0.8'), caps: ['large', 'mega'], liquid: true })]
	];
	const CAPS: [string, string, string][] = [
		['micro', 'до 300 млн', '< 300M'],
		['small', '300 млн – 2 млрд', '300M – 2B'],
		['mid', '2 – 10 млрд', '2 – 10B'],
		['large', '10 – 200 млрд', '10 – 200B'],
		['mega', 'от 200 млрд', '200B +']
	];
	const RANGES: [keyof F, string, string, string][] = [
		['pe', 'P/E', 'P/E', ''],
		['ps', 'P/S', 'P/S', ''],
		['div', 'Дивиденды (DY), %', 'Dividends (DY), %', ''],
		['growth', 'Рост выручки (Rev YoY), %', 'Revenue growth (YoY), %', ''],
		['roe', 'ROE, %', 'ROE, %', ''],
		['margin', 'Чистая маржа (NPM), %', 'Net margin (NPM), %', ''],
		['debt', 'Долг / капитал (D/E), %', 'Debt / equity (D/E), %', ''],
		['beta', 'Бета (β)', 'Beta (β)', ''],
		['y1', 'За 1 год, %', '1 year, %', ''],
		['m3', 'За 3 мес., %', '3 months, %', '']
	];
	const KEY = 'screener-form';

	let f = $state<F>(empty());
	let total = $state<number | null>(null);
	let ms = $state(0);
	type Row = { id: number; symbol: string; name: string; sector: string | null; industry: string | null; cap: number | null; pe: number | null; ps: number | null; div: number | null; growth: number | null; roe: number | null; beta: number | null; y1: number | null; m3: number | null; turnover: number | null };
	let rows = $state<Row[]>([]);
	let busy = $state(false);
	let industries = $state<{ name: string; sector: string; market: string; count: number }[]>([]);
	let saved = $state<{ name: string; filters: unknown }[]>([]);
	let saving = $state(false);
	let saveName = $state('');
	const sort = new TableSort<string>('cap');

	const toServer = (x: F) => {
		const rg = (v: Range) => ({ min: v.min === '' ? null : Number(v.min.replace(',', '.')), max: v.max === '' ? null : Number(v.max.replace(',', '.')) });
		return { market: x.market || null, sector: x.sector || null, industry: x.industry || null, caps: x.caps, colors: x.colors, trendUp: x.trendUp, turnover: x.liquid ? 1e6 : null, pe: rg(x.pe), ps: rg(x.ps), div: rg(x.div), growth: rg(x.growth), roe: rg(x.roe), margin: rg(x.margin), debt: rg(x.debt), beta: rg(x.beta), y1: rg(x.y1), m3: rg(x.m3) };
	};
	const fromServer = (o: Record<string, unknown>): F => {
		const g = (k: string): Range => {
			const v = (o[k] ?? {}) as { min?: number | null; max?: number | null };
			return { min: v.min == null ? '' : String(v.min), max: v.max == null ? '' : String(v.max) };
		};
		return { market: (o.market as F['market']) ?? '', sector: (o.sector as string) ?? '', industry: (o.industry as string) ?? '', caps: (o.caps as string[]) ?? [], colors: (o.colors as string[]) ?? [], trendUp: !!o.trendUp, liquid: Number(o.turnover) > 0, pe: g('pe'), ps: g('ps'), div: g('div'), growth: g('growth'), roe: g('roe'), margin: g('margin'), debt: g('debt'), beta: g('beta'), y1: g('y1'), m3: g('m3') };
	};

	let seq = 0;
	async function run(append = false) {
		const my = ++seq;
		busy = true;
		const p = new URLSearchParams({ f: JSON.stringify(toServer(f)), sort: sort.key ?? 'cap', dir: sort.key === null || sort.desc ? 'desc' : 'asc', offset: String(append ? rows.length : 0) });
		const j = await fetch(`/api/screener?${p}`).then((x) => x.json()).catch(() => null);
		if (my !== seq) return;
		busy = false;
		if (!j) return showToast(tx('Скринер не ответил', 'The screener did not answer'));
		total = j.total;
		ms = j.ms;
		rows = append ? [...rows, ...j.items] : j.items;
	}
	let timer: ReturnType<typeof setTimeout>;
	function changed() {
		try {
			localStorage.setItem(KEY, JSON.stringify(f));
		} catch {
			/* ignore */
		}
		clearTimeout(timer);
		timer = setTimeout(() => run(), 350);
	}
	$effect(() => {
		void sort.key;
		void sort.desc;
		changed();
	});
	onMount(() => {
		try {
			const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
			if (v) f = { ...empty(), ...v };
		} catch {
			/* ignore */
		}
		void fetch('/api/sectors/catalog').then((x) => x.json()).then((j) => (industries = j.industries ?? [])).catch(() => {});
		void fetch('/api/screener/saved').then((x) => x.json()).then((j) => (saved = j.items ?? [])).catch(() => {});
		run();
	});
	const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
	const indList = $derived(industries.filter((i) => (!f.sector || i.sector === f.sector) && (!f.market || i.market === f.market)).sort((a, b) => a.name.localeCompare(b.name)));
	const activeCount = $derived(
		[f.market, f.sector, f.industry, f.caps.length, f.colors.length, f.trendUp, f.liquid, ...RANGES.map(([k]) => (f[k] as Range).min !== '' || (f[k] as Range).max !== '')].filter(Boolean).length
	);

	async function saveScreen() {
		const j = await fetch('/api/screener/saved', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: saveName, filters: toServer(f) }) }).then((x) => x.json()).catch(() => null);
		if (!j?.items) return showToast(tx('Не сохранилось', 'Not saved'));
		saved = j.items;
		saving = false;
		showToast(tx('Фильтр сохранён', 'Screen saved'));
	}
	async function dropScreen(name: string) {
		const j = await fetch(`/api/screener/saved?name=${encodeURIComponent(name)}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => null);
		if (j?.items) saved = j.items;
	}
	/** the results as a set: the first one main, the next up to 12 added */
	async function asSet() {
		if (!rows.length) return;
		const ids = rows.slice(0, 13).map((x) => x.id);
		const name = tx(`Скринер: ${rows.slice(0, 4).map((x) => x.symbol).join(' — ')}${rows.length > 4 ? '…' : ''}`, `Screener: ${rows.slice(0, 4).map((x) => x.symbol).join(' — ')}${rows.length > 4 ? '…' : ''}`);
		const r = await fetch('/api/charts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, securityId: ids[0], config: { period: '1Y', peers: ids.slice(1), shown: ids.slice(1, 9), sma: [], highlight: null } }) }).then((x) => x.json()).catch(() => null);
		if (r?.id) goto(`/charts/${r.id}?view=compare`);
	}

	const n = (x: number | null, d = 1) => (x === null ? '—' : x.toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d }));
	const p = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : ''}${n(x)}%`);
	const cap = (x: number | null) => (!x ? '—' : x >= 1e12 ? `${n(x / 1e12)} ${tx('трлн', 'T')}` : x >= 1e9 ? `${Math.round(x / 1e9)} ${tx('млрд', 'B')}` : `${Math.round(x / 1e6)} ${tx('млн', 'M')}`);
</script>

<svelte:head><title>{tx('Скринер', 'Screener')}</title></svelte:head>
<TopBar title={tx('Скринер', 'Screener')} help="screener.screen" back={{ href: '/more', label: tx('Ещё', 'More') }} />
<ScreenSwitch />

<div class="chips presets" role="group" aria-label={tx('Готовые фильтры', 'Ready screens')}>
	{#each PRESETS as [k, ru, en, make] (k)}
		<button onclick={() => ((f = make()), changed())}>{tx(ru, en)}</button>
	{/each}
	{#each saved as s (s.name)}
		<span class="mine"><button onclick={() => ((f = fromServer(s.filters as Record<string, unknown>)), changed())}>★ {s.name}</button><button class="x" aria-label={tx(`Удалить ${s.name}`, `Delete ${s.name}`)} onclick={() => dropScreen(s.name)}>×</button></span>
	{/each}
</div>

<Fold key="screener-filters" open={false} title={tx(`Фильтры${activeCount ? ` · ${activeCount}` : ''}`, `Filters${activeCount ? ` · ${activeCount}` : ''}`)} summary={activeCount ? tx('тап — открыть и поправить', 'tap — open and adjust') : tx('все акции — тап, чтобы сузить', 'all shares — tap to narrow')} remind="screener.screen">
	{#snippet aside()}<HelpIcon topicKey="screener.screen" label={tx('скринер', 'screener')} />{/snippet}
	<div class="chips">
		{#each [['', 'Все рынки', 'All markets'], ['US', 'США', 'US'], ['IL', 'Израиль', 'Israel']] as [k, ru, en] (k)}
			<button class:on={f.market === k} aria-pressed={f.market === k} onclick={() => ((f.market = k as F['market']), (f.industry = ''), changed())}>{tx(ru, en)}</button>
		{/each}
	</div>
	<div class="row2">
		<label>{tx('Сектор', 'Sector')}
			<select bind:value={f.sector} onchange={() => ((f.industry = ''), changed())}>
				<option value="">{tx('Все', 'All')}</option>
				{#each Object.keys(SECTORS) as k (k)}<option value={k}>{sectorName(k, tx)}</option>{/each}
			</select>
		</label>
		<label>{tx('Отрасль', 'Industry')}
			<select bind:value={f.industry} onchange={changed}>
				<option value="">{tx('Все', 'All')}</option>
				{#each indList as i (`${i.market}|${i.name}`)}<option value={i.name}>{i.name} ({i.count})</option>{/each}
			</select>
		</label>
	</div>
	<p class="lbl">{tx('Размер (капитализация)', 'Size (market cap)')}</p>
	<div class="chips">
		{#each CAPS as [k, ru, en] (k)}<button class:on={f.caps.includes(k)} aria-pressed={f.caps.includes(k)} onclick={() => ((f.caps = toggle(f.caps, k)), changed())}>{tx(ru, en)}</button>{/each}
	</div>
	<p class="lbl">{tx('Квант-оценка и тренд', 'Quant score and trend')}</p>
	<div class="chips">
		{#each [['green', 'зелёная', 'green'], ['yellow', 'жёлтая', 'yellow'], ['red', 'красная', 'red']] as [k, ru, en] (k)}<button class:on={f.colors.includes(k)} aria-pressed={f.colors.includes(k)} onclick={() => ((f.colors = toggle(f.colors, k)), changed())}><i class="dot {k}"></i>{tx(ru, en)}</button>{/each}
		<button class:on={f.trendUp} aria-pressed={f.trendUp} onclick={() => ((f.trendUp = !f.trendUp), changed())}>{tx('выше SMA200', 'above SMA200')}</button>
		<button class:on={f.liquid} aria-pressed={f.liquid} onclick={() => ((f.liquid = !f.liquid), changed())}>{tx('ликвидные (от 1 млн $ в день)', 'liquid ($1M+ a day)')}</button>
	</div>
	<div class="ranges">
		{#each RANGES as [k, ru, en] (k)}
			{@const v = f[k] as Range}
			<label class="rg">
				<span>{tx(ru, en)}</span>
				<span class="mm">
					<input inputmode="decimal" placeholder={tx('от', 'min')} bind:value={v.min} oninput={changed} aria-label={`${tx(ru, en)} ${tx('от', 'min')}`} />
					<input inputmode="decimal" placeholder={tx('до', 'max')} bind:value={v.max} oninput={changed} aria-label={`${tx(ru, en)} ${tx('до', 'max')}`} />
				</span>
			</label>
		{/each}
	</div>
	<div class="acts">
		<button class="ghost" onclick={() => ((f = empty()), changed())}>{tx('Сбросить', 'Reset')}</button>
		{#if saving}
			<input class="nm" bind:value={saveName} placeholder={tx('Название фильтра', 'The screen\'s name')} />
			<button class="primary" disabled={!saveName.trim()} onclick={saveScreen}>{tx('Сохранить', 'Save')}</button>
			<button class="ghost" onclick={() => (saving = false)}>{tx('Отмена', 'Cancel')}</button>
		{:else}
			<button class="ghost" onclick={() => ((saveName = ''), (saving = true))}>★ {tx('Сохранить фильтр', 'Save the screen')}</button>
		{/if}
	</div>
</Fold>

<div class="found">
	<b>{total === null ? '…' : tx(`Найдено: ${total}`, `Found: ${total}`)}</b>
	{#if busy}<span class="muted small">{tx('ищу…', 'searching…')}</span>{:else if total !== null}<span class="muted small">{ms} {tx('мс', 'ms')}</span>{/if}
	{#if rows.length > 1}<button class="link" onclick={asSet}>{tx('Как набор: график · карта · риск →', 'As a set: chart · map · risk →')}</button>{/if}
</div>

{#if rows.length}
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th><SortHead s={sort} k="symbol" desc={false}>{tx('Бумага', 'Security')}</SortHead></th>
					<th><SortHead s={sort} k="cap">{tx('Кап.', 'Cap')}</SortHead></th>
					<th><SortHead s={sort} k="score">{tx('Квант', 'Quant')}</SortHead></th>
					<th><SortHead s={sort} k="pe" desc={false}>P/E</SortHead></th>
					<th><SortHead s={sort} k="ps" desc={false}>P/S</SortHead></th>
					<th><SortHead s={sort} k="div">DY</SortHead></th>
					<th><SortHead s={sort} k="growth">{tx('Рост', 'Growth')}</SortHead></th>
					<th><SortHead s={sort} k="roe">ROE</SortHead></th>
					<th><SortHead s={sort} k="beta" desc={false}>β</SortHead></th>
					<th><SortHead s={sort} k="y1">1{tx('Г', 'Y')}</SortHead></th>
					<th><SortHead s={sort} k="m3">3{tx('М', 'M')}</SortHead></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as x (x.id)}
					<tr>
						<th><span class="who"><StarToggle id={x.id} symbol={x.symbol} origin="скринер" /><a href="/security/{x.id}" title={x.name}>{x.symbol}</a></span><span class="sub">{x.industry ?? (x.sector ? sectorName(x.sector, tx) : '')}</span></th>
						<td>{cap(x.cap)}</td>
						<td><ScoreDot id={x.id} /></td>
						<td>{n(x.pe)}</td>
						<td>{n(x.ps)}</td>
						<td>{x.div === null ? '—' : `${n(x.div)}%`}</td>
						<td class:up={(x.growth ?? 0) > 0} class:down={(x.growth ?? 0) < 0}>{p(x.growth)}</td>
						<td>{x.roe === null ? '—' : `${n(x.roe, 0)}%`}</td>
						<td>{n(x.beta, 2)}</td>
						<td class:up={(x.y1 ?? 0) > 0} class:down={(x.y1 ?? 0) < 0}>{p(x.y1)}</td>
						<td class:up={(x.m3 ?? 0) > 0} class:down={(x.m3 ?? 0) < 0}>{p(x.m3)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if total !== null && rows.length < total}<button class="more" disabled={busy} onclick={() => run(true)}>{tx(`Показать ещё — осталось ${total - rows.length}`, `Show more — ${total - rows.length} left`)}</button>{/if}
{:else if total === 0}
	<p class="muted">{tx('Под эти фильтры ничего не подошло — ослабь один из них.', 'Nothing fits these filters — loosen one of them.')}</p>
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: var(--s2);
	}
	.presets {
		flex-wrap: nowrap;
		overflow-x: auto;
		padding-bottom: 4px;
	}
	.chips button {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-xs);
		white-space: nowrap;
		cursor: pointer;
	}
	.chips button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.mine {
		display: inline-flex;
		flex: none;
	}
	.mine .x {
		border: none;
		background: none;
		padding: 0 6px;
		color: var(--muted);
	}
	.dot {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 50%;
	}
	.dot.green {
		background: var(--up);
	}
	.dot.yellow {
		background: #d9a400;
	}
	.dot.red {
		background: var(--down);
	}
	.lbl {
		margin: var(--s2) 0 4px;
		font-size: var(--fs-xs);
		color: var(--muted);
		font-weight: 600;
	}
	.row2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s2);
	}
	.row2 label,
	.rg {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--fs-xs);
		color: var(--muted);
		min-width: 0;
	}
	select,
	input {
		min-height: 36px;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 6px;
		box-sizing: border-box;
	}
	.ranges {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--s2) var(--s3);
		margin-top: var(--s2);
	}
	.mm {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: var(--s3);
	}
	.acts .nm {
		flex: 1;
	}
	.ghost,
	.primary,
	.more {
		min-height: 36px;
		padding: 0 12px;
		border-radius: var(--r2);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.ghost,
	.more {
		border: 1px solid var(--line);
		background: none;
		color: var(--text);
	}
	.more {
		width: 100%;
		margin-top: var(--s2);
	}
	.primary {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.found {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--s2);
		margin: var(--s3) 0 var(--s2);
	}
	.link {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--link);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 5px 6px;
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	thead th {
		color: var(--muted);
		font-weight: 600;
	}
	tbody th,
	thead th:first-child {
		text-align: left;
		position: sticky;
		left: 0;
		background: var(--surface);
		z-index: 1;
	}
	.who {
		display: flex;
		align-items: center;
	}
	.who a {
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
	}
	.sub {
		display: block;
		max-width: 9em;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 400;
		color: var(--muted);
		font-size: 10px;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
</style>
