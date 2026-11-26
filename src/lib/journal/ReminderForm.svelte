<script lang="ts">
	import Sheet from '../Sheet.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import { tl, tx } from '../i18n.js';
	import { showToast } from '../toast.svelte.js';
	import { journalVersion } from './screen.svelte.js';

	/**
	 * Д-27, Д-28: a reminder to an entry — by a date or by a condition on what the entry is about: its security (a price
	 * level, a change over N days, N days before a report), its position (a drawdown), its hypothesis (the end of its
	 * term), or the start of a quarter.
	 */
	interface Props {
		entryId: number;
		links: { type: string; id: string; label: string }[];
		onclose: () => void;
	}
	let { entryId, links, onclose }: Props = $props();
	const secs = $derived(links.filter((l) => l.type === 'security'));
	const pos = $derived(links.find((l) => l.type === 'position'));
	const hyp = $derived(links.find((l) => l.type === 'hypothesis'));
	let condition = $state('date');
	const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
	let date = $state(plus(7));
	let securityId = $state('');
	let level = $state('');
	let days = $state('5');
	let pct = $state('8');
	let title = $state('');
	let errors = $state<Record<string, string>>({});
	$effect(() => {
		if (!securityId && secs.length) securityId = secs[0].id;
	});
	const OPTIONS = $derived(
		[
			['date', tx('По дате', 'On a date')],
			...(secs.length
				? [
						['price_above', tx('Цена выше уровня', 'Price above a level')],
						['price_below', tx('Цена ниже уровня', 'Price below a level')],
						['change', tx('Изменение за N дней', 'Change over N days')],
						['report', tx('За N дней до отчёта', 'N days before a report')]
					]
				: []),
			...(pos ? [['drawdown', tx('Просадка позиции', 'Position drawdown')]] : []),
			['quarter_start', tx('Начало квартала', 'Start of a quarter')],
			...(hyp ? [['horizon', tx('Конец горизонта гипотезы', 'End of the hypothesis\'s term')]] : [])
		] as [string, string][]
	);
	async function save() {
		const b = { entryId, condition, title, date, securityId, level, days: condition === 'report' && days === '5' ? '3' : days, pct, positionId: pos?.id, hypothesisId: hyp?.id };
		const r = await fetch('/api/reminders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).catch(() => null);
		const j = await r?.json().catch(() => ({}));
		if (!r?.ok) {
			errors = j?.errors ?? {};
			return showToast(tl(j?.message) || tx('Не сохранилось', 'Not saved'));
		}
		journalVersion.n++;
		showToast(tx('Напоминание поставлено', 'Reminder set'));
		onclose();
	}
</script>

<Sheet title={tx('Напомнить', 'Remind me')} {onclose}>
	<div class="form">
		<label>
			<span>{tx('Когда', 'When')} <HelpIcon topicKey="reminder.create" label={tx('напоминания', 'reminders')} /></span>
			<select bind:value={condition}>{#each OPTIONS as [k, l] (k)}<option value={k}>{l}</option>{/each}</select>
		</label>
		{#if condition === 'date'}
			<label><span>{tx('Дата', 'Date')}</span><input type="date" bind:value={date} /></label>
		{/if}
		{#if ['price_above', 'price_below', 'change', 'report'].includes(condition) && secs.length > 1}
			<label><span>{tx('Бумага', 'Security')}</span><select bind:value={securityId}>{#each secs as s (s.id)}<option value={s.id}>{s.label}</option>{/each}</select></label>
		{/if}
		{#if condition === 'price_above' || condition === 'price_below'}
			<label><span>{tx('Уровень цены', 'Price level')}</span><input inputmode="decimal" bind:value={level} />{#if errors.level}<em>{errors.level}</em>{/if}</label>
		{/if}
		{#if condition === 'change'}
			<div class="row">
				<label><span>{tx('Изменение, %', 'Change, %')}</span><input inputmode="decimal" bind:value={pct} /></label>
				<label><span>{tx('За дней', 'Over days')}</span><input inputmode="numeric" bind:value={days} /></label>
			</div>
		{/if}
		{#if condition === 'drawdown'}
			<label><span>{tx('Просадка от средней цены, %', 'Drawdown from the average price, %')}</span><input inputmode="decimal" bind:value={pct} /></label>
		{/if}
		{#if condition === 'report'}
			<label><span>{tx('За сколько дней до отчёта', 'How many days before the report')}</span><input inputmode="numeric" bind:value={days} placeholder="3" /></label>
		{/if}
		<label><span>{tx('Подпись (необязательно)', 'Label (optional)')}</span><input bind:value={title} placeholder={tx('по умолчанию — начало записи', 'by default — the start of the entry')} /></label>
		{#if Object.keys(errors).length}<em>{Object.values(errors)[0]}</em>{/if}
		<button class="primary" onclick={save}>{tx('Поставить', 'Set')}</button>
	</div>
</Sheet>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s3);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
		font-size: var(--fs-s);
		color: var(--muted);
	}
	label span {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	input,
	select {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	em {
		color: var(--down);
		font-style: normal;
	}
	.primary {
		min-height: var(--tap);
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
	}
</style>
