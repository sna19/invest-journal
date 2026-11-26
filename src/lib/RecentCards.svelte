<script lang="ts" module>
	export interface Recent {
		id: number;
		symbol: string;
	}
	const KEY = 'recent-cards';
	export function readRecentCards(): Recent[] {
		try {
			const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
			return Array.isArray(v) ? v.slice(0, 12) : [];
		} catch {
			return [];
		}
	}
	/** a security's card was opened: it goes first */
	export function rememberCard(r: Recent) {
		try {
			localStorage.setItem(KEY, JSON.stringify([r, ...readRecentCards().filter((x) => x.id !== r.id)].slice(0, 12)));
		} catch {
			/* private mode */
		}
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { tx } from './i18n.js';

	/**
	 * The securities opened lately (owner's request 26.11.2026: «нашёл три акции, открыл каждую — хочу переходить от
	 * одной к другой»): a row of their symbols, a tap opens the card. `current` — the card shown now.
	 */
	let { current = null }: { current?: number | null } = $props();
	let list = $state<Recent[]>([]);
	onMount(() => (list = readRecentCards()));
	$effect(() => {
		void current;
		list = readRecentCards();
	});
</script>

{#if list.filter((x) => x.id !== current).length}
	<nav class="recent" aria-label={tx('Недавно открытые бумаги', 'Recently opened securities')}>
		<span class="muted">{tx('Недавние', 'Recent')}:</span>
		{#each list as r (r.id)}
			<a href="/security/{r.id}" class:on={r.id === current} aria-current={r.id === current ? 'page' : undefined}>{r.symbol}</a>
		{/each}
	</nav>
{/if}

<style>
	.recent {
		display: flex;
		gap: 6px;
		align-items: center;
		overflow-x: auto;
		margin: 0 0 var(--s2);
		padding-bottom: 2px;
		scrollbar-width: none;
		font-size: var(--fs-xs);
	}
	.muted {
		color: var(--muted);
		flex: none;
	}
	a {
		flex: none;
		padding: 3px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
	}
	a.on {
		background: var(--text);
		color: var(--bg);
		border-color: var(--text);
	}
</style>
