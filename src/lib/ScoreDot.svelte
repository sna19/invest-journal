<script lang="ts">
	import { tx } from './i18n.js';
	import { scores, wantScore } from './score.svelte.js';

	/** T-034: the quant score's colour next to a ticker (lists: not a button — the row opens the card) */
	let { id }: { id: number } = $props();
	$effect(() => wantScore(id));
	const s = $derived(scores[id]);
	const NAME = { green: ['сильная', 'strong'], yellow: ['смешанная', 'mixed'], red: ['слабая', 'weak'], grey: ['мало данных', 'little data'] } as const;
</script>

{#if s && s.market}<i class="dot {s.color}" title={`${tx('Квант-оценка', 'Quant score')}: ${tx(NAME[s.color][0], NAME[s.color][1])}${s.total !== null && s.color !== 'grey' ? ` ${Math.round(s.total * 100)}` : ''}`} aria-label={`${tx('Квант-оценка', 'Quant score')}: ${tx(NAME[s.color][0], NAME[s.color][1])}`}></i>{/if}

<style>
	.dot {
		display: inline-block;
		flex: none;
		width: 10px;
		height: 10px;
		margin: 0 4px;
		border-radius: 50%;
		vertical-align: middle;
	}
	.green {
		background: var(--up);
	}
	.yellow {
		background: #d9a400;
	}
	.red {
		background: var(--down);
	}
	.grey {
		background: var(--line);
		box-shadow: inset 0 0 0 1px var(--muted);
	}
</style>
