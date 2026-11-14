<script lang="ts">
	import TopBar from '#lib/TopBar.svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Database from '@lucide/svelte/icons/database';
	import Settings from '@lucide/svelte/icons/settings';
</script>

<svelte:head><title>Ещё · Журнал гипотез</title></svelte:head>

<TopBar title="Ещё" />
<ul class="menu">
	<li><a href="/tickers"><Database size={20} /><span>Тикеры</span><ChevronRight size={18} /></a></li>
	<li><a href="/settings"><Settings size={20} /><span>Настройки</span><ChevronRight size={18} /></a></li>
</ul>

<style>
	.menu {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: var(--r2);
		background: var(--surface);
		overflow: hidden;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	a {
		display: flex;
		align-items: center;
		gap: var(--s3);
		min-height: 52px;
		padding: 0 var(--s3) 0 var(--s4);
		color: var(--text);
		text-decoration: none;
	}
	span {
		flex: 1;
	}
</style>
