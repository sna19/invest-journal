<script lang="ts">
	import { onMount } from 'svelte';
	import { activity, startActivity } from './activity.svelte.js';
	import { tx } from './i18n.js';

	/** owner 27.11.2026: «Делаю пересчёт…» instead of a frozen screen — the app stays usable meanwhile */
	onMount(startActivity);
	const LABEL: Record<string, string> = { 'Загружаю историю цен': 'Loading price history', 'Пересчитываю гипотезы и автоматические портфели': 'Recalculating the hypotheses and the automatic portfolios' };
	const a = $derived(activity.busy[0]);
	const pct = $derived(a && a.total ? Math.round(((a.done ?? 0) / a.total) * 100) : null);
</script>

{#if a}
	<div class="bar" role="status" aria-live="polite">
		<span class="spin" aria-hidden="true"></span>
		<span class="t">{tx(a.label, LABEL[a.label] ?? a.label)}{#if a.total}{` · ${a.done ?? 0} ${tx('из', 'of')} ${a.total}`}{/if}{activity.busy.length > 1 ? ` (+${activity.busy.length - 1})` : ''}</span>
		<span class="muted">{tx('приложением можно пользоваться', 'the app stays usable')}</span>
		{#if pct !== null}<i class="p" style:width="{pct}%"></i>{/if}
	</div>
{:else if activity.finished}
	<div class="bar done" role="status">
		<span class="t">{tx('Пересчёт закончен', 'Recalculation done')}</span>
		<button onclick={() => location.reload()}>{tx('Обновить экран', 'Refresh the screen')}</button>
		<button class="x" aria-label={tx('Закрыть', 'Close')} onclick={() => (activity.finished = false)}>×</button>
	</div>
{/if}

<style>
	.bar {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px);
		z-index: 40;
		width: min(640px, calc(100% - 24px));
		box-sizing: border-box;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		padding: 8px 12px;
		border-radius: var(--r2);
		background: var(--surface);
		border: 1px solid var(--line);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
		font-size: var(--fs-xs);
		overflow: hidden;
	}
	.t {
		font-weight: 600;
	}
	.muted {
		color: var(--muted);
	}
	.spin {
		width: 12px;
		height: 12px;
		border: 2px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: r 0.9s linear infinite;
		flex: none;
	}
	@keyframes r {
		to {
			transform: rotate(360deg);
		}
	}
	.p {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		background: var(--accent);
		transition: width 0.6s;
	}
	button {
		min-height: 30px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: none;
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.x {
		margin-left: auto;
		border: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}
</style>
