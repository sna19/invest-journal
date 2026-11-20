<script lang="ts">
	import { onMount } from 'svelte';
	import { tx } from './i18n.js';
	import X from '@lucide/svelte/icons/x';

	/**
	 * T-022, the banner: a security one follows moved strongly — at least max(2 ATR%, 3%) in a day. Its move split
	 * and the number of news; a tap opens its card at «Почему двигается». Closed on this device until a new move.
	 */
	interface Move {
		id: number;
		symbol: string;
		date: string;
		movePct: number;
		marketPct: number | null;
		sectorPct: number | null;
		ownPct: number | null;
		news: number;
		topTitle: string | null;
	}
	let items = $state<Move[]>([]);
	let closed = $state<string[]>([]);
	const KEY = 'moves-closed';
	const keyOf = (m: Move) => `${m.id}|${m.date}`;
	onMount(async () => {
		try {
			closed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		} catch {
			closed = [];
		}
		const r = await fetch('/api/news/moves').catch(() => null);
		if (r?.ok) items = (await r.json()).items;
	});
	function close(m: Move) {
		closed = [...closed, keyOf(m)].slice(-50);
		try {
			localStorage.setItem(KEY, JSON.stringify(closed));
		} catch {
			/* private mode */
		}
	}
	const pp = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1).replace('.', tx(',', '.'))}%`);
	const shown = $derived(items.filter((m) => !closed.includes(keyOf(m))));
</script>

{#each shown as m (keyOf(m))}
	<div class="move" class:down={m.movePct < 0} role="status">
		<a href="/security/{m.id}#news">
			<b>{m.symbol} {pp(m.movePct)}</b>
			<span class="small">
				{tx('рынок', 'market')} {pp(m.marketPct)} · {tx('сектор', 'sector')} {pp(m.sectorPct)} · {tx('сама', 'itself')} {pp(m.ownPct)} · {tx(`новостей: ${m.news}`, `news: ${m.news}`)}
			</span>
			{#if m.topTitle}<span class="small top">{tx('главная', 'top')}: {m.topTitle}</span>{/if}
		</a>
		<button aria-label={tx('Закрыть', 'Close')} onclick={() => close(m)}><X size={16} /></button>
	</div>
{/each}

<style>
	.move {
		display: flex;
		align-items: flex-start;
		gap: var(--s2);
		margin: 0 0 var(--s3);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		border-left: 4px solid var(--up);
		background: var(--surface);
	}
	.move.down {
		border-left-color: var(--down);
	}
	a {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--text);
		text-decoration: none;
		min-width: 0;
	}
	.small {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.top {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	button {
		border: none;
		background: none;
		color: var(--muted);
		padding: 4px;
		cursor: pointer;
	}
</style>
