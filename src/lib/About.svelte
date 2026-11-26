<script lang="ts">
	import { onMount } from 'svelte';
	import { loc, tx } from './i18n.js';

	/** «О компании»: what the company or the fund does — Russian with the original at hand, the seat, staff and site */
	let { securityId }: { securityId: number } = $props();
	interface A {
		summary: string | null;
		summaryRu: string | null;
		website: string | null;
		employees: number | null;
		city: string | null;
		country: string | null;
		fundFamily: string | null;
	}
	let a = $state<A | null>(null);
	let loaded = $state(false);
	let full = $state(false);
	let original = $state(false);
	onMount(async () => {
		a = (await fetch(`/api/securities/${securityId}/about`).then((r) => r.json()).catch(() => ({ about: null }))).about;
		loaded = true;
	});
	const text = $derived(a ? (original || !a.summaryRu || loc().startsWith('en') ? a.summary : a.summaryRu) : null);
	const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
</script>

{#if !loaded}
	<p class="muted small">…</p>
{:else if text}
	<p class="txt" class:clamp={!full}>{text}</p>
	<div class="row">
		{#if text.length > 280}<button class="lnk" onclick={() => (full = !full)}>{full ? tx('свернуть', 'less') : tx('читать целиком', 'read in full')}</button>{/if}
		{#if a?.summaryRu && !loc().startsWith('en')}<button class="lnk" onclick={() => (original = !original)}>{original ? tx('по-русски', 'in Russian') : tx('оригинал', 'original')}</button>{/if}
		{#if a?.summary && !a.summaryRu && !loc().startsWith('en')}<a class="lnk" target="_blank" rel="noopener noreferrer" href="https://translate.google.com/?sl=auto&tl=ru&op=translate&text={encodeURIComponent(a.summary)}">{tx('перевести', 'translate')} ↗</a>{/if}
	</div>
	<p class="facts muted small">
		{[a?.fundFamily, [a?.city, a?.country].filter(Boolean).join(', '), a?.employees ? `${a.employees.toLocaleString(loc())} ${tx('сотрудников', 'employees')}` : ''].filter(Boolean).join(' · ')}
		{#if a?.website}{' · '}<a href={a.website} target="_blank" rel="noopener noreferrer">{host(a.website)} ↗</a>{/if}
	</p>
	{#if a?.summaryRu && !original && !loc().startsWith('en')}<p class="muted tiny">{tx('Описание — от поставщика данных (Yahoo), машинный перевод.', 'The summary is the data provider\'s (Yahoo).')}</p>{/if}
{:else}
	<p class="muted small">{tx('У поставщика данных нет описания этой бумаги.', 'The data provider has no summary of this security.')}</p>
{/if}

<style>
	.txt {
		margin: 0;
		line-height: 1.5;
	}
	.clamp {
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.row {
		display: flex;
		gap: var(--s3);
		margin: var(--s1) 0;
	}
	.lnk {
		border: none;
		background: none;
		padding: 0;
		color: var(--link);
		font-size: var(--fs-s);
		cursor: pointer;
		text-decoration: none;
	}
	.facts {
		margin: var(--s1) 0 0;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.tiny {
		font-size: var(--fs-xs);
		margin: var(--s1) 0 0;
	}
</style>
