<script lang="ts">
	import { onMount } from 'svelte';
	import TopBar from '#lib/TopBar.svelte';
	import { tl, tx } from '#lib/i18n.js';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	/**
	 * T-015 «Мои правила»: the owner's own rules, editable. The first three came from the review of 20.11.2026
	 * (three losing positions). The list is shown folded above the form of a purchase.
	 */
	let items = $state<{ id: number; text: string }[]>([]);
	let draft = $state('');
	let editing = $state<number | null>(null);
	let editText = $state('');
	let problem = $state<string | null>(null);

	async function call(url: string, init?: RequestInit) {
		problem = null;
		const r = await fetch(url, init).catch(() => null);
		const j = r ? await r.json().catch(() => ({})) : {};
		if (!r?.ok) return (problem = tl(j.message) || tx('Не сохранилось', 'Not saved')), false;
		items = j.items;
		return true;
	}
	const post = (b: object) => call('/api/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
	onMount(() => call('/api/rules'));

	async function add() {
		if (await post({ text: draft })) draft = '';
	}
	async function saveEdit(id: number) {
		if (await post({ id, text: editText })) editing = null;
	}
	async function remove(id: number) {
		if (confirm(tx('Удалить правило?', 'Delete the rule?'))) await call(`/api/rules/${id}`, { method: 'DELETE' });
	}
</script>

<svelte:head><title>{tx('Мои правила', 'My rules')}</title></svelte:head>

<TopBar title={tx('Мои правила', 'My rules')} help="trade.rules" back={{ href: '/more', label: tx('Ещё', 'More') }} />

<ol class="list">
	{#each items as r, i (r.id)}
		<li>
			{#if editing === r.id}
				<textarea rows="3" bind:value={editText}></textarea>
				<div class="btns">
					<button class="main" onclick={() => saveEdit(r.id)}>{tx('Сохранить', 'Save')}</button>
					<button class="ghost" onclick={() => (editing = null)}>{tx('Отмена', 'Cancel')}</button>
				</div>
			{:else}
				<span class="n">{i + 1}.</span>
				<span class="t">{r.text}</span>
				<span class="acts">
					<button aria-label={tx('Выше', 'Up')} disabled={i === 0} onclick={() => post({ id: r.id, move: 'up' })}><ArrowUp size={16} /></button>
					<button aria-label={tx('Ниже', 'Down')} disabled={i === items.length - 1} onclick={() => post({ id: r.id, move: 'down' })}><ArrowDown size={16} /></button>
					<button aria-label={tx('Изменить', 'Edit')} onclick={() => ((editing = r.id), (editText = r.text))}><Pencil size={16} /></button>
					<button aria-label={tx('Удалить', 'Delete')} onclick={() => remove(r.id)}><Trash2 size={16} /></button>
				</span>
			{/if}
		</li>
	{/each}
</ol>

<div class="add">
	<textarea rows="2" bind:value={draft} placeholder={tx('Новое правило — из ошибки, которая повторилась дважды', 'A new rule — from a mistake repeated twice')}></textarea>
	<button class="main" disabled={!draft.trim()} onclick={add}>{tx('Добавить', 'Add')}</button>
</div>
{#if problem}<p class="err" role="alert">{problem}</p>{/if}

<style>
	.list {
		list-style: none;
		margin: 0 0 var(--s4);
		padding: 0;
		border-radius: var(--r2);
		background: var(--surface);
	}
	li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
		align-items: flex-start;
		padding: var(--s3);
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	.n {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.t {
		flex: 1;
		min-width: 60%;
	}
	.acts {
		display: flex;
		gap: 2px;
	}
	.acts button {
		min-width: 36px;
		min-height: 36px;
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.acts button:disabled {
		opacity: 0.3;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.add {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.btns {
		display: flex;
		gap: var(--s2);
		width: 100%;
	}
	.main,
	.ghost {
		min-height: var(--tap);
		padding: 0 var(--s4);
		border-radius: var(--r2);
		font-weight: 600;
		cursor: pointer;
	}
	.main {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
	}
	.main:disabled {
		opacity: 0.5;
	}
	.ghost {
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--text);
	}
	.err {
		color: var(--down);
	}
</style>
