<script lang="ts">
	import '#lib/styles/tokens.css';
	import TabBar from '#lib/TabBar.svelte';
	import Toast from '#lib/Toast.svelte';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	$effect(() => {
		document.documentElement.lang = data.lang;
	});
</script>

<main>{@render children()}</main>
{#if page.url.pathname !== '/login'}<TabBar />{/if}
<Toast />

<style>
	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 0 var(--s4) calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 96px);
		box-sizing: border-box;
	}
</style>
