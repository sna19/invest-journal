<script lang="ts">
	import { onMount } from 'svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { showToast } from '#lib/toast.svelte.js';
	import { tx } from '#lib/i18n.js';

	/** T-021: the coefficients of the protective plan's formula, the broker's name (kept in the database), fractions */
	type P = Record<string, number | boolean>;
	let params = $state<P | null>(null);
	let defaults = $state<P | null>(null);
	let broker = $state('');
	onMount(async () => {
		const j = await fetch('/api/protection/settings').then((r) => r.json()).catch(() => null);
		if (!j) return;
		params = j.params;
		defaults = j.defaults;
		broker = j.broker ?? '';
	});
	async function save(extra: Record<string, unknown> = {}) {
		const r = await fetch('/api/protection/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...params, broker, ...extra }) });
		if (!r.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		const j = await r.json();
		params = j.params;
		showToast(tx('Сохранено', 'Saved'));
	}
	const FIELDS: [string, string, string][] = [
		['riskPct', 'Риск новой позиции, % портфеля', 'Risk of a new position, % of the portfolio'],
		['atrDays', 'ATR, дней', 'ATR, days'],
		['lowShort', 'Минимум за, дней (ближний)', 'Low over, days (near)'],
		['lowLong', 'Минимум за, дней (дальний)', 'Low over, days (far)'],
		['sma', 'Средняя, дней', 'Average, days'],
		['bufferAtr', 'Запас под уровнем, ATR', 'Margin under the level, ATR'],
		['minAtr', 'Уровень не ближе, ATR', 'Level no nearer than, ATR'],
		['maxPct', 'Уровень не дальше, %', 'Level no further than, %'],
		['fallbackAtr', 'Нет уровня: цена минус, ATR', 'No level: the price minus, ATR'],
		['limitPct', 'Лимит ниже стопа, не меньше %', 'Limit under the stop, at least %'],
		['limitAtr', 'Лимит ниже стопа, не меньше ATR', 'Limit under the stop, at least ATR'],
		['trailMult', 'Трейлинг = ATR% ×', 'Trailing = ATR% ×'],
		['trailMin', 'Трейлинг не меньше, %', 'Trailing at least, %'],
		['trailMax', 'Трейлинг не больше, %', 'Trailing at most, %']
	];
</script>

<Fold key="settings-protection" title={tx('Защитный план', 'Protective plan')} summary={params ? tx(`риск ${params.riskPct}% · стоп под уровнем ${params.bufferAtr} ATR · трейлинг ${params.trailMin}–${params.trailMax}%`, `risk ${params.riskPct}% · stop ${params.bufferAtr} ATR under the level · trailing ${params.trailMin}–${params.trailMax}%`) : undefined} open={false}>
	{#snippet aside()}<HelpIcon topicKey="stock.protection" label={tx('защитный план', 'protective plan')} />{/snippet}
	{#if params}
		<div class="lims">
			<label>{tx('Брокер (для кнопки «Я выставил в …»)', 'Broker (for the button «I placed it at …»)')}<input bind:value={broker} placeholder={tx('у брокера', 'at the broker')} onchange={() => save()} /></label>
			{#each FIELDS as [k, ru, en] (k)}
				<label>{tx(ru, en)}<input inputmode="decimal" bind:value={params[k]} onchange={() => save()} /><small>{tx('по умолчанию', 'default')} {defaults?.[k]}</small></label>
			{/each}
			<label class="row"><input type="checkbox" checked={params.fractional === true} onchange={(e) => save({ fractional: e.currentTarget.checked })} />{tx('Брокер покупает дробные акции (размер до 0,01)', 'The broker buys fractions of a share (size to 0.01)')}</label>
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
	label.row {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}
	input:not([type='checkbox']) {
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
