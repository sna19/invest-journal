<script lang="ts">
	import { loc, tx } from '#lib/i18n.js';
	import { onMount } from 'svelte';
	import TopBar from '#lib/TopBar.svelte';
	import { money } from '#lib/portfolio.js';

	/**
	 * Spec section 18 «Всё вместе»: every real portfolio in one currency at today's Bank of Israel rate, «по курсу на
	 * дату»; for a dollar portfolio — its value in shekels against the rate of its own conversions. Shows only.
	 */
	interface T {
		currency: 'USD' | 'ILS';
		rate: number;
		date: string;
		total: number;
		items: { id: number; name: string; currency: string; value: number; inTotal: number; conversions: { ils: number; usd: number; rate: number; valueIlsNow: number; changeIls: number } | null }[];
	}
	const KEY = 'together-currency';
	let cur = $state<'USD' | 'ILS'>('ILS');
	let t = $state<T | null>(null);
	async function load() {
		const r = await fetch(`/api/together?currency=${cur}`).catch(() => null);
		t = r?.ok ? await r.json() : null;
	}
	onMount(() => {
		try {
			cur = localStorage.getItem(KEY) === 'USD' ? 'USD' : 'ILS';
		} catch {
			/* ignore */
		}
		load();
	});
	function set(c: 'USD' | 'ILS') {
		cur = c;
		try {
			localStorage.setItem(KEY, c);
		} catch {
			/* ignore */
		}
		load();
	}
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'long' });
</script>

<svelte:head><title>{tx('Всё вместе', 'All together')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Всё вместе', 'All together')} help="portfolio.together" back={{ href: '/portfolio', label: tx('Портфель', 'Portfolio') }} />

<div class="seg" role="radiogroup" aria-label={tx('Валюта итога', 'Total currency')}>
	<button role="radio" aria-checked={cur === 'ILS'} class:on={cur === 'ILS'} onclick={() => set('ILS')}>₪ {tx('шекели', 'shekels')}</button>
	<button role="radio" aria-checked={cur === 'USD'} class:on={cur === 'USD'} onclick={() => set('USD')}>$ {tx('доллары', 'dollars')}</button>
</div>

{#if t}
	<section class="card">
		<span class="k">{tx('Все реальные портфели', 'All real portfolios')}</span>
		<b class="big">{money(t.total, t.currency)}</b>
		<span class="sub">{tx('по курсу Банка Израиля на', 'at the Bank of Israel rate of')} {d(t.date)}: $ = {t.rate} ₪</span>
	</section>
	<ul class="list">
		{#each t.items as p (p.id)}
			<li>
				<a href="/portfolio?p={p.id}">
					<span class="top"><b>{p.name}</b><span class="grow"></span>{money(p.value, p.currency)}</span>
					{#if p.currency !== t.currency}<span class="sub">≈ {money(p.inTotal, t.currency)} {tx('по курсу на дату', 'at the rate of the date')}</span>{/if}
					{#if p.conversions}
						<span class="sub">
							{tx('в шекелях сейчас', 'in shekels now')} {money(p.conversions.valueIlsNow, 'ILS')}; {tx('по курсу своих конвертаций', 'at the rate of its own conversions')} ({p.conversions.rate.toFixed(4)} ₪ {tx('за', 'per')} $) {tx('было бы на', 'it would be')}
							{money(Math.abs(p.conversions.changeIls), 'ILS')}
							{p.conversions.changeIls >= 0 ? tx('меньше', 'less') : tx('больше', 'more')} — {tx('это дал курс доллара', 'that is the dollar rate')}
						</span>
					{/if}
				</a>
			</li>
		{:else}
			<li class="muted">{tx('Реальных портфелей пока нет.', 'No real portfolios yet.')}</li>
		{/each}
	</ul>
	<p class="muted small">{tx('Экран только складывает: в самих портфелях ничего не меняется, их доходность — в их валюте.', 'This screen only adds up: nothing changes in the portfolios themselves, their return stays in their currency.')}</p>
{/if}

<style>
	.seg {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin-bottom: var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.seg button {
		flex: 1;
		min-height: 36px;
		border: none;
		border-radius: var(--r1);
		background: none;
		cursor: pointer;
	}
	.seg button.on {
		background: var(--surface);
		font-weight: 600;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s4);
		margin-bottom: var(--s3);
		border-radius: var(--r3);
		background: var(--surface);
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
	}
	.big {
		font-size: var(--fs-xl);
	}
	.sub {
		font-size: var(--fs-s);
		color: var(--muted);
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
	.top {
		display: flex;
		gap: var(--s2);
	}
	.grow {
		flex: 1;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
</style>
