<script lang="ts">
	import { page } from '$app/state';
	let { children } = $props();
</script>

<!-- a card opened from another card (recent, «С чем сравнить», ETF): a fresh card, not the old one under a new address -->
{#key page.params.id}{@render children()}{/key}
