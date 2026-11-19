<script lang="ts">
	import { tx } from '#lib/i18n.js';
	import { hideToast, toast } from './toast.svelte.js';

	function undo() {
		const u = 'undo' in toast ? toast.undo : undefined;
		hideToast();
		u?.();
	}
</script>

{#if toast.text}
	<div class="toast" role="status" aria-live="polite">
		<span>{toast.text}</span>
		{#if 'undo' in toast && toast.undo}<button onclick={undo}>{tx('Отменить', 'Undo')}</button>{/if}
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		left: var(--s4);
		right: var(--s4);
		bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + var(--s3));
		z-index: 25;
		max-width: 600px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: var(--s3);
		padding: var(--s2) var(--s2) var(--s2) var(--s4);
		border-radius: var(--r2);
		background: var(--text);
		color: var(--bg);
		box-shadow: var(--shadow);
	}
	span {
		flex: 1;
	}
	button {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: none;
		border-radius: var(--r1);
		background: none;
		color: var(--bg);
		font-weight: 700;
		cursor: pointer;
	}
</style>
