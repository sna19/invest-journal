<script lang="ts">
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import X from '@lucide/svelte/icons/x';
	import Sheet from './Sheet.svelte';
	import { help, loadTopic, type HelpTopic } from './help.svelte.js';

	/**
	 * Spec section 8 — the «?» next to a screen title, a list or a field. One shared component; the text lives
	 * in help/<topicKey>.md (a test fails if the file is missing). Phone: a bottom panel; computer: a window
	 * next to the icon. Esc, × or a tap elsewhere closes it; opening one closes any other.
	 */
	interface Props {
		topicKey: string;
		/** what the icon explains, for screen readers, e.g. «Поиск тикера» */
		label?: string;
	}
	let { topicKey, label }: Props = $props();

	const id = `help-${Math.random().toString(36).slice(2)}`;
	const open = $derived(help.open === id);
	let topic = $state<HelpTopic | null>(null);
	let failed = $state(false);
	let btn: HTMLButtonElement;
	let pop = $state<HTMLDivElement>();
	let pos = $state({ top: 0, left: 0 });
	let wide = $state(false);

	async function toggle() {
		if (open) return close();
		wide = window.matchMedia('(min-width: 700px) and (hover: hover)').matches;
		if (wide) {
			const r = btn.getBoundingClientRect();
			const w = 360;
			pos = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left - w / 2 + r.width / 2, window.innerWidth - w - 8)) };
		}
		help.open = id;
		failed = false;
		try {
			topic = await loadTopic(topicKey);
		} catch {
			failed = true;
		}
	}

	function close() {
		if (help.open === id) help.open = null;
		btn?.focus();
	}

	function outside(e: PointerEvent) {
		if (!open || !wide) return;
		const t = e.target as Node;
		if (!pop?.contains(t) && !btn.contains(t)) close();
	}
</script>

<svelte:window onkeydown={(e) => open && wide && e.key === 'Escape' && close()} onpointerdown={outside} />

<button
	bind:this={btn}
	class="help"
	type="button"
	aria-label="Справка{label ? `: ${label}` : ''}"
	aria-expanded={open}
	title="Справка"
	onclick={toggle}><CircleHelp size={18} /></button
>

{#if open}
	{#if wide}
		<div bind:this={pop} class="pop" role="dialog" aria-labelledby="{id}-t" style:top="{pos.top}px" style:left="{pos.left}px">
			<div class="pop-head">
				<h2 id="{id}-t">{topic?.title ?? 'Справка'}</h2>
				<button class="x" aria-label="Закрыть" onclick={close}><X size={20} /></button>
			</div>
			{@render body()}
		</div>
	{:else}
		<Sheet title={topic?.title ?? 'Справка'} onclose={close}>{@render body()}</Sheet>
	{/if}
{/if}

{#snippet body()}
	{#if failed}
		<p class="muted">Справка не загрузилась — проверьте связь.</p>
	{:else if topic}
		<div class="md">{@html topic.html}</div>
	{:else}
		<div class="skeleton"></div>
		<div class="skeleton short"></div>
	{/if}
{/snippet}

<style>
	.help {
		/* the icon is small, the touch target is 44 × 44 */
		width: var(--tap);
		height: var(--tap);
		margin: calc((var(--tap) - 24px) / -2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		vertical-align: middle;
		border: none;
		border-radius: var(--r-pill);
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.help[aria-expanded='true'] {
		color: var(--accent);
	}
	.pop {
		position: fixed;
		z-index: 30;
		width: 360px;
		max-height: 60vh;
		overflow-y: auto;
		padding: var(--s3) var(--s4) var(--s4);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		box-shadow: var(--shadow);
	}
	.pop-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.pop h2 {
		margin: 0;
		font-size: var(--fs-m);
	}
	.x {
		width: 36px;
		height: 36px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: var(--r1);
		background: none;
		cursor: pointer;
	}
	.md {
		font-size: var(--fs-s);
		line-height: 1.5;
	}
	.md :global(p) {
		margin: var(--s2) 0;
	}
	.md :global(ul) {
		padding-left: var(--s5);
	}
	.muted {
		color: var(--muted);
	}
	.skeleton {
		height: 14px;
		margin: var(--s3) 0;
		border-radius: var(--r1);
		background: var(--surface-2);
	}
	.skeleton.short {
		width: 60%;
	}
</style>
