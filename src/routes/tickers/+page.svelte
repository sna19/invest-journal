<script lang="ts">
	import { loc, tl, tx } from '#lib/i18n.js';
	import { onDestroy, onMount } from 'svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TopBar from '#lib/TopBar.svelte';
	import Sheet from '#lib/Sheet.svelte';
	import TickerSearch, { type Security } from '#lib/TickerSearch.svelte';

	/** Spec section 9 — «Тикеры»: the base by exchange, when it was updated, the «Обновить» button, search. */
	interface Stats {
		byExchange: { code: string; name: string; country: string; stocks: number; etfs: number; indices: number; inactive: number }[];
		runs: { provider: string; startedAt: string; finishedAt: string | null; status: string; received: number; added: number; updated: number; error: string | null }[];
		updatedAt: string | null;
		running: boolean;
	}

	let stats = $state<Stats | null>(null);
	let problem = $state<string | undefined>();
	let poll: ReturnType<typeof setInterval> | undefined;
	let picked = $state<Security | null>(null);

	async function load() {
		try {
			const r = await fetch('/api/tickers');
			if (!r.ok) throw new Error();
			stats = await r.json();
			problem = undefined;
			if (!stats!.running) stopPoll();
		} catch {
			problem = tx('Нет связи с сервером.', 'No connection to the server.');
		}
	}
	function stopPoll() {
		clearInterval(poll);
		poll = undefined;
	}
	async function refresh() {
		if (stats) stats.running = true;
		await fetch('/api/tickers/refresh', { method: 'POST' }).catch(() => (problem = tx('Нет связи с сервером.', 'No connection to the server.')));
		stopPoll();
		poll = setInterval(load, 2500);
	}

	onMount(() => {
		load().then(() => {
			if (stats?.running) poll = setInterval(load, 2500);
		});
	});
	onDestroy(stopPoll);

	const fmt = $derived(new Intl.NumberFormat(loc()));
	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString(loc(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : tx('ещё не загружалась', 'not loaded yet');
	const groups = $derived(
		stats
			? [
					{ title: tx('США', 'US'), rows: stats.byExchange.filter((e) => e.country === 'US' && e.stocks + e.etfs + e.inactive > 0) },
					{ title: tx('Израиль', 'Israel'), rows: stats.byExchange.filter((e) => e.country === 'IL' && e.stocks + e.etfs + e.inactive > 0) }
				]
			: []
	);
	const total = $derived(stats ? stats.byExchange.reduce((n, e) => n + e.stocks + e.etfs, 0) : 0);
	const PROVIDER: Record<string, string> = { nasdaqtrader: 'США — Nasdaq Trader', tase: 'Израиль — сайт TASE' }; // shown through tl()
	const STATUS: Record<string, string> = { ok: 'загружено', suspicious: 'подозрительно — проверить', error: 'ошибка', running: 'идёт' }; // shown through tl()
	const typeName = (t: string) => (t === 'etf' ? 'ETF' : t === 'index' ? tx('Индекс', 'Index') : tx('Акция', 'Stock'));
</script>

<svelte:head><title>{tx('Тикеры', 'Tickers')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Тикеры', 'Tickers')} help="ticker.db" back={{ href: '/more', label: tx('Ещё', 'More') }}>
	{#snippet actions()}
		<button class="refresh" onclick={refresh} disabled={stats?.running} aria-label={tx('Обновить списки бумаг', 'Refresh the security lists')}>
			<span class:spin={stats?.running}><RefreshCw size={18} /></span>{stats?.running ? tx('Обновляется…', 'Refreshing…') : tx('Обновить', 'Refresh')}
		</button>
	{/snippet}
</TopBar>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

<section class="search">
	<TickerSearch includeInactive label={tx('Найти бумагу', 'Find a security')} onselect={(s) => (picked = s)} />
</section>


{#if !stats}
	<div class="skeleton tall"></div>
{:else}
	<section class="card">
		<p class="big">{fmt.format(total)} <span>{tx('акций и ETF', 'stocks and ETFs')}</span></p>
		<p class="muted">{tx('Обновлено', 'Updated')}: {when(stats.updatedAt)}</p>
		{#each groups as g (g.title)}
			<table>
				<caption>{g.title}</caption>
				<thead><tr><th>{tx('Биржа', 'Exchange')}</th><th>{tx('Акции', 'Stocks')}</th><th>ETF</th><th title={tx('Исчезли из списков биржи: хранятся для старых гипотез, но не предлагаются', 'Gone from the exchange lists: kept for old hypotheses but not offered')}>{tx('Выбыли', 'Delisted')}</th></tr></thead>
				<tbody>
					{#each g.rows as e (e.code)}
						<tr>
							<td>{e.name}</td>
							<td>{fmt.format(e.stocks)}</td>
							<td>{fmt.format(e.etfs)}</td>
							<td>{e.inactive ? fmt.format(e.inactive) : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/each}
	</section>

	{#if stats.runs.length}
		<section class="card runs">
			<h2>{tx('Последняя загрузка', 'Last load')}</h2>
			{#each stats.runs as r (r.provider)}
				<div class="run">
					<b>{tl(PROVIDER[r.provider] ?? r.provider)}</b>
					<span class="status {r.status}">{tl(STATUS[r.status] ?? r.status)}</span>
					<span class="muted">
						{when(r.finishedAt ?? r.startedAt)} · {tx('получено', 'received')} {fmt.format(r.received)}, {tx('новых', 'new')} {fmt.format(r.added)}, {tx('изменено', 'changed')} {fmt.format(r.updated)}
					</span>
					{#if r.error}<span class="err">{r.error}</span>{/if}
				</div>
			{/each}
		</section>
	{/if}
{/if}

{#if picked}
	{@const s = picked}
	<Sheet title="{s.symbol} · {s.exchangeName}" onclose={() => (picked = null)}>
		<dl>
			<dt>{tx('Название', 'Name')}</dt>
			<dd>{s.nameEn}</dd>
			{#if s.nameHe}<dt>{tx('На иврите', 'In Hebrew')}</dt><dd><bdi class="he" lang="he">{s.nameHe}</bdi></dd>{/if}
			<dt>{tx('Тип', 'Type')}</dt>
			<dd>{typeName(s.type)}</dd>
			<dt>{tx('Валюта цены', 'Price currency')}</dt>
			<dd>{s.priceUnit === 'ILA' ? tx('агороты (1/100 шекеля)', 'agorot (1/100 of a shekel)') : s.currency}</dd>
			<dt>{tx('В списках биржи', 'Listed')}</dt>
			<dd>{s.active ? tx('да', 'yes') : tx('нет — бумага сохранена для старых гипотез', 'no — kept for old hypotheses')}</dd>
		</dl>
		<a class="tocard" href="/security/{s.id}">{tx('Карточка бумаги и график', 'Security card and chart')}</a>
	</Sheet>
{/if}

<style>
	.tocard {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		margin-top: var(--s3);
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		text-decoration: none;
	}
	.refresh {
		display: inline-flex;
		align-items: center;
		gap: var(--s2);
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		cursor: pointer;
	}
	.refresh:disabled {
		color: var(--muted);
	}
	.spin {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.card {
		margin-bottom: var(--s4);
		padding: var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	.big {
		margin: 0;
		font-size: var(--fs-xl);
		font-weight: 700;
	}
	.big span {
		font-size: var(--fs-m);
		font-weight: 400;
		color: var(--muted);
	}
	.muted {
		color: var(--muted);
		font-size: var(--fs-s);
	}
	table {
		width: 100%;
		margin-top: var(--s3);
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	caption {
		text-align: left;
		font-weight: 700;
		padding-bottom: var(--s1);
	}
	.search {
		margin-bottom: var(--s4);
	}
	th,
	td {
		padding: 6px 0 6px var(--s3);
		text-align: right;
		border-top: 1px solid var(--line);
	}
	th {
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--muted);
	}
	th:first-child,
	td:first-child {
		text-align: left;
		padding-left: 0;
	}
	h2 {
		margin: 0 0 var(--s2);
		font-size: var(--fs-m);
	}
	.run {
		display: flex;
		flex-wrap: wrap;
		gap: 2px var(--s2);
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.run .muted {
		flex-basis: 100%;
	}
	.status {
		font-size: var(--fs-s);
	}
	.status.ok {
		color: var(--up);
	}
	.status.error,
	.status.suspicious,
	.err {
		color: var(--down);
		font-size: var(--fs-s);
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		border-radius: var(--r3);
		background: var(--surface-2);
	}
	.tall {
		height: 260px;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--s2) var(--s4);
		margin: 0;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
</style>
