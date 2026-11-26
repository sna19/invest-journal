<script lang="ts">
	import { tx } from '../i18n.js';

	/** Д-30: snooze — a day, a week, a month or a date; the count shows, from the third time marked */
	let { snoozes = 0, onpick }: { snoozes?: number; onpick: (how: string) => void } = $props();
	let date = $state('');
	let picking = $state(false);
</script>

<span class="snooze">
	<span class="lbl">{tx('Отложить', 'Snooze')}:</span>
	<button type="button" onclick={() => onpick('day')}>{tx('день', 'day')}</button>
	<button type="button" onclick={() => onpick('week')}>{tx('неделя', 'week')}</button>
	<button type="button" onclick={() => onpick('month')}>{tx('месяц', 'month')}</button>
	{#if picking}
		<input type="date" bind:value={date} onchange={() => date && onpick(date)} aria-label={tx('До даты', 'Until')} />
	{:else}
		<button type="button" onclick={() => (picking = true)}>{tx('дата…', 'date…')}</button>
	{/if}
	{#if snoozes}<span class="count" class:many={snoozes >= 3}>{tx(`отложено ${snoozes} раз`, `snoozed ${snoozes}×`)}</span>{/if}
</span>

<style>
	.snooze {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		font-size: var(--fs-s);
	}
	.lbl {
		color: var(--muted);
	}
	button {
		min-height: 30px;
		padding: 0 var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	input {
		min-height: 30px;
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.count {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.count.many {
		padding: 0 var(--s2);
		border-radius: var(--r-pill);
		background: var(--down);
		color: #fff;
	}
</style>
