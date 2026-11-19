<script lang="ts">
	import { tx } from '#lib/i18n.js';
	import type { Score } from './stats.js';
	import HelpIcon from './HelpIcon.svelte';

	/**
	 * Spec section 7 — a source's hit rate: below 10 closed only a count («мало данных», grey, no percent);
	 * 10–29 — percent with its 95% interval and «предварительно»; 30 and more — percent with the interval.
	 */
	let { score, help = false }: { score: Score; help?: boolean } = $props();
	const pct = (x: number) => Math.round(x * 100);
</script>

{#if score.level === 'none'}
	<span class="none">{tx('нет закрытых', 'none closed')}</span>
{:else if score.level === 'few'}
	<span class="few"
		>{tx('мало данных', 'few data')} · {score.hits} {tx('из', 'of')} {score.n}{#if help}<HelpIcon topicKey="source.threshold" label={tx('мало данных', 'few data')} />{/if}</span
	>
{:else}
	<span class="rate">
		<b>{pct(score.rate!)}%</b>
		<span class="ci">{pct(score.ci![0])}–{pct(score.ci![1])}%</span>
		{#if score.level === 'prelim'}<span class="prelim">{tx('предварительно', 'preliminary')}</span>{/if}
	</span>
{/if}

<style>
	.none,
	.few {
		color: var(--muted);
		font-size: var(--fs-s);
		white-space: nowrap;
	}
	.few {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px var(--s2);
		border-radius: var(--r-pill);
		background: var(--surface-2);
	}
	.rate {
		display: inline-flex;
		align-items: baseline;
		gap: var(--s1);
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.rate b {
		font-size: var(--fs-l);
	}
	.ci {
		color: var(--muted);
		font-size: var(--fs-s);
		white-space: nowrap;
	}
	.prelim {
		font-size: var(--fs-xs);
		color: var(--warn-text);
		background: var(--warn-bg);
		padding: 1px var(--s2);
		border-radius: var(--r-pill);
	}
</style>
