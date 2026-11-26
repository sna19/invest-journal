<script lang="ts">
	import { onMount } from 'svelte';
	import { loc, tx } from './i18n.js';
	import { priceText } from './portfolio.js';

	/**
	 * T-015, the banner: a held position reached its condition — the stop is broken or the target reached by the latest
	 * quote, its review date came, a model's position outlived its quarter. A tap opens the position's card with
	 * «Продал» / «Пересмотрел»; the banner stays until one of them is done.
	 */
	interface Signal {
		kind: 'stop' | 'target' | 'review' | 'model_end' | 'no_stop' | 'path';
		flag?: string;
		order?: boolean;
		positionId: number;
		portfolioId: number;
		portfolio: string;
		symbol: string;
		priceUnit: string;
		price: number | null;
		stop: number | null;
		target: number | null;
		reviewDate: string | null;
	}
	/** only these positions (the portfolio screen shows its own) */
	let { portfolioId = null }: { portfolioId?: number | null } = $props();
	let items = $state<Signal[]>([]);
	onMount(async () => {
		const r = await fetch('/api/discipline/signals').catch(() => null);
		if (r?.ok) items = (await r.json()).items;
	});
	const shown = $derived(portfolioId === null ? items : items.filter((s) => s.portfolioId === portfolioId));
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
	function text(s: Signal) {
		if (s.kind === 'path') return tx(`метка пути «${({ fading: 'выдыхается', stuck: 'застряла', spike: 'всплеск', bounce: 'отскок' } as Record<string, string>)[s.flag ?? ''] ?? ''}» — пересмотри тезис`, `a path mark «${s.flag}» — review the thesis`);
		if (s.kind === 'no_stop') return tx('куплено без стопа — выставь стоп у брокера', 'bought without a stop — place one at the broker');
		if (s.kind === 'stop') return `${s.order ? tx('стоп у брокера должен был сработать', 'the stop at the broker should have worked') : tx('стоп пробит', 'stop broken')}: ${priceText(s.price, s.priceUnit)} ≤ ${priceText(s.stop, s.priceUnit)}`;
		if (s.kind === 'target') return `${tx('цель достигнута', 'target reached')}: ${priceText(s.price, s.priceUnit)} ≥ ${priceText(s.target, s.priceUnit)}`;
		if (s.kind === 'model_end') return `${tx('период модели закончился', 'the model\'s period is over')} ${s.reviewDate ? d(s.reviewDate) : ''} — ${tx('правило 2: продать', 'rule 2: sell')}`;
		return `${tx('пора пересмотреть', 'time to review')} (${s.reviewDate ? d(s.reviewDate) : ''})`;
	}
</script>

{#each shown as s (`${s.positionId}|${s.kind}`)}
	<a class="sig" class:stop={s.kind === 'stop' || s.kind === 'model_end' || s.kind === 'no_stop'} href="/position/{s.positionId}">
		<b>{s.symbol}</b> {text(s)}
		{#if portfolioId === null}<span class="small">{s.portfolio}</span>{/if}
		<span class="small">{tx('Продал или пересмотрел?', 'Sold or reviewed?')} →</span>
	</a>
{/each}

<style>
	.sig {
		display: flex;
		flex-wrap: wrap;
		gap: 4px var(--s2);
		align-items: baseline;
		margin: 0 0 var(--s2);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		text-decoration: none;
	}
	.sig.stop {
		border-left: 4px solid var(--down);
	}
	.small {
		font-size: var(--fs-s);
		opacity: 0.85;
	}
</style>
