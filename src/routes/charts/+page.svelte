<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import TopBar from '#lib/TopBar.svelte';
	import TickerSearch, { type Security } from '#lib/TickerSearch.svelte';
	import { loc, tx } from '#lib/i18n.js';
	import { PERIODS } from '#lib/charts/ChartWidget.svelte';

	/**
	 * Owner 27.11.2026: «Сохранённые графики» — every chart saved from a security's card or here: open (the same widget
	 * as on the card, with all its choices), change, save; a new one from any ticker.
	 */
	type Item = { id: number; name: string; securityId: number; symbol: string; peerSymbols: string[]; config: { period: string; sma: string[]; shown: number[]; peers: number[]; highlight: number | null }; updatedAt: string };
	let items = $state<Item[] | null>(null);
	let adding = $state(false);
	onMount(async () => {
		const r = await fetch('/api/charts').catch(() => null);
		items = r?.ok ? (await r.json()).items : [];
	});
	const when = (iso: string) => new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
	const per = (p: string) => {
		const x = PERIODS.find((q) => q[0] === p);
		return x ? tx(x[1], x[2]) : p;
	};
</script>

<svelte:head><title>{tx('Сохранённые графики', 'Saved charts')}</title></svelte:head>
<TopBar title={tx('Сохранённые графики', 'Saved charts')} help="charts.saved" back={{ href: '/more', label: tx('Ещё', 'More') }} />

{#if adding}
	<section class="new">
		<TickerSearch noIndex autofocus label={tx('Новый график — бумага', 'A new chart — the security')} onselect={(s: Security) => goto(`/charts/new?security=${s.id}`)} />
		<button class="ghost" onclick={() => (adding = false)}>{tx('Отмена', 'Cancel')}</button>
	</section>
{:else}
	<button class="primary" onclick={() => (adding = true)}>+ {tx('Новый график', 'A new chart')}</button>
{/if}

{#if !items}
	<p class="muted">{tx('Загружаю…', 'Loading…')}</p>
{:else if !items.length}
	<p class="muted">{tx('Сохранённых графиков нет. В карточке любой бумаги под графиком — «Сохранить график»: период, SMA, эталоны и добавленные акции сохранятся вместе.', 'No saved charts yet. On any security\'s card, under its chart — «Save the chart»: the period, SMAs, references and added shares are saved together.')}</p>
{:else}
	<ul class="list">
		{#each items as it (it.id)}
			<li>
				<a href="/charts/{it.id}">
					<b>{it.name}</b>
					<span class="muted small">{[it.symbol, ...it.peerSymbols].join(' · ')} · {per(it.config.period)}{it.config.sma.length ? ` · SMA ${it.config.sma.join('/')}` : ''}{it.config.highlight ? ` · Q${it.config.highlight}` : ''} · {when(it.updatedAt)}</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.primary {
		width: 100%;
		min-height: 44px;
		margin: var(--s3) 0;
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		font-size: var(--fs-m);
		cursor: pointer;
	}
	.ghost {
		min-height: 38px;
		margin-top: var(--s2);
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.new {
		margin: var(--s3) 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list a {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3) var(--s2);
		border-bottom: 1px solid var(--line);
		color: var(--text);
		text-decoration: none;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
</style>
