<script lang="ts">
	import { onMount } from 'svelte';
	import HelpIcon from './HelpIcon.svelte';
	import ScoreDot from './ScoreDot.svelte';
	import { SECTORS, sectorName } from './allocation.js';
	import { loc, tl, tx } from './i18n.js';
	import { showToast } from './toast.svelte.js';

	/**
	 * T-016: what a fund is made of — sectors, countries, industries (where each comes from: the provider, a rule, its top
	 * holdings or set by hand) and its top holdings. Any of the three can be set by hand: MAGS holds its shares through
	 * swaps and the provider gives no sectors; a country fund's countries are not given at all.
	 */
	let { securityId }: { securityId: number } = $props();
	type W = Record<string, number>;
	interface C {
		sectors: W | null;
		countries: W | null;
		industries: W | null;
		source: { sector: string | null; country: string | null; industry: string | null };
		holdings: { symbol: string; name: string; weight: number; id: number | null }[] | null;
		sectorPage: { sector: string; industry: string | null; country: 'US' | 'IL' } | null;
	}
	let c = $state<C | null>(null);
	let editing = $state<'sector' | 'country' | 'industry' | null>(null);
	let rows = $state<{ key: string; pct: string }[]>([]);
	onMount(async () => (c = await fetch(`/api/funds/${securityId}`).then((r) => r.json()).catch(() => null)));

	const SRC: Record<string, [string, string]> = { manual: ['вручную', 'by hand'], rule: ['по правилу', 'by a rule'], yahoo: ['Yahoo', 'Yahoo'], holdings: ['по крупнейшим бумагам', 'by the top holdings'] };
	const pct = (x: number) => `${(x * 100).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`;
	const top = (w: W | null) => (w ? Object.entries(w).sort((a, b) => b[1] - a[1]) : []);
	const label = (kind: string, k: string) => (kind === 'sector' ? sectorName(k, tx) : k);
	function edit(kind: 'sector' | 'country' | 'industry') {
		const w = kind === 'sector' ? c?.sectors : kind === 'country' ? c?.countries : c?.industries;
		rows = top(w ?? null).map(([key, x]) => ({ key, pct: String(Math.round(x * 1000) / 10) }));
		if (!rows.length) rows = [{ key: kind === 'sector' ? 'technology' : '', pct: '' }];
		editing = kind;
	}
	async function save(clear = false) {
		const weights = clear ? {} : Object.fromEntries(rows.filter((r) => r.key.trim() && Number(r.pct) > 0).map((r) => [r.key.trim(), Number(r.pct.replace(',', '.'))]));
		const r = await fetch(`/api/funds/${securityId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: editing, weights }) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return showToast(tl(j.message) || tx('Не сохранилось', 'Not saved'));
		c = j;
		editing = null;
		showToast(clear ? tx('Вернул данные поставщика', 'Back to the provider\'s data') : tx('Состав сохранён — распределение портфеля пересчитано', 'Saved — the portfolio\'s allocation is recounted'));
	}
	const sum = $derived(rows.reduce((n, r) => n + (Number(r.pct.replace(',', '.')) || 0), 0));
</script>

{#if c}
	{#if c.sectorPage}
		{@const sp = c.sectorPage}
		<a class="secpage" href="/sector?sector={sp.sector}{sp.industry ? `&industry=${encodeURIComponent(sp.industry)}` : ''}&country={sp.country}">{sp.industry ? tx('Все компании отрасли', 'All companies of the industry') : tx('Все компании сектора', 'All companies of the sector')} «{sp.industry ?? sectorName(sp.sector, tx)}» {tx('— с доходностью, отраслями и сезонностью', '— with returns, industries and seasonality')} →</a>
	{/if}
	{#if c.holdings?.length}
		<p class="h"><b>{tx('Крупнейшие бумаги', 'Top holdings')}</b> <span class="muted small">{tx(`${pct(c.holdings.reduce((n, h) => n + h.weight, 0))} фонда`, `${pct(c.holdings.reduce((n, h) => n + h.weight, 0))} of the fund`)}</span></p>
		<ul class="hold">
			{#each c.holdings as h (h.symbol)}
				<li>
					{#if h.id}<a href="/security/{h.id}"><b>{h.symbol}</b><ScoreDot id={h.id} /> <span class="muted">{h.name}</span></a>{:else}<b>{h.symbol}</b> <span class="muted">{h.name}</span>{/if}
					<span class="w">{pct(h.weight)}</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#each [['sector', tx('Секторы', 'Sectors'), c.sectors, c.source.sector], ['country', tx('Страны', 'Countries'), c.countries, c.source.country], ['industry', tx('Отрасли', 'Industries'), c.industries, c.source.industry]] as [kind, title, w, src] (kind)}
		<div class="part">
			<p class="h"><b>{title}</b>{#if src}<span class="muted small"> · {tx(...SRC[src as string])}</span>{/if}<button class="lnk" onclick={() => edit(kind as 'sector')}>{tx('править', 'edit')}</button></p>
			{#if editing === kind}
				{#each rows as r, i (i)}
					<div class="row">
						{#if kind === 'sector'}
							<select bind:value={r.key}>{#each Object.keys(SECTORS) as k (k)}<option value={k}>{sectorName(k, tx)}</option>{/each}</select>
						{:else}
							<input bind:value={r.key} placeholder={kind === 'country' ? 'United States' : 'Semiconductors'} />
						{/if}
						<input class="p" inputmode="decimal" bind:value={r.pct} placeholder="%" />
						<button class="lnk" aria-label={tx('Убрать', 'Remove')} onclick={() => (rows = rows.filter((_, j) => j !== i))}>×</button>
					</div>
				{/each}
				<div class="row">
					<button class="lnk" onclick={() => (rows = [...rows, { key: kind === 'sector' ? 'technology' : '', pct: '' }])}>+ {tx('строка', 'row')}</button>
					<span class="muted small" class:bad={sum > 100.5}>{tx('сумма', 'sum')} {Math.round(sum * 10) / 10}%</span>
				</div>
				<div class="row">
					<button class="main" onclick={() => save()}>{tx('Сохранить', 'Save')}</button>
					<button class="ghost" onclick={() => save(true)}>{tx('Как у поставщика', 'As the provider')}</button>
					<button class="ghost" onclick={() => (editing = null)}>{tx('Отмена', 'Cancel')}</button>
				</div>
			{:else if top(w as W | null).length}
				<p class="small">{top(w as W | null).slice(0, 8).map(([k, x]) => `${label(kind as string, k)} ${pct(x)}`).join(' · ')}</p>
			{:else}
				<p class="muted small">{tx('Нет данных — можно задать вручную.', 'No data — can be set by hand.')}</p>
			{/if}
		</div>
	{/each}
	<p class="muted small">{tx('Из этого состава считаются распределение портфеля и доля отрасли работы.', 'The portfolio\'s allocation and the job\'s industry share are counted from this.')}<HelpIcon topicKey="portfolio.exposure" label={tx('состав фонда', 'fund composition')} /></p>
{/if}

<style>
	.secpage {
		display: block;
		margin: 0 0 var(--s3);
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		color: var(--link);
		text-decoration: none;
		font-size: var(--fs-s);
	}
	.hold {
		list-style: none;
		margin: 4px 0 var(--s3);
		padding: 0;
		font-size: var(--fs-s);
	}
	.hold li {
		display: flex;
		align-items: center;
		gap: var(--s2);
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
	}
	.hold a {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--text);
		text-decoration: none;
	}
	.hold .w {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}
	.part {
		margin-bottom: var(--s2);
	}
	.h {
		display: flex;
		align-items: baseline;
		gap: 4px;
		margin: 0;
	}
	.lnk {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--link);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.row {
		display: flex;
		gap: var(--s2);
		align-items: center;
		margin: var(--s1) 0;
	}
	.row .lnk {
		margin-left: 0;
	}
	select,
	input {
		flex: 1;
		min-height: 36px;
		padding: 0 var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	input.p {
		flex: none;
		width: 64px;
		text-align: right;
	}
	.main,
	.ghost {
		min-height: 34px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.main {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.bad {
		color: var(--down);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
		margin: 2px 0;
	}
</style>
