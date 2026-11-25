<script lang="ts">
	import { tx } from './i18n.js';

	/** T-023: what a purchase does to the portfolio's risk — «снижает риск» / «нейтрально» / «дублирует X» */
	interface Props {
		label: string;
		twin?: string | null;
		small?: boolean;
	}
	let { label, twin = null, small = false }: Props = $props();
</script>

{#if label === 'reduces'}
	<span class="rl good" class:small>{tx('снижает риск', 'reduces risk')}</span>
{:else if label === 'duplicates'}
	<span class="rl bad" class:small>{tx('дублирует', 'duplicates')} {twin ?? ''}</span>
{:else if label === 'neutral'}
	<span class="rl" class:small>{tx('нейтрально', 'neutral')}</span>
{:else if label === 'held'}
	<span class="rl" class:small>{tx('уже в портфеле', 'already held')}</span>
{:else if label === 'loading'}
	<span class="rl" class:small>{tx('риск: история грузится', 'risk: history loading')}</span>
{/if}

<style>
	.rl {
		display: inline-block;
		padding: 1px 8px;
		border-radius: var(--r-pill);
		border: 1px solid var(--line);
		font-size: var(--fs-xs);
		color: var(--muted);
		white-space: nowrap;
	}
	.rl.small {
		padding: 0 6px;
	}
	.good {
		color: var(--up);
		border-color: color-mix(in srgb, var(--up) 50%, transparent);
	}
	.bad {
		color: var(--down);
		border-color: color-mix(in srgb, var(--down) 50%, transparent);
	}
</style>
