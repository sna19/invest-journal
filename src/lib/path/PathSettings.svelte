<script lang="ts">
	import { onMount } from 'svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { showToast } from '#lib/toast.svelte.js';
	import { tx } from '#lib/i18n.js';

	/** T-033: the thresholds of the marks of the return's path and the rolling window */
	let p = $state<Record<string, number> | null>(null);
	let defaults = $state<Record<string, number> | null>(null);
	onMount(async () => {
		const j = await fetch('/api/path?settings').then((r) => r.json()).catch(() => null);
		if (j) ((p = j.params), (defaults = j.defaults));
	});
	async function save() {
		const r = await fetch('/api/path', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: p }) });
		if (!r.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		p = (await r.json()).params;
		showToast(tx('Сохранено', 'Saved'));
	}
	const F: [string, string, string][] = [
		['fadeCagr', '«Выдыхается»: за 3 года не меньше, % в год', '«Fading»: over 3 years at least, % a year'],
		['fadeYear', '…а за 12 месяцев не больше, %', '…and over 12 months at most, %'],
		['fadeExcess', '…или к рынку не больше, п.п.', '…or over the market at most, pp'],
		['stuckDays', '«Застряла»: торговых дней без максимума', '«Stuck»: trading days without a high'],
		['stuckBand', '…и 12 месяцев в коридоре ±, %', '…and 12 months within ±, %'],
		['spikeShare', '«Всплеск»: доля прибыли 3 лет, не меньше %', '«Spike»: share of 3 years\' profit, at least %'],
		['spikeMonths', '…за лучшие месяцы, сколько', '…in the best months, how many'],
		['bounceYear', '«Отскок»: за 12 месяцев не больше, %', '«Bounce»: over 12 months at most, %'],
		['bounceMonth', '…а за месяц не меньше, %', '…and over the month at least, %'],
		['window', 'Скользящая доходность, окно мес. (6, 12, 36)', 'Rolling return, window in months (6, 12, 36)']
	];
</script>

<Fold key="settings-path" title={tx('Метки пути доходности', 'Marks of the return\'s path')} open={false}>
	{#snippet aside()}<HelpIcon topicKey="stock.flags" label={tx('метки пути', 'path marks')} />{/snippet}
	{#if p}
		<div class="lims">
			{#each F as [k, ru, en] (k)}
				<label>{tx(ru, en)}<input inputmode="decimal" bind:value={p[k]} onchange={save} /><small>{tx('по умолчанию', 'default')} {defaults?.[k]}</small></label>
			{/each}
		</div>
	{/if}
</Fold>

<style>
	.lims {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--fs-s);
	}
	input {
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
	}
	small {
		color: var(--muted);
		font-size: var(--fs-xs);
	}
</style>
