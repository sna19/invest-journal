<script lang="ts">
	import TopBar from '#lib/TopBar.svelte';
	import Feed from '#lib/journal/Feed.svelte';
	import { tx } from '#lib/i18n.js';

	/** T-032 Д-07: the whole diary — every entry, newest first, by days; the filters and the search in the address */
</script>

<svelte:head><title>{tx('Дневник', 'Diary')}</title></svelte:head>

<TopBar title={tx('Дневник', 'Diary')} help="journal.screen" back={{ href: '/more', label: tx('Ещё', 'More') }} />
<Feed full />
