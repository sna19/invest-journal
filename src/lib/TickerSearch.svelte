<script lang="ts" module>
	import { tx } from '#lib/i18n.js';
	export interface Security {
		id: number;
		symbol: string;
		nameEn: string;
		nameHe: string | null;
		exchangeCode: string;
		exchangeName: string;
		type: string;
		currency: string;
		priceUnit: string;
		active: boolean;
		sector?: string | null;
		capUsd?: number | null;
	}
	type Market = 'all' | 'us' | 'il';

	const RECENT_KEY = 'ticker-recent';
	const MARKET_KEY = 'ticker-market';

	function readRecent(): Security[] {
		try {
			const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
			return Array.isArray(v) ? v.slice(0, 10) : [];
		} catch {
			return [];
		}
	}

	/** The last ten chosen securities (spec section 4), on this device. */
	export function rememberSecurity(s: Security) {
		try {
			const list = [s, ...readRecent().filter((x) => x.id !== s.id)].slice(0, 10);
			localStorage.setItem(RECENT_KEY, JSON.stringify(list));
		} catch {
			/* private mode: no history */
		}
	}
</script>

<script lang="ts">
	import ScoreDot from './ScoreDot.svelte';
	import { onMount } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import HelpIcon from './HelpIcon.svelte';
	import { SECTORS, sectorName } from './allocation.js';

	/**
	 * Spec section 4 — the ticker is always chosen from the local base: autocomplete from the second
	 * character by symbol and English or Hebrew name; filter US / Israel / all; the last ten on top.
	 */
	interface Props {
		onselect?: (s: Security) => void;
		/** also show securities gone from the lists (the «Тикеры» screen) */
		includeInactive?: boolean;
		/** hide indices (benchmarks): a hypothesis is about a stock or an ETF */
		noIndex?: boolean;
		label?: string;
		autofocus?: boolean;
		/** also securities added by hand for a portfolio (ETF UCITS) */
		withManual?: boolean;
		/** the filters by kind and sector, and the list without a query (the «Тикеры» screen) */
		filters?: boolean;
	}
	let { onselect, includeInactive = false, noIndex = false, label = tx('Тикер', 'Ticker'), autofocus = false, withManual = false, filters = false }: Props = $props();

	type Kind = '' | 'stock' | 'etf' | 'commodity';
	const FILTER_KEY = 'ticker-filter';
	const PAGE = 50;
	let kind = $state<Kind>('');
	let sector = $state('');
	let more = $state(false);
	// sectors and industries found by name (the «Тикеры» screen)
	let secHits = $state<{ sectors: { key: string }[]; industries: { name: string; sector: string | null; n: number }[] } | null>(null);

	let q = $state('');
	let market = $state<Market>('all');
	let items = $state<Security[]>([]);
	let recent = $state<Security[]>([]);
	let loading = $state(false);
	let error = $state<string | undefined>();
	let active = $state(-1);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;
	const inputId = `ticker-${Math.random().toString(36).slice(2)}`;

	onMount(() => {
		recent = readRecent();
		try {
			const m = localStorage.getItem(MARKET_KEY);
			if (m === 'us' || m === 'il' || m === 'all') market = m;
			if (filters) {
				const f = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}');
				if (['stock', 'etf', 'commodity'].includes(f.kind)) kind = f.kind;
				if (typeof f.sector === 'string' && f.sector in SECTORS) sector = f.sector;
			}
		} catch {
			/* ignore */
		}
		if (filters && (kind || sector)) search();
	});

	function setFilter(k: Kind, sec: string) {
		kind = k;
		sector = k === 'stock' || k === '' ? sec : '';
		try {
			localStorage.setItem(FILTER_KEY, JSON.stringify({ kind, sector }));
		} catch {
			/* ignore */
		}
		search();
	}

	const query = $derived(q.trim());
	const browsing = $derived(filters && q.trim().length < 2 && !!(kind || sector));
	const shown = $derived(query.length >= 2 || browsing ? items : recent.filter((s) => market === 'all' || (market === 'il') === (s.exchangeCode === 'TASE')));

	async function search(append = false) {
		const my = ++seq;
		if (query.length < 2 && !browsing) {
			items = [];
			more = false;
			loading = false;
			return;
		}
		loading = true;
		try {
			const p = new URLSearchParams({ q: query, market });
			if (filters) {
				if (kind) p.set('kind', kind);
				if (sector) p.set('sector', sector);
				p.set('limit', String(PAGE));
				if (append) p.set('offset', String(items.length));
				if (query.length >= 2) p.set('sectors', '1');
			}
			if (includeInactive) p.set('inactive', '1');
			if (noIndex) p.set('noindex', '1');
			if (withManual) p.set('manual', '1');
			const r = await fetch(`/api/securities?${p}`);
			if (!r.ok) throw new Error();
			const j = await r.json();
			if (my !== seq) return;
			items = append ? [...items, ...j.items] : j.items;
			if (!append) secHits = j.sectors ?? null;
			more = filters && j.items.length === PAGE;
			if (!append) active = items.length ? 0 : -1;
			error = undefined;
		} catch {
			if (my === seq) error = tx('Поиск не ответил — проверьте связь.', 'Search did not answer — check the connection.');
		} finally {
			if (my === seq) loading = false;
		}
	}

	function input() {
		clearTimeout(timer);
		timer = setTimeout(search, 120);
	}

	function setMarket(m: Market) {
		market = m;
		try {
			localStorage.setItem(MARKET_KEY, m);
		} catch {
			/* ignore */
		}
		search();
	}

	function choose(s: Security) {
		rememberSecurity(s);
		recent = readRecent();
		onselect?.(s);
	}

	function key(e: KeyboardEvent) {
		if (!shown.length) return;
		if (e.key === 'ArrowDown') active = (active + 1) % shown.length;
		else if (e.key === 'ArrowUp') active = (active - 1 + shown.length) % shown.length;
		else if (e.key === 'Enter' && active >= 0) choose(shown[active]);
		else return;
		e.preventDefault();
	}

	const unit = (s: Security) => (s.priceUnit === 'ILA' ? tx('агорот', 'agorot') : s.currency);
	const typeOf = (s: Security) => (s.type === 'etf' ? 'ETF' : s.type === 'index' ? tx('индекс', 'index') : '');
	const capText = (x: number | null | undefined) =>
		!x ? '' : x >= 1e12 ? `${(x / 1e12).toFixed(1)} ${tx('трлн $', 'T $')}` : x >= 1e9 ? `${Math.round(x / 1e9)} ${tx('млрд $', 'B $')}` : `${Math.round(x / 1e6)} ${tx('млн $', 'M $')}`;
	const KINDS: [Kind, string, string][] = [
		['', 'Все типы', 'All types'],
		['stock', 'Акции', 'Stocks'],
		['etf', 'ETF', 'ETF'],
		['commodity', 'Сырьевые фонды', 'Commodities']
	];
</script>

<div class="ticker">
	<div class="label-row">
		<label for={inputId}>{label}</label>
		<HelpIcon topicKey="ticker.search" label={tx('поиск тикера', 'ticker search')} />
	</div>
	<div class="field">
		<Search size={18} />
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id={inputId}
			type="search"
			role="combobox"
			aria-expanded={shown.length > 0}
			aria-controls="{inputId}-list"
			aria-autocomplete="list"
			autocomplete="off"
			autocapitalize="characters"
			spellcheck="false"
			placeholder={tx('AMAT, Teva или לאומי', 'AMAT, Teva or לאומי')}
			{autofocus}
			bind:value={q}
			oninput={input}
			onkeydown={key}
		/>
	</div>
	<div class="markets" role="radiogroup" aria-label={tx('Рынок', 'Market')}>
		{#each [['all', tx('Все', 'All')], ['us', tx('США', 'US')], ['il', tx('Израиль', 'Israel')]] as [m, t] (m)}
			<button role="radio" aria-checked={market === m} class:on={market === m} onclick={() => setMarket(m as Market)}>{t}</button>
		{/each}
	</div>

	{#if filters}
		<div class="markets kinds" role="radiogroup" aria-label={tx('Тип бумаги', 'Security type')}>
			{#each KINDS as [k, ru, en] (k)}
				<button role="radio" aria-checked={kind === k} class:on={kind === k} onclick={() => setFilter(k, sector)}>{tx(ru, en)}</button>
			{/each}
		</div>
		{#if kind === '' || kind === 'stock'}
			<div class="sectors" role="radiogroup" aria-label={tx('Сектор', 'Sector')}>
				<button role="radio" aria-checked={!sector} class:on={!sector} onclick={() => setFilter(kind, '')}>{tx('Все секторы', 'All sectors')}</button>
				{#each Object.keys(SECTORS) as k (k)}
					<button role="radio" aria-checked={sector === k} class:on={sector === k} onclick={() => setFilter(kind, k)}>{sectorName(k, tx)}</button>
				{/each}
			</div>
		{/if}
	{/if}

	{#if error}
		<p class="note">{error}</p>
	{:else if browsing && loading && !items.length}
		<div class="skeleton"></div>
		<div class="skeleton"></div>
	{:else if browsing && !items.length}
		<p class="note">{tx('Под этот фильтр ничего не нашлось.', 'Nothing matches this filter.')}</p>
	{:else if query.length >= 2 && loading && !items.length}
		<div class="skeleton"></div>
		<div class="skeleton"></div>
	{:else if query.length >= 2 && !items.length}
		<p class="note">{tx('Ничего не нашлось. В базе только акции и ETF бирж США и TASE; ручной ввод тикера не предусмотрен.', 'Nothing found. The base holds only stocks and ETFs of US exchanges and TASE; a ticker cannot be typed by hand.')}</p>
	{:else if query.length > 0 && query.length < 2}
		<p class="note">{tx('Ещё один символ — поиск начинается со второго.', 'One more character — search starts from the second.')}</p>
	{/if}

	{#if filters && query.length >= 2 && secHits && (secHits.sectors.length || secHits.industries.length)}
		<p class="caption">{tx('Секторы и отрасли', 'Sectors and industries')}</p>
		<div class="sechits">
			{#each secHits.sectors as x (x.key)}<a href="/sector?sector={x.key}">{sectorName(x.key, tx)}</a>{/each}
			{#each secHits.industries as x (x.name)}<a href="/sector?{x.sector ? `sector=${x.sector}&` : ''}industry={encodeURIComponent(x.name)}">{x.name} <span>{x.n}</span></a>{/each}
		</div>
	{/if}

	{#if shown.length}
		{#if browsing}<p class="caption">{items.some((s) => s.capUsd) ? tx('По капитализации', 'By market cap') : tx('По алфавиту', 'Alphabetically')}</p>{:else if query.length < 2}<p class="caption">{tx('Недавние', 'Recent')}</p>{/if}
		<ul id="{inputId}-list" role="listbox" aria-label={tx('Бумаги', 'Securities')}>
			{#each shown as s, i (s.id)}
				<li role="option" aria-selected={i === active} class:active={i === active}>
					<button onclick={() => choose(s)}>
						<span class="sym">{s.symbol}</span>{#if s.type === 'stock'}<ScoreDot id={s.id} />{/if}
						<span class="name">
							— {s.nameEn}{#if s.nameHe}&nbsp;<bdi class="he" lang="he">{s.nameHe}</bdi>{/if}
						</span>
						<span class="meta"
							>{[s.exchangeName, unit(s), typeOf(s), s.sector ? sectorName(s.sector, tx) : '', capText(s.capUsd)].filter(Boolean).join(' · ')}{#if !s.active}&nbsp;· {tx('нет в списках', 'delisted')}{/if}</span
						>
					</button>
				</li>
			{/each}
		</ul>
		{#if more}<button class="more" disabled={loading} onclick={() => search(true)}>{loading ? tx('Загружаю…', 'Loading…') : tx('Показать ещё', 'Show more')}</button>{/if}
	{/if}
</div>

<style>
	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-weight: 600;
		margin-bottom: var(--s1);
	}
	.field {
		display: flex;
		align-items: center;
		gap: var(--s2);
		padding: 0 var(--s3);
		min-height: var(--tap);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--muted);
	}
	.field:focus-within {
		border-color: var(--accent);
	}
	input {
		flex: 1;
		min-width: 0;
		min-height: var(--tap);
		border: none;
		outline: none;
		background: none;
		color: var(--text);
	}
	.markets {
		display: flex;
		gap: var(--s2);
		margin: var(--s2) 0;
	}
	.markets button {
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		cursor: pointer;
	}
	.markets button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.kinds {
		margin-top: 0;
		flex-wrap: wrap;
	}
	.kinds button {
		white-space: nowrap;
	}
	.sectors {
		display: flex;
		gap: var(--s2);
		overflow-x: auto;
		padding-bottom: var(--s1);
		margin-bottom: var(--s2);
		scrollbar-width: none;
	}
	.sectors button {
		flex: none;
		min-height: 32px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-xs);
		cursor: pointer;
		white-space: nowrap;
	}
	.sectors button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.more {
		width: 100%;
		min-height: var(--tap);
		margin-top: var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		cursor: pointer;
	}
	.sechits {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 var(--s2);
	}
	.sechits a {
		padding: 4px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
		font-size: var(--fs-xs);
	}
	.sechits a span {
		color: var(--muted);
	}
	.caption {
		margin: var(--s3) 0 var(--s1);
		font-size: var(--fs-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: var(--r2);
		background: var(--surface);
		overflow: hidden;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	li button {
		width: 100%;
		min-height: var(--tap);
		padding: var(--s2) var(--s3);
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: var(--s1);
		text-align: left;
		border: none;
		background: none;
		cursor: pointer;
	}
	li.active button,
	li button:hover {
		background: var(--surface-2);
	}
	.sym {
		font-weight: 700;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		grid-column: 1 / -1;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.note {
		color: var(--muted);
		font-size: var(--fs-s);
	}
	.skeleton {
		height: 44px;
		margin: var(--s1) 0;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
</style>
