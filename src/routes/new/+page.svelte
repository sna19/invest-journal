<script lang="ts">
	import TopBar from '#lib/TopBar.svelte';
	import TickerSearch, { type Security } from '#lib/TickerSearch.svelte';

	/** Stage 1: only the ticker field of the future form (spec section 2), to try the search from the phone. */
	let chosen = $state<Security | null>(null);
</script>

<svelte:head><title>Новая гипотеза · Журнал гипотез</title></svelte:head>

<TopBar title="Новая гипотеза" back={{ href: '/', label: 'Гипотезы' }} subtitle="Форма целиком появится на этапе 2; сейчас работает выбор тикера." />
<TickerSearch onselect={(s) => (chosen = s)} autofocus />
{#if chosen}
	<p class="chosen">Выбрано: <b>{chosen.symbol}</b> — {chosen.nameEn} · {chosen.exchangeName}</p>
{/if}

<style>
	.chosen {
		margin-top: var(--s4);
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--surface);
	}
</style>
