<script lang="ts">
	import { page } from '$app/state';
	import { tx } from './i18n.js';

	/**
	 * Tickers, the model and the picked securities side by side (owner's request 26.11.2026: «остаться на экране
	 * тикеров и в то же время работать в квартальной модели»): one tap between them, each keeps its own state.
	 */
	const items = [
		['/tickers', 'Тикеры', 'Tickers'],
		['/screener', 'Скринер', 'Screener'],
		['/countries', 'Страны', 'Countries'],
		['/model', 'Модель', 'Model'],
		['/shortlist', 'Отмеченные', 'Picked']
	] as const;
</script>

<nav class="sw" aria-label={tx('Экраны', 'Screens')}>
	{#each items as [href, ru, en] (href)}
		<a {href} class:on={page.url.pathname === href} aria-current={page.url.pathname === href ? 'page' : undefined}>{tx(ru, en)}</a>
	{/each}
</nav>

<style>
	.sw {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin: 0 0 var(--s3);
		border-radius: var(--r-pill);
		background: var(--surface);
		border: 1px solid var(--line);
		overflow-x: auto;
		scrollbar-width: none;
	}
	a {
		flex: 1 0 auto;
		text-align: center;
		padding: 6px 10px;
		white-space: nowrap;
		border-radius: var(--r-pill);
		color: var(--text);
		text-decoration: none;
		font-size: var(--fs-s, 0.9rem);
	}
	a.on {
		background: var(--text);
		color: var(--bg);
	}
</style>
