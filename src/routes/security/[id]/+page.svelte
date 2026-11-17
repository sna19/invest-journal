<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TopBar from '#lib/TopBar.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Pct from '#lib/Pct.svelte';
	import LineChart, { colorOf, type Line, type Mark } from '#lib/charts/LineChart.svelte';
	import { SIGNAL, short } from '#lib/HypothesisCard.svelte';
	import { priceText, STAGE_LABEL, type Stage } from '#lib/portfolio.js';

	/**
	 * Spec section 19 — the security card: the price with the benchmark brought to the same start, the marks of
	 * hypotheses (entry ●, exit ■, colour by source) and of the owner's trades (▲ bought, ▼ sold); periods
	 * 1М…10Л. A tap on a mark opens the hypothesis or the position.
	 */
	interface Chart {
		security: { id: number; symbol: string; name: string; exchange: string; currency: string; priceUnit: string };
		benchmark: { id: number; label: string } | null;
		points: { date: string; value: number }[];
		bench: { date: string; value: number }[];
		markers: { id: string; date: string; price: number; kind: Mark['kind']; label: string; sourceId?: number; hypothesisId?: number; positionId?: number; direction?: string }[];
		change: number | null;
		benchChange: number | null;
		last: { date: string; close: number } | null;
		hypotheses: { id: number; direction: string; signalType: string; status: string; sourceId: number; sourceName: string; entryPriceDate: string | null; horizonDate: string; excessPct: number | null; outcome: string | null }[];
		positions: { id: number; stage: Stage; portfolioId: number; portfolio: string; kind: string; auto: number | null }[];
	}
	const PERIODS = [
		['1M', '1М'],
		['3M', '3М'],
		['6M', '6М'],
		['1Y', '1Г'],
		['5Y', '5Л'],
		['10Y', '10Л']
	] as const;
	const KEY = 'security-period';

	let period = $state<string>('1Y');
	let c = $state<Chart | null>(null);
	let problem = $state<string | null>(null);
	let loadMs = $state<number | null>(null);
	let allHyps = $state(false);

	async function load() {
		const t0 = performance.now();
		const r = await fetch(`/api/securities/${page.params.id}/chart?period=${period}`).catch(() => null);
		if (!r?.ok) return (problem = r?.status === 404 ? 'Нет такой бумаги.' : 'Нет связи с сервером.');
		c = await r.json();
		loadMs = Math.round(performance.now() - t0);
		problem = null;
	}
	onMount(() => {
		try {
			period = localStorage.getItem(KEY) ?? '1Y';
		} catch {
			/* ignore */
		}
		load();
	});
	function setPeriod(p: string) {
		period = p;
		try {
			localStorage.setItem(KEY, p);
		} catch {
			/* ignore */
		}
		load();
	}

	const css = (n: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(n).trim());
	const lines = $derived<Line[]>(
		c
			? [
					{ key: 'sec', label: c.security.symbol, points: c.points, main: true },
					...(c.benchmark && c.bench.length ? [{ key: 'bench', label: c.benchmark.label, points: c.bench, color: css('--muted'), dashed: true }] : [])
				]
			: []
	);
	const marks = $derived<Mark[]>(
		c
			? c.markers.map((m) => ({
					id: m.id,
					date: m.date,
					price: m.price,
					kind: m.kind,
					color: m.kind === 'buy' ? css('--up') : m.kind === 'sell' ? css('--down') : colorOf(m.sourceId ?? 0),
					text: m.kind === 'buy' || m.kind === 'sell' ? undefined : m.label.slice(0, 14)
				}))
			: []
	);
	function onmarker(id: string) {
		const m = c?.markers.find((x) => x.id === id);
		if (!m) return;
		if (m.hypothesisId) goto(`/?open=${m.hypothesisId}`);
		else if (m.positionId) {
			const p = c!.positions.find((x) => x.id === m.positionId);
			goto(`/portfolio?p=${p?.portfolioId ?? ''}&position=${m.positionId}`);
		}
	}
	const sources = $derived([...new Map((c?.markers ?? []).filter((m) => m.sourceId).map((m) => [m.sourceId!, m.label.slice(2)])).entries()]);
</script>

<svelte:head><title>{c?.security.symbol ?? 'Бумага'} · Журнал гипотез</title></svelte:head>

<TopBar title={c?.security.symbol ?? 'Бумага'} subtitle={c ? `${c.security.name} · ${c.security.exchange.replace('_', ' ')}` : undefined} help="security.chart" />

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if c}
	<div class="head">
		<b class="price">{priceText(c.last?.close, c.security.priceUnit)}</b>
		{#if c.last}<span class="muted small">закрытие {short(c.last.date, true)}</span>{/if}
		<span class="grow"></span>
		<span class="chg">{PERIODS.find((p) => p[0] === period)?.[1]}: <Pct value={c.change} />{#if c.benchmark && c.benchChange !== null} <span class="muted small">{c.benchmark.label} <Pct value={c.benchChange} plain /></span>{/if}</span>
	</div>

	<div class="periods" role="radiogroup" aria-label="Период">
		{#each PERIODS as [k, t] (k)}
			<button role="radio" aria-checked={period === k} class:on={period === k} onclick={() => setPeriod(k)}>{t}</button>
		{/each}
	</div>

	{#if c.points.length < 2}
		<p class="muted center">За этот период цен нет: бумага не в кругах загрузки или история ещё грузится.</p>
	{:else}
		<LineChart {lines} {marks} {onmarker} format={(v) => priceText(v, c!.security.priceUnit)} />
		<p class="muted small keys">
			● вход гипотезы · ■ выход · <span class="up">▲</span> купил · <span class="down">▼</span> продал{#if sources.length} · {#each sources as [id, name] (id)}<span class="src"><i style:background={colorOf(id)}></i>{name}</span>{/each}{/if}
		</p>
	{/if}

	<div class="buttons">
		<a href="/portfolio?add={c.security.id}&kind=plan_buy">Хочу купить</a>
		<a href="/portfolio?add={c.security.id}&kind=buy">Купил</a>
		<a href="/new">Гипотеза</a>
	</div>

	{#if c.hypotheses.length}
		<h2>Гипотезы</h2>
		<ul class="list">
			{#each allHyps ? [...c.hypotheses].reverse() : [...c.hypotheses].reverse().slice(0, 10) as h (h.id)}
				<li>
					<a href="/?open={h.id}">
						<span><i class="dot" style:background={colorOf(h.sourceId)}></i>{h.sourceName} · {SIGNAL[h.signalType]} · {h.direction === 'long' ? '▲ рост' : '▼ падение'}</span>
						<span class="muted small">
							{h.status === 'open' ? `до ${short(h.horizonDate, true)}` : h.outcome === 'hit' ? 'сработала' : 'не сработала'}{#if h.excessPct !== null} · <Pct value={h.excessPct} />{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
		{#if c.hypotheses.length > 10 && !allHyps}<button class="more" onclick={() => (allHyps = true)}>Показать все — {c.hypotheses.length}</button>{/if}
	{/if}
	{#if c.positions.length}
		<h2>В портфелях</h2>
		<ul class="list">
			{#each c.positions as p (p.id)}
				<li>
					<a href="/portfolio?p={p.portfolioId}&position={p.id}"><span>{p.portfolio}</span><span class="muted small">{STAGE_LABEL[p.stage]}</span></a>
				</li>
			{/each}
		</ul>
	{/if}
	{#if loadMs !== null}<p class="muted tiny">данные графика — {loadMs} мс</p>{/if}
{:else if !problem}
	<div class="skeleton"></div>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--s2);
		margin-bottom: var(--s2);
	}
	.price {
		font-size: var(--fs-xl);
	}
	.grow {
		flex: 1;
	}
	.more {
		width: 100%;
		min-height: var(--tap);
		margin-top: var(--s2);
		border: none;
		background: none;
		color: var(--link);
		cursor: pointer;
	}
	.chg {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px var(--s2);
		align-items: baseline;
	}
	.periods {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin-bottom: var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.periods button {
		flex: 1;
		min-height: 36px;
		border: none;
		border-radius: var(--r1);
		background: none;
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.periods button.on {
		background: var(--surface);
		font-weight: 600;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
	}
	.keys {
		display: flex;
		flex-wrap: wrap;
		gap: 4px var(--s2);
		align-items: center;
	}
	.src {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.src i,
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-right: 4px;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.buttons {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--s2);
		margin: var(--s3) 0;
	}
	.buttons a {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	h2 {
		margin: var(--s4) 0 var(--s2);
		font-size: var(--fs-m);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.list a {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3) var(--s4);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.tiny {
		font-size: var(--fs-xs);
		text-align: right;
	}
	.center {
		text-align: center;
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 300px;
		border-radius: var(--r3);
		background: var(--surface);
	}
</style>
