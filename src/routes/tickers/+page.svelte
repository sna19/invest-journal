<script lang="ts">
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
			problem = 'Нет связи с сервером.';
		}
	}
	function stopPoll() {
		clearInterval(poll);
		poll = undefined;
	}
	async function refresh() {
		if (stats) stats.running = true;
		await fetch('/api/tickers/refresh', { method: 'POST' }).catch(() => (problem = 'Нет связи с сервером.'));
		stopPoll();
		poll = setInterval(load, 2500);
	}

	onMount(() => {
		load().then(() => {
			if (stats?.running) poll = setInterval(load, 2500);
		});
	});
	onDestroy(stopPoll);

	const fmt = new Intl.NumberFormat('ru-RU');
	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'ещё не загружалась';
	const groups = $derived(
		stats
			? [
					{ title: 'США', rows: stats.byExchange.filter((e) => e.country === 'US' && e.stocks + e.etfs + e.inactive > 0) },
					{ title: 'Израиль', rows: stats.byExchange.filter((e) => e.country === 'IL' && e.stocks + e.etfs + e.inactive > 0) }
				]
			: []
	);
	const total = $derived(stats ? stats.byExchange.reduce((n, e) => n + e.stocks + e.etfs, 0) : 0);
	const PROVIDER: Record<string, string> = { nasdaqtrader: 'США — Nasdaq Trader', tase: 'Израиль — сайт TASE' };
	const STATUS: Record<string, string> = { ok: 'загружено', suspicious: 'подозрительно — проверить', error: 'ошибка', running: 'идёт' };
	const typeName = (t: string) => (t === 'etf' ? 'ETF' : t === 'index' ? 'Индекс' : 'Акция');
</script>

<svelte:head><title>Тикеры · Журнал гипотез</title></svelte:head>

<TopBar title="Тикеры" help="ticker.db" back={{ href: '/more', label: 'Ещё' }}>
	{#snippet actions()}
		<button class="refresh" onclick={refresh} disabled={stats?.running} aria-label="Обновить списки бумаг">
			<span class:spin={stats?.running}><RefreshCw size={18} /></span>{stats?.running ? 'Обновляется…' : 'Обновить'}
		</button>
	{/snippet}
</TopBar>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

<section class="search">
	<TickerSearch includeInactive label="Найти бумагу" onselect={(s) => (picked = s)} />
</section>


{#if !stats}
	<div class="skeleton tall"></div>
{:else}
	<section class="card">
		<p class="big">{fmt.format(total)} <span>акций и ETF</span></p>
		<p class="muted">Обновлено: {when(stats.updatedAt)}</p>
		{#each groups as g (g.title)}
			<table>
				<caption>{g.title}</caption>
				<thead><tr><th>Биржа</th><th>Акции</th><th>ETF</th><th title="Исчезли из списков биржи: хранятся для старых гипотез, но не предлагаются">Выбыли</th></tr></thead>
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
			<h2>Последняя загрузка</h2>
			{#each stats.runs as r (r.provider)}
				<div class="run">
					<b>{PROVIDER[r.provider] ?? r.provider}</b>
					<span class="status {r.status}">{STATUS[r.status] ?? r.status}</span>
					<span class="muted">
						{when(r.finishedAt ?? r.startedAt)} · получено {fmt.format(r.received)}, новых {fmt.format(r.added)}, изменено {fmt.format(r.updated)}
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
			<dt>Название</dt>
			<dd>{s.nameEn}</dd>
			{#if s.nameHe}<dt>На иврите</dt><dd><bdi class="he" lang="he">{s.nameHe}</bdi></dd>{/if}
			<dt>Тип</dt>
			<dd>{typeName(s.type)}</dd>
			<dt>Валюта цены</dt>
			<dd>{s.priceUnit === 'ILA' ? 'агороты (1/100 шекеля)' : s.currency}</dd>
			<dt>В списках биржи</dt>
			<dd>{s.active ? 'да' : 'нет — бумага сохранена для старых гипотез'}</dd>
		</dl>
		<a class="tocard" href="/security/{s.id}">Карточка бумаги и график</a>
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
