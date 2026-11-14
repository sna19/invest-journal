<script lang="ts">
	import { page } from '$app/state';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Newspaper from '@lucide/svelte/icons/newspaper';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';

	/** Spec section 13 — four tabs at the bottom and «+» (new hypothesis) above them, on every screen. */
	const tabs = [
		{ href: '/', label: 'Гипотезы', icon: NotebookPen, match: (p: string) => p === '/' || p.startsWith('/hypotheses') },
		{ href: '/sources', label: 'Источники', icon: Newspaper, match: (p: string) => p.startsWith('/sources') },
		{ href: '/stats', label: 'Статистика', icon: ChartColumn, match: (p: string) => p.startsWith('/stats') },
		{ href: '/more', label: 'Ещё', icon: Ellipsis, match: (p: string) => ['/more', '/tickers', '/settings'].some((x) => p.startsWith(x)) }
	];
	const path = $derived(page.url.pathname);
</script>

{#if !path.startsWith('/new')}
	<a class="plus" href="/new" aria-label="Новая гипотеза" title="Новая гипотеза"><Plus size={26} strokeWidth={2.4} /></a>
{/if}
<nav class="tabbar" aria-label="Разделы">
	{#each tabs as t (t.href)}
		{@const on = t.match(path)}
		<a href={t.href} class:on aria-current={on ? 'page' : undefined}>
			<t.icon size={24} strokeWidth={on ? 2.3 : 1.8} />
			<span>{t.label}</span>
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
		grid-template-columns: repeat(4, 1fr);
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
	}
</style>
