<script lang="ts">
	import { onMount } from 'svelte';
	import Bold from '@lucide/svelte/icons/bold';
	import Italic from '@lucide/svelte/icons/italic';
	import Underline from '@lucide/svelte/icons/underline';
	import Strikethrough from '@lucide/svelte/icons/strikethrough';
	import List from '@lucide/svelte/icons/list';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Baseline from '@lucide/svelte/icons/baseline';
	import Highlighter from '@lucide/svelte/icons/highlighter';
	import RemoveFormatting from '@lucide/svelte/icons/remove-formatting';
	import { tx } from '../i18n.js';
	import { HIGHLIGHTS, TEXT_COLORS } from './palette.js';

	/**
	 * T-032, the diary's rich text (owner 26.11.2026: «выделять, красить и подкрашивать»): select words and make them
	 * bold, italic, underlined or struck, paint them with a colour, highlight them, make a list; «Т×» clears. The buttons
	 * keep the selection (on an iPhone a tap elsewhere would drop it). A paste comes in as plain text. The server keeps
	 * only these marks and the palette's colours.
	 */
	interface Props {
		value: string;
		placeholder?: string;
		autofocus?: boolean;
		minHeight?: string;
	}
	let { value = $bindable(''), placeholder = '', autofocus = false, minHeight = '8em' }: Props = $props();
	let el = $state<HTMLDivElement>();
	let menu = $state<'color' | 'high' | null>(null);
	let active = $state<Record<string, boolean>>({});

	onMount(() => {
		if (el && el.innerHTML !== value) el.innerHTML = value;
		if (autofocus) el?.focus();
		const onSel = () => {
			if (!el || !document.activeElement || !el.contains(document.activeElement)) return;
			active = Object.fromEntries(['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].map((c) => [c, safeState(c)]));
		};
		document.addEventListener('selectionchange', onSel);
		return () => document.removeEventListener('selectionchange', onSel);
	});
	// a value set from outside (a draft restored, the composer reset) shows in the editor
	$effect(() => {
		if (el && document.activeElement !== el && el.innerHTML !== value) el.innerHTML = value;
	});

	function safeState(c: string) {
		try {
			return document.queryCommandState(c);
		} catch {
			return false;
		}
	}
	function cmd(c: string, arg?: string) {
		el?.focus();
		document.execCommand('styleWithCSS', false, 'true');
		if (c === 'hiliteColor' && !document.execCommand('hiliteColor', false, arg)) document.execCommand('backColor', false, arg);
		else if (c !== 'hiliteColor') document.execCommand(c, false, arg);
		// «без цвета»: the marker colour is taken off again, the text gets the theme's own
		if (arg === '#000001' || arg === 'transparent')
			for (const n of el?.querySelectorAll<HTMLElement>('[style]') ?? []) {
				if (/rgb\(0, 0, 1\)|#000001/.test(n.style.color)) n.style.removeProperty('color');
				if (/transparent|rgba\(0, 0, 0, 0\)/.test(n.style.backgroundColor)) n.style.removeProperty('background-color');
				if (!n.getAttribute('style')) n.removeAttribute('style');
			}
		menu = null;
		sync();
	}
	function sync() {
		if (el) value = el.innerHTML === '<br>' ? '' : el.innerHTML;
	}
	function paste(e: ClipboardEvent) {
		e.preventDefault();
		document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
	}
	// the buttons do not take the focus: the selection stays
	const keep = (e: Event) => e.preventDefault();
</script>

<div class="rich">
	<div class="bar" role="toolbar" aria-label={tx('Оформление', 'Formatting')}>
		<button type="button" class:on={active.bold} onpointerdown={keep} onclick={() => cmd('bold')} aria-label={tx('Жирный', 'Bold')} title={tx('Жирный', 'Bold')}><Bold size={18} /></button>
		<button type="button" class:on={active.italic} onpointerdown={keep} onclick={() => cmd('italic')} aria-label={tx('Курсив', 'Italic')} title={tx('Курсив', 'Italic')}><Italic size={18} /></button>
		<button type="button" class:on={active.underline} onpointerdown={keep} onclick={() => cmd('underline')} aria-label={tx('Подчёркнутый', 'Underline')} title={tx('Подчёркнутый', 'Underline')}><Underline size={18} /></button>
		<button type="button" class:on={active.strikeThrough} onpointerdown={keep} onclick={() => cmd('strikeThrough')} aria-label={tx('Зачёркнутый', 'Strikethrough')} title={tx('Зачёркнутый', 'Strikethrough')}><Strikethrough size={18} /></button>
		<span class="sep"></span>
		<button type="button" class:on={menu === 'color'} onpointerdown={keep} onclick={() => (menu = menu === 'color' ? null : 'color')} aria-label={tx('Цвет текста', 'Text colour')} title={tx('Цвет текста', 'Text colour')}><Baseline size={18} /></button>
		<button type="button" class:on={menu === 'high'} onpointerdown={keep} onclick={() => (menu = menu === 'high' ? null : 'high')} aria-label={tx('Подсветка', 'Highlight')} title={tx('Подсветка', 'Highlight')}><Highlighter size={18} /></button>
		<span class="sep"></span>
		<button type="button" class:on={active.insertUnorderedList} onpointerdown={keep} onclick={() => cmd('insertUnorderedList')} aria-label={tx('Список', 'List')} title={tx('Список', 'List')}><List size={18} /></button>
		<button type="button" class:on={active.insertOrderedList} onpointerdown={keep} onclick={() => cmd('insertOrderedList')} aria-label={tx('Нумерованный список', 'Numbered list')} title={tx('Нумерованный список', 'Numbered list')}><ListOrdered size={18} /></button>
		<button type="button" onpointerdown={keep} onclick={() => cmd('removeFormat')} aria-label={tx('Убрать оформление', 'Clear formatting')} title={tx('Убрать оформление', 'Clear formatting')}><RemoveFormatting size={18} /></button>
	</div>
	{#if menu}
		<div class="swatches" role="group" aria-label={menu === 'color' ? tx('Цвет текста', 'Text colour') : tx('Подсветка', 'Highlight')}>
			{#each menu === 'color' ? TEXT_COLORS : HIGHLIGHTS as [c, ru, en] (c)}
				<button type="button" class="sw" class:high={menu === 'high'} style="--c: {c}" onpointerdown={keep} onclick={() => cmd(menu === 'color' ? 'foreColor' : 'hiliteColor', c)} aria-label={tx(ru, en)} title={tx(ru, en)}>{menu === 'color' ? 'A' : ''}</button>
			{/each}
			<button type="button" class="sw none" onpointerdown={keep} onclick={() => (menu === 'color' ? cmd('foreColor', '#000001') : cmd('hiliteColor', 'transparent'))} aria-label={tx('Без цвета', 'No colour')} title={tx('Без цвета', 'No colour')}>∅</button>
		</div>
	{/if}
	<div
		bind:this={el}
		class="area"
		contenteditable="true"
		role="textbox"
		aria-multiline="true"
		tabindex="0"
		data-placeholder={placeholder}
		style="min-height: {minHeight}"
		oninput={sync}
		onblur={sync}
		onpaste={paste}
	></div>
</div>

<style>
	.rich {
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0;
		padding: 2px;
		border-bottom: 1px solid var(--line);
	}
	.bar button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 32px;
		min-height: 36px;
		padding: 0;
		border: none;
		border-radius: var(--r1);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.bar button.on {
		background: var(--surface-2);
		color: var(--accent);
	}
	.sep {
		width: 1px;
		height: 20px;
		background: var(--line);
		margin: 0 2px;
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 6px;
		border-bottom: 1px solid var(--line);
	}
	.sw {
		width: 34px;
		height: 34px;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: var(--surface);
		color: var(--c);
		font-weight: 700;
		cursor: pointer;
	}
	.sw.high {
		background: var(--c);
	}
	.sw.none {
		color: var(--muted);
	}
	.area {
		padding: var(--s2) var(--s3);
		outline: none;
		color: var(--text);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.area:empty::before {
		content: attr(data-placeholder);
		color: var(--muted);
	}
	.area :global(p),
	.area :global(div) {
		margin: 0;
	}
	.area :global(ul),
	.area :global(ol) {
		margin: 0;
		padding-left: 1.3em;
	}
	/* a highlight stays readable in the dark theme */
	.area :global(span[style*='background-color']) {
		color: #1a1a1a;
		border-radius: 3px;
		padding: 0 2px;
	}
</style>
