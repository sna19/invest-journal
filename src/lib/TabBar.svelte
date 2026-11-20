<script lang="ts">
	import { page } from '$app/state';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Newspaper from '@lucide/svelte/icons/newspaper';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import { t } from './i18n.js';

	/** Spec sections 13 and 18 — five tabs at the bottom («Портфель» first) and «+» (new hypothesis) above them. */
	const tabs = [
		{ href: '/portfolio', label: 'tab.portfolio' as const, icon: Briefcase, match: (p: string) => p.startsWith('/portfolio') },
		{ href: '/', label: 'tab.hypotheses' as const, icon: NotebookPen, match: (p: string) => p === '/' || p.startsWith('/hypotheses') },
		{ href: '/sources', label: 'tab.sources' as const, icon: Newspaper, match: (p: string) => p.startsWith('/sources') },
		{ href: '/stats', label: 'tab.stats' as const, icon: ChartColumn, match: (p: string) => p.startsWith('/stats') },
		{ href: '/more', label: 'tab.more' as const, icon: Ellipsis, match: (p: string) => inMore(p) }
	];
	const path = $derived(page.url.pathname);

	// «Ещё» returns to the screen last open inside it (owner's request 20.11.2026): a tap from another tab goes
	// back to the model, settings, … where he was; a tap while inside opens the «Ещё» menu itself
	const MORE = ['/more', '/tickers', '/settings', '/account', '/model'];
	const inMore = (p: string) => MORE.some((x) => p === x || p.startsWith(x + '/'));
	let moreLast = $state('/more');
	$effect(() => {
		try {
			if (inMore(path)) localStorage.setItem('more-last', path + page.url.search);
			else moreLast = localStorage.getItem('more-last') ?? '/more';
		} catch {
			/* private mode */
		}
	});

	// «+» hides while the page scrolls down and comes back on the way up or at the end: it never covers data for long
	let hidden = $state(false);
	let lastY = 0;
	function onScroll() {
		const y = window.scrollY;
		const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 8;
		if (Math.abs(y - lastY) > 6) hidden = y > lastY && y > 40 && !atEnd;
		lastY = y;
	}
</script>

<svelte:window onscroll={onScroll} />

{#if !path.startsWith('/new')}
	<a class="plus" class:hidden href="/new" aria-label={t('tab.new')} title={t('tab.new')}><Plus size={26} strokeWidth={2.4} /></a>
{/if}
<nav class="tabbar" aria-label={t('tab.sections')}>
	{#each tabs as tab (tab.href)}
		{@const on = tab.match(path)}
		<a href={tab.href === '/more' && !on ? moreLast : tab.href} class:on aria-current={on ? 'page' : undefined}>
			<tab.icon size={24} strokeWidth={on ? 2.3 : 1.8} />
			<span>{t(tab.label)}</span>
		</a>
	{/each}
</nav>

<style>
	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		padding: var(--s1) var(--s2) env(safe-area-inset-bottom);
		background: color-mix(in oklab, var(--surface) 88%, transparent);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		border-top: 1px solid var(--line);
	}
	a {
		min-height: 50px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		color: var(--muted);
		font-size: 11px;
		text-decoration: none;
	}
	a.on {
		color: var(--text);
		font-weight: 600;
	}
	.plus {
		position: fixed;
		right: var(--s4);
		bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + var(--s3));
		z-index: 11;
		width: 56px;
		height: 56px;
		border-radius: var(--r-pill);
		background: var(--accent);
		color: var(--accent-text);
		box-shadow: var(--shadow);
		flex-direction: row;
		transition: transform 0.2s, opacity 0.2s;
	}
	.plus.hidden {
		transform: translateY(24px) scale(0.6);
		opacity: 0;
		pointer-events: none;
	}
</style>
