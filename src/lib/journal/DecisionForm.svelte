<script lang="ts">
	import Sheet from '../Sheet.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import { tl, tx } from '../i18n.js';
	import { showToast } from '../toast.svelte.js';
	import RichEditor from './RichEditor.svelte';
	import BasisPicker from './BasisPicker.svelte';
	import { journalVersion } from './screen.svelte.js';

	/**
	 * Д-15: «Не покупаю» (a refusal — what the security does next is judged later, Д-42) and «Отложить» (a date to come
	 * back; the reminder itself comes with 11г) from a security's card. The basis and the reason are required.
	 */
	let { securityId, symbol, type, onclose }: { securityId: number; symbol: string; type: 'skip' | 'defer'; onclose: () => void } = $props();
	let basis = $state('');
	let why = $state('');
	const plus = (m: number) => {
		const d = new Date();
		d.setMonth(d.getMonth() + m);
		return d.toISOString().slice(0, 10);
	};
	let reviewDate = $state(plus(3));
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);
	async function save() {
		saving = true;
		const r = await fetch('/api/decisions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, securityId, basis, why, reviewDate }) }).catch(() => null);
		saving = false;
		const j = await r?.json().catch(() => ({}));
		if (!r?.ok) {
			errors = j?.errors ?? {};
			return showToast(tl(j?.message) || tx('Не сохранилось', 'Not saved'));
		}
		journalVersion.n++;
		showToast(type === 'skip' ? tx(`${symbol}: «не покупаю» записано`, `${symbol}: «not buying» saved`) : tx(`${symbol}: отложено`, `${symbol}: deferred`));
		onclose();
	}
</script>

<Sheet title={type === 'skip' ? `${tx('Не покупаю', 'Not buying')} ${symbol}` : `${tx('Отложить', 'Defer')} ${symbol}`} {onclose}>
	<div class="form">
		<BasisPicker bind:basis />
		{#if errors.basis}<em class="err">{errors.basis}</em>{/if}
		<span class="lbl">{tx('Почему', 'Why')} <HelpIcon topicKey="decision.skip" label={tx('отказ и отсрочка', 'refusal and deferral')} /></span>
		<RichEditor bind:value={why} autofocus minHeight="5em" placeholder={type === 'skip' ? tx('Почему не беру — через месяц проверю, был ли прав', 'Why I do not take it — in a month I will check if I was right') : tx('Чего жду, чтобы вернуться', 'What I wait for to come back')} />
		{#if errors.why}<em class="err">{errors.why}</em>{/if}
		<label class="lbl"
			>{type === 'skip' ? tx('Проверить отказ', 'Check the refusal on') : tx('Вернуться', 'Come back on')}
			<input type="date" bind:value={reviewDate} /></label
		>
		{#if errors.reviewDate}<em class="err">{errors.reviewDate}</em>{/if}
		<button class="primary" disabled={saving} onclick={save}>{tx('Записать решение', 'Save the decision')}</button>
	</div>
</Sheet>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.lbl {
		display: flex;
		align-items: center;
		gap: var(--s2);
		font-size: var(--fs-s);
		color: var(--muted);
	}
	input {
		min-height: 36px;
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
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
	.err {
		color: var(--down);
		font-style: normal;
		font-size: var(--fs-s);
	}
</style>
