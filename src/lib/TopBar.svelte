<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import HelpIcon from './HelpIcon.svelte';
	import { loadReminders, rem } from './reminders.svelte.js';
	import SectionNav from './SectionNav.svelte';

	/** A screen's title with its «?» (spec section 8), an optional way back and actions on the right. */
	interface Props {
		title: string;
		help?: string;
		back?: { href: string; label: string };
		actions?: Snippet;
		subtitle?: string;
		/** T-019: the screen's «Напоминание» line under the title (by default the help topic's own) */
		remind?: string | false;
	}
	let { title, help, back, actions, subtitle, remind }: Props = $props();
	const rkey = $derived(remind === false ? null : (remind ?? help ?? null));
	$effect(() => {
		if (rkey) loadReminders();
	});
</script>

<header>
	{#if back}<a class="back" href={back.href}><ChevronLeft size={22} />{back.label}</a>{/if}
	<div class="row">
		<h1>{title}</h1>
		{#if help}<HelpIcon topicKey={help} label={title} />{/if}
		<span class="grow"></span>
		{@render actions?.()}
	</div>
	{#if subtitle}<p>{subtitle}</p>{/if}
	{#if rkey && rem.show && rem.items[rkey]}<div class="remind"><HelpIcon topicKey={rkey} text={rem.items[rkey]} /></div>{/if}
</header>
<!-- owner 28.11.2026: the screen's blocks as links, sticky at the top (shown where there are 4 blocks or more) -->
<SectionNav />

<style>
	.remind {
		margin-top: 2px;
	}
	header {
		padding: calc(env(safe-area-inset-top) + var(--s3)) 0 var(--s3);
	}
	.back {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		margin-left: -6px;
		color: var(--text);
		text-decoration: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--s3);
	}
	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		line-height: 1.15;
	}
	.grow {
		flex: 1;
	}
	p {
		margin: var(--s1) 0 0;
		color: var(--muted);
		font-size: var(--fs-s);
	}
</style>
