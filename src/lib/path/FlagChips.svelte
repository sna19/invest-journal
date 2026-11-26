<script lang="ts">
	import { tx } from '#lib/i18n.js';
	import { FLAG_NAME, type Flag } from '#lib/path.js';

	/** T-033: the marks of the return's path as small chips (card, lists of positions, «Наблюдаю», candidates) */
	let { flags }: { flags: Flag[] } = $props();
</script>

{#each flags as f (f)}<span class="chip {f}">{tx(...FLAG_NAME[f])}</span>{/each}

<style>
	.chip {
		display: inline-block;
		margin-right: 4px;
		padding: 1px 7px;
		border-radius: 999px;
		font-size: var(--fs-xs);
		font-weight: 600;
		background: var(--warn-bg);
		color: var(--warn-text);
		white-space: nowrap;
	}
	.chip.bounce,
	.chip.spike {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		color: var(--accent);
	}
</style>
