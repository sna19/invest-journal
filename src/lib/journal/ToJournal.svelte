<script lang="ts">
	import BookPlus from '@lucide/svelte/icons/book-plus';
	import { tx } from '../i18n.js';
	import { openComposer, type ScreenLink, type SnapshotDraft } from './screen.svelte.js';

	/** Д-23: «В дневник» — an entry with a snapshot of what the screen shows now (the numbers frozen) */
	let { links, snapshot }: { links: ScreenLink[]; snapshot: () => SnapshotDraft } = $props();
</script>

<button type="button" class="to" onclick={() => openComposer({ links, snapshot: snapshot() })}><BookPlus size={16} /> {tx('В дневник', 'To the diary')}</button>

<style>
	.to {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 32px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--link);
		font-size: var(--fs-s);
		cursor: pointer;
	}
</style>
