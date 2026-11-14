<script lang="ts">
	import '#lib/styles/tokens.css';
	import TabBar from '#lib/TabBar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<main>{@render children()}</main>
<TabBar />

<style>
	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 0 var(--s4) calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 96px);
		box-sizing: border-box;
	}
</style>
