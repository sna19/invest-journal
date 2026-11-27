<script lang="ts" generics="K extends string">
	import type { Snippet } from 'svelte';
	import type { TableSort } from './tablesort.svelte.js';

	/** the button inside a table's header cell (owner 27.11.2026): a tap sorts the table by this column, ↓ / ↑ shows how */
	interface Props {
		s: TableSort<K>;
		k: K;
		/** the first tap's direction: numbers — the biggest first (true), text — A to Z (false) */
		desc?: boolean;
		title?: string;
		children: Snippet;
	}
	let { s, k, desc = true, title, children }: Props = $props();
	const on = $derived(s.key === k);
</script>

<button type="button" class:on {title} aria-label={title} aria-pressed={on} onclick={() => s.by(k, desc)}>{@render children()}<span class="ar" aria-hidden="true">{on ? (s.desc ? '↓' : '↑') : ''}</span></button>

<style>
	button {
		all: unset;
		cursor: pointer;
		white-space: nowrap;
		-webkit-tap-highlight-color: transparent;
	}
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.on {
		color: var(--link);
	}
	.ar {
		display: inline-block;
		min-width: 0.7em;
		margin-left: 1px;
	}
</style>
