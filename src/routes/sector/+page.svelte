<script lang="ts">
	import ScoreDot from '#lib/ScoreDot.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import TopBar from '#lib/TopBar.svelte';
	import Fold from '#lib/Fold.svelte';
	import Feed from '#lib/journal/Feed.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import RecentCards from '#lib/RecentCards.svelte';
	import LineChart, { type Line } from '#lib/charts/LineChart.svelte';
	import { sectorName } from '#lib/allocation.js';
	import { loc, tx } from '#lib/i18n.js';
	import { priceText } from '#lib/portfolio.js';
	import { keepScroll } from '#lib/scroll.js';

	/**
	 * A sector or an industry (owner's request 26.11.2026): its ETF against the market, its seasonality by quarter, its
	 * industries, its companies by market cap with their returns.
	 */
	interface Member {
		id: number;
		symbol: string;
		name: string;
		exchange: string;
		market: 'US' | 'IL';
		industry: string | null;
		capUsd: number | null;
		m1: number | null;
		m3: number | null;
		y1: number | null;
	}
	interface View {
		sector: string | null;
		industry: string | null;
		country: 'US' | 'IL' | null;
		count: number;
		capUsd: number;
		medianY1: number | null;
		etf: { id: number; symbol: string; name: string; exchange: string } | null;
		industries: { name: string; count: number; capUsd: number; y1: number | null }[];
		members: Member[];
		best: Member[];
		worst: Member[];
		seasons: { quarter: number; mean: number | null; up: number; years: number }[];
	}
	interface Chart {
		points: { date: string; value: number }[];
		bench: { date: string; value: number }[];
		benchmark: { label: string } | null;
		change: number | null;
		benchChange: number | null;
		security: { priceUnit: string };
	}

	const sector = $derived(page.url.searchParams.get('sector'));
	const industry = $derived(page.url.searchParams.get('industry'));
	const country = $derived(page.url.searchParams.get('country'));
	let v = $state<View | null>(null);
	let chart = $state<Chart | null>(null);
	let period = $state('1Y');
	let sortKey = $state<'capUsd' | 'm1' | 'm3' | 'y1'>('capUsd');
	let limit = $state(30);
	const scroll = keepScroll(() => `sector:${page.url.search}`);

	async function load() {
		const q = new URLSearchParams();
		if (sector) q.set('sector', sector);
		if (industry) q.set('industry', industry);
		if (country) q.set('country', country);
		v = await fetch(`/api/sectors?${q}`).then((r) => r.json()).catch(() => null);
		void scroll.restore();
		void loadChart();
	}
	async function loadChart() {
		if (!v?.etf) return;
		const r = await fetch(`/api/securities/${v.etf.id}/chart?period=${period}`).then((x) => x.json()).catch(() => null);
		chart = r;
	}
	onMount(load);
	function setCountry(c: string | null) {
		const q = new URLSearchParams(page.url.search);
		if (c) q.set('country', c);
		else q.delete('country');
		void goto(`/sector?${q}`, { replaceState: true }).then(load);
	}

	const title = $derived(industry ?? (sector ? sectorName(sector, tx) : tx('Сектор', 'Sector')));
	const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1).replace('.', tx(',', '.'))}%`);
	const cap = (x: number | null) => (!x ? '—' : x >= 1e12 ? `${(x / 1e12).toFixed(1)} ${tx('трлн $', 'T $')}` : x >= 1e9 ? `${Math.round(x / 1e9)} ${tx('млрд $', 'B $')}` : `${Math.round(x / 1e6)} ${tx('млн $', 'M $')}`);
	const css = (n: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(n).trim());
	const lines = $derived<Line[]>(
		chart?.points?.length
			? [
					{ key: 'etf', label: v?.etf?.symbol ?? '', points: chart.points, main: true },
					...(chart.benchmark && chart.bench.length ? [{ key: 'bench', label: chart.benchmark.label, points: chart.bench, color: css('--muted'), dashed: true }] : [])
				]
			: []
	);
	const members = $derived(v ? [...v.members].sort((a, b) => ((b[sortKey] ?? -Infinity) as number) - ((a[sortKey] ?? -Infinity) as number)) : []);
	const maxSeason = $derived(Math.max(1, ...(v?.seasons ?? []).map((s) => Math.abs(s.mean ?? 0))));
</script>

<svelte:head><title>{title} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={title} subtitle={industry && sector ? sectorName(sector, tx) : undefined} help="sector.screen" />
<RecentCards />

<div class="mk" role="radiogroup" aria-label={tx('Рынок', 'Market')}>
	{#each [[null, tx('Все', 'All')], ['US', tx('США', 'US')], ['IL', tx('Израиль', 'Israel')]] as [c, l] (String(c))}
		<button role="radio" aria-checked={country === c} class:on={country === c} onclick={() => setCountry(c)}>{l}</button>
	{/each}
</div>

{#if !v}
	<div class="skeleton tall"></div>
{:else}
	<p class="sum">
		<b>{v.count}</b> {tx('компаний с профилем', 'companies with a profile')} · {tx('вместе', 'together')} <b>{cap(v.capUsd)}</b> · {tx('медиана за год', 'median over a year')} <b class:up={(v.medianY1 ?? 0) > 0} class:down={(v.medianY1 ?? 0) < 0}>{pct(v.medianY1)}</b>
	</p>

	{#if v.etf}
		<Fold key="sector-etf" remind="sector.screen" title={`${tx('Фонд', 'Fund')} ${v.etf.symbol}`} summary={chart ? `${pct(chart.change)} · ${chart.benchmark?.label ?? ''} ${pct(chart.benchChange)}` : v.etf.name}>
			<p class="muted small"><a href="/security/{v.etf.id}">{v.etf.symbol}</a> — {v.etf.name}. {tx('Его цена — история сектора: так он двигался против рынка.', 'Its price is the sector\'s history: how it moved against the market.')}</p>
			<div class="periods" role="radiogroup" aria-label={tx('Период', 'Period')}>
				{#each [['3M', '3М'], ['1Y', '1Г'], ['5Y', '5Л'], ['10Y', '10Л']] as [k, l] (k)}
					<button role="radio" aria-checked={period === k} class:on={period === k} onclick={() => ((period = k), loadChart())}>{l}</button>
				{/each}
			</div>
			{#if lines.length}
				<LineChart {lines} format={(x) => priceText(x, chart!.security.priceUnit)} height={220} />
				<p class="small">{v.etf.symbol} <b class:up={(chart?.change ?? 0) > 0} class:down={(chart?.change ?? 0) < 0}>{pct(chart?.change)}</b> · {chart?.benchmark?.label} {pct(chart?.benchChange)}</p>
			{:else}
				<p class="muted small">{tx('История фонда загружается — откройте страницу чуть позже.', 'The fund\'s history is loading — open the page a little later.')}</p>
			{/if}
		</Fold>
	{:else}
		<p class="muted small">{tx('Торгуемого фонда на этот сектор или отрасль в справочнике нет — история видна по компаниям ниже.', 'No traded fund for this sector or industry in the reference — its history is in the companies below.')}</p>
	{/if}

	<Fold key="sector-seasons" remind="sector.screen" title={tx('Сезонность', 'Seasonality')} summary={v.seasons.map((s) => `Q${s.quarter} ${pct(s.mean)}`).join(' · ')}>
		{#snippet aside()}<HelpIcon topicKey="sector.screen" label={tx('сектор', 'sector')} />{/snippet}
		{#each v.seasons as s (s.quarter)}
			<div class="qrow">
				<span>Q{s.quarter}</span>
				<span class="track"><span class="mid"></span><span class="b" class:neg={(s.mean ?? 0) < 0} style:width="{(Math.abs(s.mean ?? 0) / maxSeason) * 50}%"></span></span>
				<span class="v">{pct(s.mean)}</span>
				<span class="muted small">{tx('лучше рынка', 'beat the market')} {s.up}/{s.years}</span>
			</div>
		{/each}
		<p class="muted small">{tx('Среднее превышение над рынком равновесной корзины компаний сектора в каждом квартале за 10 лет (месячные цены, как в квартальной модели).', 'The mean excess over the market of an equal-weighted basket of the sector\'s companies in each quarter over 10 years (monthly prices, as in the quarterly model).')}</p>
	</Fold>

	{#if v.industries.length}
		<Fold key="sector-industries" remind="sector.screen" title={tx('Отрасли', 'Industries')} summary={v.industries.slice(0, 4).map((x) => x.name).join(' · ')}>
			<ul class="list">
				{#each v.industries as x (x.name)}
					<li>
						<a href="/sector?{sector ? `sector=${sector}&` : ''}industry={encodeURIComponent(x.name)}{country ? `&country=${country}` : ''}">
							<span><b>{x.name}</b> <span class="muted small">{x.count}</span></span>
							<span class="small">{cap(x.capUsd)} · <span class:up={(x.y1 ?? 0) > 0} class:down={(x.y1 ?? 0) < 0}>{pct(x.y1)}</span></span>
						</a>
					</li>
				{/each}
			</ul>
			<p class="muted small">{tx('Капитализация вместе и медиана компаний за год.', 'The market cap together and the companies\' median over a year.')}</p>
		</Fold>
	{/if}

	<!-- T-032 Д-08: the sector's (or industry's) diary — its companies' entries come up unless switched off -->
	<Fold key="sector-journal" title={tx('Дневник', 'Diary')} open={false} remind="journal.inherit">
		{#snippet aside()}<HelpIcon topicKey="journal.inherit" label={tx('дневник сектора', 'the sector\'s diary')} />{/snippet}
		{#key `${sector}|${industry}`}
			<Feed scope={industry ? `industry:${industry}` : `sector:${sector}`} links={[industry ? { type: 'industry', id: industry, label: industry } : { type: 'sector', id: sector ?? '', label: sector ?? '' }]} inheritToggle />
		{/key}
	</Fold>

	<Fold key="sector-members" remind="sector.screen" title={tx('Компании', 'Companies')} summary={v.members.slice(0, 5).map((m) => m.symbol).join(' · ')}>
		<div class="sorts">
			{#each [['capUsd', tx('капитализация', 'market cap')], ['m1', '1М'], ['m3', '3М'], ['y1', '1Г']] as [k, l] (k)}
				<button class:on={sortKey === k} aria-pressed={sortKey === k} onclick={() => (sortKey = k as typeof sortKey)}>{l}</button>
			{/each}
		</div>
		<div class="scroll">
			<table>
				<thead><tr><th></th><th>{tx('Кап.', 'Cap')}</th><th>1М</th><th>3М</th><th>1Г</th></tr></thead>
				<tbody>
					{#each members.slice(0, limit) as m (m.id)}
						<tr>
							<th><a href="/security/{m.id}">{m.symbol}</a><ScoreDot id={m.id} /><span class="muted name">{m.name}</span></th>
							<td>{cap(m.capUsd)}</td>
							<td class:up={(m.m1 ?? 0) > 0} class:down={(m.m1 ?? 0) < 0}>{pct(m.m1)}</td>
							<td class:up={(m.m3 ?? 0) > 0} class:down={(m.m3 ?? 0) < 0}>{pct(m.m3)}</td>
							<td class:up={(m.y1 ?? 0) > 0} class:down={(m.y1 ?? 0) < 0}>{pct(m.y1)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if members.length > limit}<button class="more" onclick={() => (limit += 30)}>{tx(`Показать ещё — осталось ${members.length - limit}`, `Show more — ${members.length - limit} left`)}</button>{/if}
		<p class="muted small">{tx('Доходность — по месячным закрытиям (с дивидендами) до конца прошлого месяца; у компаний без месячной истории — прочерк.', 'Returns — by monthly closes (with dividends) to the end of last month; a dash for companies without monthly history.')}</p>
	</Fold>
{/if}

<style>
	.mk,
	.periods,
	.sorts {
		display: flex;
		gap: 6px;
		margin: 0 0 var(--s3);
		flex-wrap: wrap;
	}
	.mk button,
	.periods button,
	.sorts button {
		min-height: 32px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.mk button.on,
	.periods button.on,
	.sorts button.on {
		background: var(--text);
		color: var(--bg);
		border-color: var(--text);
	}
	.sum {
		margin: 0 0 var(--s3);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	a {
		color: var(--link);
		text-decoration: none;
	}
	.qrow {
		display: grid;
		grid-template-columns: 2em 1fr 4em auto;
		align-items: center;
		gap: var(--s2);
		padding: 4px 0;
	}
	.qrow .v {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.track {
		position: relative;
		height: 10px;
	}
	.track .mid {
		position: absolute;
		left: 50%;
		top: -2px;
		bottom: -2px;
		width: 1px;
		background: var(--line);
	}
	.track .b {
		position: absolute;
		left: 50%;
		top: 0;
		height: 100%;
		border-radius: 0 3px 3px 0;
		background: var(--up);
	}
	.track .b.neg {
		left: auto;
		right: 50%;
		border-radius: 3px 0 0 3px;
		background: var(--down);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list a {
		display: flex;
		justify-content: space-between;
		gap: var(--s2);
		padding: var(--s2) 0;
		border-bottom: 1px solid var(--line);
		color: var(--text);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 5px 4px;
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	tbody th {
		text-align: left;
		max-width: 11em;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	tbody th a {
		font-weight: 700;
		color: var(--text);
		margin-right: 4px;
	}
	.name {
		font-weight: 400;
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
</style>
