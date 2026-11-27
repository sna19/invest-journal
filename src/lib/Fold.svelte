<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import HelpIcon from './HelpIcon.svelte';
	import { loadReminders, rem } from './reminders.svelte.js';

	/**
	 * A section that folds and unfolds (owner's request 20.11.2026: «аккордеоны для всех разделов»). The state is
	 * remembered on this device per `key`; `aside` — what stays beside the title (a «?»), `summary` — a short line
	 * shown while folded.
	 */
	interface Props {
		key: string;
		title: string;
		open?: boolean;
		aside?: Snippet;
		summary?: string;
		/** inside a card of its own (a draggable block): no background and padding */
		bare?: boolean;
		/** T-019: the help topic whose «Напоминание» line stands under the title (a tap opens the topic) */
		remind?: string;
		children: Snippet;
	}
	let { key, title, open: start = true, aside, summary, bare = false, remind, children }: Props = $props();
	$effect(() => {
		if (remind) loadReminders();
	});
	let open = $state(true);
	const storeKey = () => `fold:${key}`;
	onMount(() => {
		open = start;
		try {
			const v = localStorage.getItem(storeKey());
			if (v === '1' || v === '0') open = v === '1';
		} catch {
			/* private mode */
		}
	});
	function toggle() {
		open = !open;
		try {
			localStorage.setItem(storeKey(), open ? '1' : '0');
		} catch {
			/* private mode */
		}
	}
	const bodyId = `fold-${Math.random().toString(36).slice(2)}`;
</script>

<section class="fold" class:closed={!open} class:bare>
	<div class="bar">
		<button class="title" aria-expanded={open} aria-controls={bodyId} onclick={toggle}>
			<span class="chev" class:open><ChevronDown size={18} /></span>
			<h2>{title}</h2>
		</button>
		{#if aside}{@render aside()}{/if}
	</div>
	{#if remind && rem.show && rem.items[remind]}<div class="remind"><HelpIcon topicKey={remind} text={rem.items[remind]} /></div>{/if}
	{#if !open && summary}<button class="sum muted small" onclick={toggle}>{summary}</button>{/if}
	<div id={bodyId} hidden={!open}>
		{@render children()}
	</div>
</section>

<style>
	.fold {
		margin: 0 0 var(--s4);
		padding: var(--s2) var(--s4) var(--s3);
		border-radius: var(--r3);
		background: var(--surface);
	}
	.fold.bare {
		margin: 0;
		padding: 0;
		background: none;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: var(--s2);
	}
	.title {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--s2);
		min-height: var(--tap);
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	h2 {
		margin: 0;
		font-size: var(--fs-l, 1.1rem);
	}
	.chev {
		display: inline-flex;
		color: var(--muted);
		transform: rotate(-90deg);
		transition: transform 0.15s;
	}
	.chev.open {
		transform: none;
	}
	.remind {
		padding: 0 0 var(--s1) calc(18px + var(--s2));
	}
	.sum {
		display: block;
		width: 100%;
		padding: 0 0 var(--s1) calc(18px + var(--s2));
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	@media (prefers-reduced-motion: reduce) {
		.chev {
			transition: none;
		}
	}
</style>
