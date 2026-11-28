<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { tx } from './i18n.js';

	/**
	 * Owner 28.11.2026: «навигация требует скроллинга — выставить наверху строчку линков к нужному параграфу». Under
	 * every screen's title: a row of the screen's blocks (the folds), sticky at the top while scrolling; a tap opens the
	 * block if folded and scrolls to it; the block in view is marked. Shown where a screen has 4 blocks or more.
	 */
	type Item = { el: HTMLElement; label: string };
	let items = $state<Item[]>([]);
	let current = $state(-1);
	let row: HTMLElement | undefined = $state();

	function collect() {
		const all = [...document.querySelectorAll<HTMLElement>('main section.fold')].filter((s) => !s.parentElement?.closest('section.fold'));
		items = all
			.map((el) => ({ el, label: (el.querySelector(':scope > .bar h2')?.textContent ?? '').split(' · ')[0].trim() }))
			.filter((x) => x.label);
		tickN++;
	}
	let timer: ReturnType<typeof setTimeout>;
	const later = () => {
		clearTimeout(timer);
		timer = setTimeout(collect, 150);
	};
	function onScroll() {
		const y = (row?.getBoundingClientRect().bottom ?? 0) + 12;
		let k = -1;
		items.forEach((it, i) => {
			if (it.el.getBoundingClientRect().top <= y) k = i;
		});
		if (k !== current) {
			current = k;
			// keep the marked chip in sight in the row
			const chip = row?.querySelectorAll<HTMLElement>('button')[k + 1];
			if (row && chip) row.scrollTo({ left: Math.max(0, chip.offsetLeft - 48), behavior: 'smooth' });
		}
	}
	// owner 28.11.2026: «свернуть всё» — every block of the screen folded (or unfolded) at once
	let tickN = $state(0);
	const allClosed = () => items.length > 0 && items.every((it) => it.el.classList.contains('closed'));
	function foldAll(close: boolean) {
		for (const it of items) {
			const closed = it.el.classList.contains('closed');
			if (closed !== close) it.el.querySelector<HTMLButtonElement>(':scope > .bar button.title')?.click();
		}
		tickN++;
		window.scrollTo({ top: 0 });
	}
	async function go(it: Item) {
		const btn = it.el.querySelector<HTMLButtonElement>(':scope > .bar button.title');
		if (it.el.classList.contains('closed')) btn?.click();
		await tick();
		const top = it.el.getBoundingClientRect().top + window.scrollY - (row?.offsetHeight ?? 0) - 8;
		window.scrollTo({ top, behavior: 'smooth' });
	}
	onMount(() => {
		collect();
		const mo = new MutationObserver(later);
		const main = document.querySelector('main');
		// a block folded or unfolded by hand (its class) — the row's «fold all» follows
		if (main) mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			mo.disconnect();
			window.removeEventListener('scroll', onScroll);
			clearTimeout(timer);
		};
	});
	afterNavigate(() => setTimeout(collect, 300));
</script>

{#if items.length >= 4}
	<nav class="sn" bind:this={row} aria-label={tx('Разделы экрана', 'The screen\'s sections')}>
		<button class="up" aria-label={tx('Наверх', 'To the top')} onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>
		{#key tickN}<button class="fold" onclick={() => foldAll(!allClosed())}>{allClosed() ? tx('⊞ Развернуть всё', '⊞ Unfold all') : tx('⊟ Свернуть всё', '⊟ Fold all')}</button>{/key}
		{#each items as it, i (i)}
			<button class:on={i === current} onclick={() => go(it)}>{it.label}</button>
		{/each}
	</nav>
{/if}

<style>
	.sn {
		position: sticky;
		top: 0;
		z-index: 12;
		display: flex;
		gap: 6px;
		overflow-x: auto;
		margin: 0 calc(-1 * var(--s4)) var(--s3);
		padding: 6px var(--s4);
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		scrollbar-width: none;
	}
	.sn::-webkit-scrollbar {
		display: none;
	}
	button {
		flex: none;
		min-height: 30px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-xs);
		white-space: nowrap;
		cursor: pointer;
	}
	button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.fold {
		color: var(--link);
	}
	.up {
		padding: 0 10px;
		color: var(--muted);
	}
</style>
