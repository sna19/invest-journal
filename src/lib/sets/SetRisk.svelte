<script lang="ts">
	import { onMount } from 'svelte';
	import { tx } from '../i18n.js';
	import { whatIf, type RiskData } from '../risk.js';
	import RiskLabel from '../RiskLabel.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import type { SetItem } from './types.js';

	/**
	 * Owner 27.11.2026, a set's «Риск, что если»: what buying the set does to a portfolio (or all of them together) —
	 * its swings and the number of independent bets before and after, and each security alone: does it reduce the risk,
	 * stay neutral or repeat something already held (and what). The same arithmetic as the portfolio's «Что если?».
	 */
	let { items }: { items: SetItem[] } = $props();
	type Port = { id: number; name: string; kind: string; currency: string; auto_source_id: number | null };
	let ports = $state<Port[]>([]);
	let target = $state<number | 'all'>('all');
	let pct = $state(5);
	let r = $state<(RiskData & { loading: number[] }) | null>(null);
	let busy = $state(false);
	onMount(async () => {
		const j = await fetch('/api/portfolios').then((x) => x.json()).catch(() => null);
		ports = ((j?.items ?? []) as Port[]).filter((p) => p.kind === 'real' && !p.auto_source_id);
		if (ports.length === 1) target = ports[0].id;
	});
	const ids = $derived(items.slice(0, 12).map((x) => x.id));
	$effect(() => {
		const t = target;
		const list = ids;
		if (!list.length) return;
		busy = true;
		fetch(`/api/portfolios/${t}/risk?add=${list.join(',')}`)
			.then((x) => (x.ok ? x.json() : null))
			.then((j) => ((r = j), (busy = false)))
			.catch(() => ((r = null), (busy = false)));
	});
	const held = (id: number) => r?.securities.some((s) => s.id === id && s.role === 'held') ?? false;
	const tried = $derived(r ? ids.filter((id) => r!.securities.some((s) => s.id === id && s.role === 'add')) : []);
	const all = $derived(r && tried.length ? whatIf(r, tried, pct / 100) : null);
	const each = $derived(
		r
			? items.slice(0, 12).map((it) => ({ it, w: tried.includes(it.id) ? whatIf(r!, [it.id], pct / 100) : null, held: held(it.id), loading: r!.loading.includes(it.id) }))
			: []
	);
	const p100 = (x: number) => `${(x * 100).toFixed(1).replace('.', tx(',', '.'))}%`;
	const n1 = (x: number) => x.toFixed(1).replace('.', tx(',', '.'));
</script>

<div class="ctl">
	<label>
		{tx('Портфель', 'Portfolio')}
		<select bind:value={target}>
			{#if ports.length > 1}<option value="all">{tx('Все вместе', 'All together')}</option>{/if}
			{#each ports as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
		</select>
	</label>
	<label>
		{tx('На каждую, % портфеля', 'Each, % of the portfolio')}
		<input type="number" min="1" max="30" step="1" bind:value={pct} />
	</label>
	<HelpIcon topicKey="portfolio.whatif" label={tx('что если', 'what if')} />
</div>

{#if busy && !r}
	<div class="skeleton"></div>
{:else if !r}
	<p class="muted small">{tx('Риск не посчитался: нет реального портфеля или истории цен.', 'The risk did not compute: no real portfolio or price history.')}</p>
{:else}
	{#if all}
		<div class="sum">
			<div>
				<span class="k">{tx('Колебания портфеля, в год', 'The portfolio\'s swings, a year')}</span>
				<b>{p100(all.before.vol)} → {p100(all.after.vol)}</b>
			</div>
			<div>
				<span class="k">{tx('Независимых ставок', 'Independent bets')}</span>
				<b>{n1(all.before.bets)} → {n1(all.after.bets)}</b>
			</div>
			<div class="lab"><RiskLabel label={all.label} twin={all.twin?.symbol ?? null} /></div>
		</div>
		<p class="muted small">{tx(`Если купить из набора всё, чего ещё нет в портфеле (${tried.length} шт.), по ${pct}% портфеля на каждую — из свободных денег.`, `If everything of the set not held yet (${tried.length}) is bought for ${pct}% of the portfolio each — from the cash.`)}</p>
	{/if}
	<ul class="rows">
		{#each each as x (x.it.id)}
			<li>
				<a href="/security/{x.it.id}"><b>{x.it.symbol}</b></a>
				{#if x.held}
					<RiskLabel label="held" small />
				{:else if x.loading || !x.w}
					<RiskLabel label="loading" small />
				{:else}
					<RiskLabel label={x.w.label} twin={x.w.twin?.symbol ?? null} small />
					<span class="muted small">{tx('ставок', 'bets')} {n1(x.w.before.bets)} → {n1(x.w.after.bets)}{x.w.twin ? ` · ${tx('ближе всего к', 'closest to')} ${x.w.twin.symbol} ${x.w.twin.corr.toFixed(2).replace('.', tx(',', '.'))}` : ''}</span>
				{/if}
			</li>
		{/each}
	</ul>
	{#if items.length > 12}<p class="muted small">{tx(`Посчитаны первые 12 из ${items.length}.`, `The first 12 of ${items.length} are computed.`)}</p>{/if}
	<p class="muted small">{tx('«Независимых ставок» — сколько на самом деле разных ставок в портфеле: три полупроводниковые акции — почти одна. Ковариация — недельные доходности за 2 года.', '«Independent bets» — how many really different bets the portfolio holds: three chip stocks are almost one. Covariance — weekly returns over 2 years.')}</p>
{/if}

<style>
	.ctl {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--s3);
		margin-bottom: var(--s3);
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.ctl label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	select,
	input {
		min-height: 36px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
	}
	input {
		width: 5em;
	}
	.sum {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s3) var(--s4);
		align-items: center;
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.sum > div {
		display: flex;
		flex-direction: column;
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.sum b {
		font-variant-numeric: tabular-nums;
	}
	.rows {
		list-style: none;
		margin: var(--s3) 0;
		padding: 0;
	}
	.rows li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px var(--s2);
		padding: var(--s2) 0;
		border-bottom: 1px solid var(--line);
	}
	.rows a {
		color: var(--text);
		text-decoration: none;
	}
	.skeleton {
		height: 160px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
</style>
