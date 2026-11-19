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
	import { onMount } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import HelpIcon from './HelpIcon.svelte';

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
	}
	let { onselect, includeInactive = false, noIndex = false, label = tx('Тикер', 'Ticker'), autofocus = false, withManual = false }: Props = $props();

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
		} catch {
			/* ignore */
		}
	});

	const query = $derived(q.trim());
	const shown = $derived(query.length >= 2 ? items : recent.filter((s) => market === 'all' || (market === 'il') === (s.exchangeCode === 'TASE')));

	async function search() {
		const my = ++seq;
		if (query.length < 2) {
			items = [];
			loading = false;
			return;
		}
		loading = true;
		try {
			const p = new URLSearchParams({ q: query, market });
			if (includeInactive) p.set('inactive', '1');
			if (noIndex) p.set('noindex', '1');
			if (withManual) p.set('manual', '1');
			const r = await fetch(`/api/securities?${p}`);
			if (!r.ok) throw new Error();
			const j = await r.json();
			if (my !== seq) return;
			items = j.items;
			active = items.length ? 0 : -1;
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
	const kind = (s: Security) => (s.type === 'etf' ? 'ETF' : s.type === 'index' ? tx('индекс', 'index') : '');
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

	{#if error}
		<p class="note">{error}</p>
	{:else if query.length >= 2 && loading && !items.length}
		<div class="skeleton"></div>
		<div class="skeleton"></div>
	{:else if query.length >= 2 && !items.length}
		<p class="note">{tx('Ничего не нашлось. В базе только акции и ETF бирж США и TASE; ручной ввод тикера не предусмотрен.', 'Nothing found. The base holds only stocks and ETFs of US exchanges and TASE; a ticker cannot be typed by hand.')}</p>
	{:else if query.length > 0 && query.length < 2}
		<p class="note">{tx('Ещё один символ — поиск начинается со второго.', 'One more character — search starts from the second.')}</p>
	{/if}

	{#if shown.length}
		{#if query.length < 2}<p class="caption">{tx('Недавние', 'Recent')}</p>{/if}
		<ul id="{inputId}-list" role="listbox" aria-label={tx('Бумаги', 'Securities')}>
			{#each shown as s, i (s.id)}
				<li role="option" aria-selected={i === active} class:active={i === active}>
					<button onclick={() => choose(s)}>
						<span class="sym">{s.symbol}</span>
						<span class="name">
							— {s.nameEn}{#if s.nameHe}&nbsp;<bdi class="he" lang="he">{s.nameHe}</bdi>{/if}
						</span>
						<span class="meta"
							>{[s.exchangeName, unit(s), kind(s)].filter(Boolean).join(' · ')}{#if !s.active}&nbsp;· {tx('нет в списках', 'delisted')}{/if}</span
						>
					</button>
				</li>
			{/each}
		</ul>
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
