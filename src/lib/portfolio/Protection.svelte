<script lang="ts">
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { tx } from '#lib/i18n.js';
	import ProtectionItem from './ProtectionItem.svelte';
	import type { PItem } from './protection.js';

	/**
	 * T-021: the block «Защита» on top of a security's card — one plan per open position in the real portfolios, or the
	 * plan of a purchase with its size when there is none.
	 */
	interface Props {
		securityId: number;
		/** bump to reload (after a trade) */
		version?: number;
	}
	let { securityId, version = 0 }: Props = $props();
	let items = $state<PItem[] | null>(null);

	async function load() {
		const r = await fetch(`/api/protection?security=${securityId}`).catch(() => null);
		items = r?.ok ? ((await r.json()).items as PItem[]) : [];
	}
	$effect(() => {
		void securityId;
		void version;
		void load();
	});
	const bad = $derived(items?.some((x) => x.status === 'unprotected'));
	const summary = $derived.by(() => {
		if (!items?.length) return undefined;
		const x = items[0];
		if (x.status === 'unprotected') return tx('без защиты', 'not protected');
		if (x.order) return tx(`стоп у брокера${x.order.level !== null ? ` · ${x.order.level.toFixed(2)}` : ''}`, `stop at the broker${x.order.level !== null ? ` · ${x.order.level.toFixed(2)}` : ''}`);
		return x.recommended === 'trail' ? tx(`трейлинг ${x.f.trailPct}%`, `trailing ${x.f.trailPct}%`) : tx(`стоп ${x.f.stop}`, `stop ${x.f.stop}`);
	});
</script>

{#if items?.length}
	<div class="wrap" class:bad>
		<Fold key="sec-protection" title={tx('Защита', 'Protection')} {summary}>
			{#snippet aside()}<HelpIcon topicKey="stock.protection" label={tx('защита', 'protection')} />{/snippet}
			{#each items as it, i (it.position?.id ?? 'new')}
				{#if i}<hr />{/if}
				<ProtectionItem item={it} showPortfolio={items.length > 1} onsaved={load} />
			{/each}
		</Fold>
	</div>
{/if}

<style>
	.wrap.bad :global(.fold) {
		box-shadow: inset 3px 0 0 var(--down);
	}
	hr {
		border: none;
		border-top: 1px solid var(--line);
		margin: var(--s3) 0;
	}
</style>
