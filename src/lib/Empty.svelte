<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Spec section 13 — an empty screen says what will appear here and offers the next step. */
	let { title, children, action }: { title: string; children: Snippet; action?: Snippet } = $props();
</script>

<section class="empty">
	<h2>{title}</h2>
	<div class="text">{@render children()}</div>
	{#if action}<div class="action">{@render action()}</div>{/if}
</section>

<style>
	.empty {
		margin-top: var(--s5);
		padding: var(--s5) var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
		text-align: center;
	}
	h2 {
		margin: 0 0 var(--s2);
		font-size: var(--fs-l);
	}
	.text {
		color: var(--muted);
		line-height: 1.5;
	}
	.action {
		margin-top: var(--s4);
	}
	.action :global(a),
	.action :global(button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		padding: 0 var(--s4);
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		text-decoration: none;
	}
</style>
