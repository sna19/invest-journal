<script lang="ts">
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Sheet from '#lib/Sheet.svelte';
	import { tx } from '#lib/i18n.js';
	import { money } from '#lib/portfolio.js';
	import ProtectionItem from './ProtectionItem.svelte';
	import type { PItem } from './protection.js';

	/**
	 * T-021: the first line of a real portfolio — «Защищено X% портфеля · максимальный убыток Y (Z%) · без защиты: N» —
	 * and «Защитить всё»: the cheat sheets of the positions without a stop, one after another, each with «Я выставил».
	 */
	interface Props {
		portfolioId: number;
		version?: number;
	}
	let { portfolioId, version = 0 }: Props = $props();
	type View = { protectedPct: number; maxLoss: number; maxLossPct: number | null; unprotected: number; near: number; currency: string; items: PItem[] };
	let v = $state<View | null>(null);
	let open = $state(false);

	async function load() {
		const r = await fetch(`/api/protection?portfolio=${portfolioId}`).catch(() => null);
		v = r?.ok ? await r.json() : null;
	}
	$effect(() => {
		void portfolioId;
		void version;
		void load();
	});
	const todo = $derived(v?.items.filter((x) => x.status === 'unprotected' || x.status === 'declined') ?? []);
	const pct = (x: number | null) => (x === null ? '—' : `${x.toLocaleString(undefined, { maximumFractionDigits: x < 10 ? 1 : 0 })}%`);
</script>

{#if v && v.items.length}
	<div class="line" class:bad={v.unprotected > 0} class:ok={v.unprotected === 0 && v.near === 0}>
		{#if v.unprotected > 0}<ShieldAlert size={18} />{:else}<ShieldCheck size={18} />{/if}
		<p>
			{tx('Защищено', 'Protected')} <b>{pct(v.protectedPct)}</b> {tx('портфеля', 'of the portfolio')} · {tx('макс. убыток', 'max loss')} {money(v.maxLoss, v.currency)} ({pct(v.maxLossPct)})
			{#if todo.length} · <b>{tx(`без защиты: ${todo.length}`, `unprotected: ${todo.length}`)}</b>{/if}
			{#if v.near} · {tx(`у стопа: ${v.near}`, `near the stop: ${v.near}`)}{/if}
		</p>
		<HelpIcon topicKey="portfolio.protection" label={tx('защита портфеля', 'portfolio protection')} />
		{#if todo.length}<button onclick={() => (open = true)}>{tx('Защитить всё', 'Protect all')}</button>{/if}
	</div>
{/if}

{#if open && v}
	<Sheet title={tx(`Защитить всё · ${todo.length}`, `Protect all · ${todo.length}`)} onclose={() => ((open = false), load())}>
		{#if !todo.length}<p class="muted">{tx('Все позиции защищены.', 'Every position is protected.')}</p>{/if}
		{#each todo as it (it.position?.id)}
			<section class="item">
				<h3>{it.symbol} <span class="muted">· {it.position?.portfolio}</span></h3>
				<ProtectionItem item={it} open onsaved={load} />
			</section>
		{/each}
	</Sheet>
{/if}

<style>
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin: 0 0 var(--s3);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--surface);
		font-size: var(--fs-s);
	}
	.line p {
		flex: 1;
		min-width: 0;
		margin: 0;
	}
	.line.bad {
		background: color-mix(in srgb, var(--down) 12%, var(--surface));
		color: var(--down);
	}
	.line.ok {
		color: var(--up);
	}
	.line.ok p,
	.line.bad p {
		color: var(--text);
	}
	.line button {
		min-height: 36px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r-pill);
		background: var(--down);
		color: #fff;
		font-size: var(--fs-s);
		font-weight: 600;
		cursor: pointer;
	}
	.item {
		padding: var(--s3) 0;
		border-bottom: 1px solid var(--line);
	}
	.item h3 {
		margin: 0 0 var(--s2);
		font-size: var(--fs-m);
	}
	.muted {
		color: var(--muted);
		font-weight: 400;
	}
</style>
