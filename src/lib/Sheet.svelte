<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';

	/**
	 * Spec section 13 — a bottom sheet: cards, forms and help on the phone open from below and close by a swipe
	 * down, the ×, Esc or a tap on the dimmed page.
	 */
	interface Props {
		title: string;
		onclose: () => void;
		children: Snippet;
		/** id of the title, for aria-labelledby */
		id?: string;
	}
	let { title, onclose, children, id = `sheet-${Math.random().toString(36).slice(2)}` }: Props = $props();

	let dy = $state(0);
	let startY: number | null = null;

	function down(e: PointerEvent) {
		startY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (startY !== null) dy = Math.max(0, e.clientY - startY);
	}
	function up() {
		if (startY === null) return;
		startY = null;
		if (dy > 80) onclose();
		dy = 0;
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby={id} style:transform={dy ? `translateY(${dy}px)` : undefined}>
	<div class="grab" role="presentation" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
		<span class="handle"></span>
		<div class="head">
			<h2 {id}>{title}</h2>
			<button class="close" aria-label="Закрыть" onclick={onclose}><X size={22} /></button>
		</div>
	</div>
	<div class="body">{@render children()}</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 20;
		background: var(--scrim);
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 21;
		max-width: 640px;
		max-height: 85vh;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border-radius: var(--r3) var(--r3) 0 0;
		box-shadow: var(--shadow);
		padding-bottom: env(safe-area-inset-bottom);
		transition: transform 0.15s;
	}
	.grab {
		touch-action: none;
		padding: var(--s2) var(--s4) 0;
		cursor: grab;
	}
	.handle {
		display: block;
		width: 40px;
		height: 5px;
		margin: 0 auto var(--s2);
		border-radius: var(--r-pill);
		background: var(--line);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
	}
	h2 {
		margin: 0;
		font-size: var(--fs-l);
	}
	.close {
		width: var(--tap);
		height: var(--tap);
		margin-right: calc(-1 * var(--s2));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: var(--r2);
		background: none;
		cursor: pointer;
	}
	.body {
		overflow-y: auto;
		padding: var(--s2) var(--s4) var(--s5);
		-webkit-overflow-scrolling: touch;
	}
</style>
