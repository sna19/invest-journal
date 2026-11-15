<script lang="ts" module>
	export interface Row {
		h: {
			id: number;
			symbol: string;
			securityName: string;
			exchangeCode: string;
			currency: string;
			priceUnit: string;
			signalType: string;
			direction: string;
			directionSource: string;
			thesis: string;
			confidencePct: number | null;
			invalidation: string;
			mode: string;
			horizonDate: string;
			horizonSource: string;
			targetPrice: number | null;
			amount: number | null;
			tags: string | null;
			note: string | null;
			createdAt: string;
			entryDate: string;
			entryPrice: number | null;
			benchmarkSymbol: string;
			benchmarkEntry: number | null;
			status: string;
			lesson: string | null;
			closeReason: string | null;
		};
		sourceName: string;
		sourceKind: string;
		author: string | null;
		url: string | null;
		title: string | null;
	}

	export const SIGNAL: Record<string, string> = { recommendation: 'Рекомендация', target: 'Целевая цена', opinion: 'Мнение', news: 'Новость' };
	export const unitOf = (h: Row['h']) => (h.priceUnit === 'ILA' ? 'агорот' : h.currency);
	export const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
	export const canCancel = (h: Row['h']) => h.status === 'open' && Date.now() - Date.parse(h.createdAt) < 24 * 3600 * 1000;
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import Lock from '@lucide/svelte/icons/lock';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import HelpIcon from './HelpIcon.svelte';
	import { showToast } from './toast.svelte.js';

	/** Spec section 9 — the hypothesis card: every field, the article, the benchmark; notes and tags stay editable. */
	interface Props {
		row: Row;
		onchange: (h: Row['h']) => void;
		onclose: () => void;
	}
	let { row, onchange, onclose }: Props = $props();
	const h = $derived(row.h);

	// the fields start from the saved values; the card is opened anew for another hypothesis
	let note = $state(untrack(() => row.h.note ?? ''));
	let tags = $state(untrack(() => row.h.tags ?? ''));
	let saved = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function patch(body: Record<string, unknown>) {
		error = null;
		const r = await fetch(`/api/hypotheses/${h.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (error = j.message ?? 'Не сохранилось');
		onchange(j);
		saved = 'Сохранено';
		setTimeout(() => (saved = null), 1500);
	}

	async function post(action: 'cancel' | 'restore') {
		const r = await fetch(`/api/hypotheses/${h.id}/${action}`, { method: 'POST' });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) {
			error = j.message ?? 'Не получилось';
			return null;
		}
		onchange(j);
		return j;
	}

	async function cancel() {
		if (!(await post('cancel'))) return;
		onclose();
		showToast(`Запись ${h.symbol} отменена`, () => void post('restore'));
	}

	const days = $derived(Math.round((Date.parse(h.horizonDate + 'T12:00:00') - Date.now()) / 86400000));
</script>

<div class="card">
	<p class="name">{h.securityName} · {h.exchangeCode === 'TASE' ? 'TASE' : h.exchangeCode.replace('_', ' ')}</p>

	<div class="price">
		<div>
			<span class="k">Вход</span>
			{#if h.entryPrice === null}
				<span class="wait">ожидает цену</span>
				<span class="sub">закрытие {fmtDate(h.entryDate)} или ближайшего торгового дня</span>
			{:else}
				<b>{h.entryPrice} {unitOf(h)}</b>
			{/if}
		</div>
		<div>
			<span class="k">Бенчмарк</span>
			<b>{h.benchmarkSymbol === 'SPX' ? 'S&P 500' : h.benchmarkSymbol}</b>
			{#if h.benchmarkEntry !== null}<span class="sub">{h.benchmarkEntry}</span>{/if}
		</div>
	</div>

	<div class="locked-head">
		<Lock size={16} /> <span>Зафиксировано при записи</span>
		<HelpIcon topicKey="result.locked" label="почему нельзя менять" />
	</div>
	<dl>
		<dt>Источник</dt>
		<dd>{row.sourceName}{#if row.author}{' · '}{row.author}{/if}</dd>
		{#if row.url}
			<dt>Статья</dt>
			<dd><a href={row.url} target="_blank" rel="noopener noreferrer">{row.title || new URL(row.url).hostname}<ExternalLink size={14} /></a></dd>
		{/if}
		<dt>Сигнал</dt>
		<dd>{SIGNAL[h.signalType]}</dd>
		<dt>Направление</dt>
		<dd>{h.direction === 'long' ? '▲ Рост' : '▼ Падение'} · {h.directionSource === 'mine' ? 'моё толкование' : 'из статьи'}</dd>
		<dt>Тезис</dt>
		<dd>{h.thesis}</dd>
		<dt>Неправ, если</dt>
		<dd>{h.invalidation}</dd>
		<dt>Срок</dt>
		<dd>
			{fmtDate(h.horizonDate)}{#if h.status === 'open'}{' · '}{days > 0 ? `через ${days} дн.` : 'сегодня'}{/if}
			<span class="sub">{h.horizonSource === 'default' ? 'по умолчанию, 3 месяца' : 'из статьи'}</span>
		</dd>
		<dt>Уверенность</dt>
		<dd>{h.confidencePct === null ? '—' : `${h.confidencePct}%`}</dd>
		<dt>Режим</dt>
		<dd>{h.mode === 'real' ? 'Реальные деньги' : 'Симуляция'}{#if h.amount}{' · '}{h.amount} {h.currency}{/if}</dd>
		{#if h.targetPrice !== null}
			<dt>Цель</dt>
			<dd>{h.targetPrice} {unitOf(h)}</dd>
		{/if}
		<dt>Записано</dt>
		<dd>{new Date(h.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</dd>
	</dl>

	<label class="lbl" for="note-{h.id}">Заметка</label>
	<textarea id="note-{h.id}" rows="3" placeholder="Что заметили по ходу" bind:value={note} onblur={() => note !== (h.note ?? '') && patch({ note })}></textarea>
	<label class="lbl" for="tags-{h.id}">Теги</label>
	<input id="tags-{h.id}" placeholder="через запятую" bind:value={tags} onblur={() => tags !== (h.tags ?? '') && patch({ tags })} />
	<p class="status">{#if error}<span class="err">{error}</span>{:else if saved}{saved}{/if}</p>

	<div class="buttons">
		<button class="ghost" disabled title="Появится вместе с ценами">Закрыть досрочно — с ценами (этап 3)</button>
		{#if canCancel(h)}
			<button class="danger" onclick={cancel}>Отменить запись — ошибка ввода</button>
			<p class="sub">Отменить можно в первые 24 часа после записи; потом гипотеза остаётся в статистике.</p>
		{/if}
	</div>
</div>

<style>
	.name {
		margin: 0 0 var(--s3);
		color: var(--muted);
	}
	.price {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s3);
		margin-bottom: var(--s4);
	}
	.price > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.wait {
		font-weight: 700;
		color: var(--warn-text);
	}
	.sub {
		display: block;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.locked-head {
		display: flex;
		align-items: center;
		gap: var(--s2);
		color: var(--muted);
		font-size: var(--fs-s);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--s2) var(--s3);
		margin: var(--s2) 0 var(--s4);
	}
	dt {
		color: var(--muted);
		font-size: var(--fs-s);
		padding-top: 1px;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	dd a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.lbl {
		display: block;
		margin: var(--s2) 0 var(--s1);
		font-weight: 600;
	}
	textarea,
	input {
		box-sizing: border-box;
		width: 100%;
		min-height: var(--tap);
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.status {
		min-height: 1.2em;
		margin: var(--s1) 0;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.err {
		color: var(--down);
	}
	.buttons {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.buttons button {
		min-height: var(--tap);
		border-radius: var(--r2);
		font-weight: 600;
		cursor: pointer;
	}
	.ghost {
		border: 1px dashed var(--line);
		background: none;
		color: var(--muted);
	}
	.danger {
		border: 1px solid var(--down);
		background: none;
		color: var(--down);
	}
</style>
