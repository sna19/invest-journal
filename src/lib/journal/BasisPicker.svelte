<script lang="ts">
	import HelpIcon from '../HelpIcon.svelte';
	import { tx } from '../i18n.js';

	/** Д-16: the basis of a decision — exactly one: intuition, a source's hypothesis, the model, the consensus, mixed */
	let { basis = $bindable('') }: { basis: string } = $props();
	const BASES: [string, string, string][] = [
		['intuition', 'Интуиция', 'Intuition'],
		['hypothesis', 'Гипотеза', 'Hypothesis'],
		['model', 'Модель', 'Model'],
		['consensus', 'Консенсус', 'Consensus'],
		['mixed', 'Смешанное', 'Mixed']
	];
</script>

<div class="basis">
	<span class="lbl">{tx('Основание', 'Basis')} <HelpIcon topicKey="decision.basis" label={tx('основание решения', 'basis of a decision')} /></span>
	<div class="chips" role="radiogroup" aria-label={tx('Основание', 'Basis')}>
		{#each BASES as [k, ru, en] (k)}
			<button type="button" role="radio" aria-checked={basis === k} class:on={basis === k} onclick={() => (basis = k)}>{tx(ru, en)}</button>
		{/each}
	</div>
</div>

<style>
	.basis {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
	}
	.lbl {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chips button {
		min-height: 34px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.chips button.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
</style>
