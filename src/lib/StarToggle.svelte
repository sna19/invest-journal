<script lang="ts">
	import { tx } from './i18n.js';
	import { picked, setPicked, wantPicked } from './picked.svelte.js';

	/** ☆ / ★ — pick a security right from a list (owner 27.11.2026) */
	let { id, origin = 'список', symbol = '' }: { id: number; origin?: string; symbol?: string } = $props();
	$effect(() => wantPicked());
	const on = $derived(picked.ids.has(id));
</script>

<button
	type="button"
	class="star"
	class:on
	aria-pressed={on}
	aria-label={on ? tx(`Снять отметку ${symbol}`, `Unpick ${symbol}`) : tx(`Отметить ${symbol}`, `Pick ${symbol}`)}
	onclick={(e) => (e.preventDefault(), e.stopPropagation(), void setPicked(id, !on, origin))}>{on ? '★' : '☆'}</button
>

<style>
	.star {
		flex: none;
		min-width: 32px;
		min-height: 32px;
		border: none;
		background: none;
		font-size: 1.15rem;
		line-height: 1;
		color: var(--muted);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.star.on {
		color: var(--warn-text, #b8860b);
	}
</style>
