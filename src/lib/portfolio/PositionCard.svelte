<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import HelpIcon from '../HelpIcon.svelte';
	import Pct from '../Pct.svelte';
	import EventForm from './EventForm.svelte';
	import { CASH_LABEL, EVENT_LABEL, money, priceText, qtyText, STAGE_LABEL, type Stage } from '../portfolio.js';
	import { showToast } from '../toast.svelte.js';

	/**
	 * Spec section 18 — the position card: its events top to bottom (from first interest to the full sale),
	 * the numbers, and the buttons of the next step. A mistake: «Отменить» in the first 24 hours, «Сторно» later —
	 * the history stays whole.
	 */
	interface Props {
		positionId: number;
		onchange: () => void;
		/** the position was deleted whole: close the card */
		ondeleted?: () => void;
	}
	let { positionId, onchange, ondeleted }: Props = $props();
	let removing = $state(false);
	async function removePosition() {
		problem = null;
		const r = await fetch(`/api/positions/${positionId}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (problem = j.message ?? 'Не удалилось');
		showToast(`${j.symbol} удалена из портфеля`);
		removing = false;
		onchange();
		ondeleted?.();
	}

	interface View {
		position: {
			id: number;
			securityId: number;
			symbol: string;
			name: string;
			exchange: string;
			currency: string;
			priceUnit: string;
			stage: Stage;
			qty: number;
			avgPrice: number | null;
			lastPrice: number | null;
			lastDate: string | null;
			value: number;
			valuePc: number;
			unrealized: number;
			unrealizedPct: number | null;
			unrealizedPc: number;
			fromTransfer: boolean;
			eventPrice: boolean;
			manualPrice: boolean;
			fromPrice: number;
			fromFx: number;
			realized: number;
			realizedPc: number;
		};
		portfolio: { id: number; name: string; kind: string; currency: string; auto_source_id: number | null };
		hasOpening: boolean;
		events: {
			id: number;
			kind: string;
			date: string;
			qty: number | null;
			price: number | null;
			fee: number | null;
			fxRate: number | null;
			amount: number | null;
			costTotal: number | null;
			note: string | null;
			hypothesisId: number | null;
			reversesEventId: number | null;
			cancelledAt: string | null;
			auto: boolean;
			reversedBy: number | null;
			canCancel: boolean;
			canReverse: boolean;
		}[];
		cash: { id: number; kind: string; date: string; amount: number; currency: string; note: string | null; cancelledAt: string | null }[];
		hypotheses: { id: number; symbol: string; direction: string; entryDate: string; fromIdea: number | null; fromBuy: number | null; pauseDays: number | null; buyDate: string | null }[];
		lastFee: Record<string, number>;
		fxUsd: number;
	}

	let v = $state<View | null>(null);
	let step = $state<string | null>(null);
	/** «Изменить»: the event being corrected */
	let editing = $state<View['events'][number] | null>(null);
	let editEl = $state<HTMLElement | undefined>();
	async function startEdit(e: View['events'][number]) {
		step = null;
		editing = e;
		await tick();
		editEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}
	let problem = $state<string | null>(null);
	const pc = $derived(v?.portfolio.currency ?? 'ILS');
	let pricing = $state(false);
	let priceDate = $state(new Date().toISOString().slice(0, 10));
	let priceValue = $state('');
	async function savePrice(securityId: number) {
		const r = await fetch(`/api/securities/${securityId}/price`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: priceDate, close: priceValue }) });
		if (!r.ok) return (problem = (await r.json().catch(() => ({}))).message ?? 'Не сохранилось');
		pricing = false;
		priceValue = '';
		showToast('Цена записана');
		await load();
		onchange();
	}

	async function load() {
		const r = await fetch(`/api/positions/${positionId}`).catch(() => null);
		if (!r?.ok) return (problem = 'Нет связи с сервером');
		v = await r.json();
	}
	onMount(load);

	const NEXT: Record<Stage, string[]> = {
		watch: ['plan_buy', 'buy', 'drop', 'note'],
		plan_buy: ['buy', 'drop', 'note'],
		holding: ['buy', 'plan_sell', 'sell', 'note'],
		plan_sell: ['sell', 'drop', 'note'],
		closed: ['watch', 'buy', 'note']
	};
	const NEXT_LABEL: Record<string, string> = {
		basis: 'Цена покупки', buy: 'Купил', sell: 'Продал', plan_buy: 'Хочу купить', plan_sell: 'Хочу продать', drop: 'Передумал', note: 'Заметка', watch: 'Наблюдаю' };

	async function undo(id: number, how: 'cancel' | 'reverse') {
		problem = null;
		const r = await fetch(`/api/events/${id}/${how}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (problem = j.message ?? 'Не получилось');
		showToast(how === 'cancel' ? 'Событие отменено' : 'Сторно записано — событие больше не учитывается');
		await load();
		onchange();
	}

	// «17 нояб.» this year, «17 нояб. 2025» before it
	const d = (s: string) =>
		new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(s.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
	const live = (e: View['events'][number]) => !e.cancelledAt && !e.reversedBy && e.kind !== 'reverse';
</script>

{#if !v}
	<div class="skeleton"></div>
{:else}
	{@const p = v.position}
	<p class="name">{p.name} · {p.exchange.replace('_', ' ')} · <a href="/security/{p.securityId}">график</a> · <b>{STAGE_LABEL[p.stage]}</b><HelpIcon topicKey="portfolio.stages" label="этапы позиции" /></p>

	{#if p.qty > 0}
		<div class="nums">
			<div><span class="k">В позиции</span><b>{qtyText(p.qty)}</b><span class="sub">средняя {priceText(p.avgPrice, p.priceUnit)}</span></div>
			<div>
				<span class="k">Стоимость</span><b>{money(p.valuePc, pc)}</b>
				<span class="sub"
					>{p.currency !== pc ? money(p.value, p.currency) + ' · ' : ''}{priceText(p.lastPrice, p.priceUnit)}
					{p.eventPrice ? 'цена переноса — цен в базе ещё нет' : p.manualPrice ? `ручная цена от ${p.lastDate ? d(p.lastDate) : '—'}` : `на ${p.lastDate ? d(p.lastDate) : '—'}`}</span
				>
			</div>
			<div>
				<span class="k">{p.fromTransfer ? 'С даты переноса' : 'Не реализовано'}</span><b><Pct value={p.unrealizedPct} /></b>
				<span class="sub">{money(p.unrealized, p.currency, true)}{p.currency !== pc ? ` · ${money(p.unrealizedPc, pc, true)}` : ''}</span>
			</div>
			{#if p.currency !== pc}
				<div>
					<span class="k">В валюте портфеля <HelpIcon topicKey="portfolio.fx" label="рост и курс" /></span>
					<span class="sub">от цены {money(p.fromPrice, pc, true)}</span>
					<span class="sub">от курса {money(p.fromFx, pc, true)}</span>
				</div>
			{/if}
		</div>
	{/if}
	{#if p.realized !== 0}
		<p class="realized">Реализовано (FIFO): <b>{money(p.realized, p.currency, true)}</b>{#if p.currency !== pc} · {money(p.realizedPc, pc, true)}{/if}</p>
	{/if}
	{#if !v.portfolio.auto_source_id && p.qty > 0 && (v.hasOpening || p.eventPrice || p.manualPrice)}
		<div class="extra">
			{#if v.hasOpening}
				<button onclick={() => (step = 'basis')}>{p.fromTransfer ? 'Добавить цену покупки' : 'Изменить цену покупки'}</button>
			{/if}
			{#if p.eventPrice || p.manualPrice}
				<button onclick={() => (pricing = true)}>Ввести цену</button>
			{/if}
		</div>
		{#if pricing}
			<div class="stepform">
				<h3>Ручная цена, {p.priceUnit === 'ILA' ? 'агорот' : p.currency === 'USD' ? '$' : '₪'}</h3>
				<div class="pr">
					<input type="date" bind:value={priceDate} aria-label="Дата цены" />
					<input inputmode="decimal" bind:value={priceValue} placeholder="цена" aria-label="Цена" />
					<button class="main" disabled={!priceValue.trim()} onclick={() => savePrice(p.securityId)}>Сохранить</button>
				</div>
				<p class="sub">Пока у поставщика нет цены этой бумаги. Цена от поставщика за тот же день её заменит.</p>
			</div>
		{/if}
	{/if}

	{#each v.hypotheses as h (h.id)}
		<a class="hyp" href="/?open={h.id}">
			<span>Гипотеза №{h.id} от {d(h.entryDate)}{h.pauseDays !== null ? ` · куплено через ${h.pauseDays} дн.` : ''}</span>
			{#if h.fromBuy !== null}
				<span class="sub">от даты гипотезы <Pct value={h.fromIdea} /> · от покупки <Pct value={h.fromBuy} /></span>
			{:else if h.fromIdea !== null}
				<span class="sub">с даты гипотезы <Pct value={h.fromIdea} /></span>
			{/if}
		</a>
	{/each}

	{#if editing}
		<div class="stepform" bind:this={editEl}>
			<h3>Изменить: {(EVENT_LABEL[editing.kind] ?? editing.kind).toLowerCase()} от {d(editing.date)}</h3>
			<EventForm
				portfolioId={v.portfolio.id}
				kind={editing.kind}
				position={{ id: p.id, securityId: p.securityId, symbol: p.symbol, name: p.name, currency: p.currency, priceUnit: p.priceUnit, qty: p.qty }}
				portfolioCurrency={pc}
				edit={editing}
				onsaved={async () => {
					showToast(`${p.symbol}: событие изменено`);
					editing = null;
					await load();
					onchange();
				}}
				oncancel={() => (editing = null)}
			/>
		</div>
	{:else if step}
		<div class="stepform">
			<h3>{NEXT_LABEL[step]}</h3>
			<EventForm
				portfolioId={v.portfolio.id}
				kind={step}
				position={{ id: p.id, securityId: p.securityId, symbol: p.symbol, name: p.name, currency: p.currency, priceUnit: p.priceUnit, qty: p.qty }}
				lastFee={v.lastFee}
				portfolioCurrency={pc}
				onsaved={async () => {
					showToast(`${p.symbol}: ${NEXT_LABEL[step!].toLowerCase()} — записано`);
					step = null;
					await load();
					onchange();
				}}
				oncancel={() => (step = null)}
			/>
		</div>
	{:else if !v.portfolio.auto_source_id}
		<div class="next">
			{#each NEXT[p.stage] as k (k)}
				<button class:main={k === 'buy' || k === 'sell'} onclick={() => (step = k)}>{NEXT_LABEL[k]}</button>
			{/each}
		</div>
	{:else}
		<p class="muted small">Автоматический портфель: события записывает приложение по гипотезам источника.</p>
	{/if}
	{#if problem}<p class="err" role="alert">{problem}</p>{/if}

	<h3>История</h3>
	<ol class="feed">
		{#each v.events as e (e.id)}
			<li class:off={!live(e)}>
				<span class="when">{d(e.date)}</span>
				<span class="what">
					<b>{EVENT_LABEL[e.kind] ?? e.kind}</b>
					{#if e.kind === 'buy' || e.kind === 'sell' || e.kind === 'opening'}
						{qtyText(e.qty ?? 0)} × {priceText(e.price, p.priceUnit)}{#if e.fee}, комиссия {money(e.fee, p.currency)}{/if}{#if p.currency !== pc && e.fxRate}, курс {e.fxRate}{/if}
					{:else if e.kind === 'basis'}
						{e.costTotal ? `стоимость покупки ${money(e.costTotal, pc)}` : `средняя ${priceText(e.price, p.priceUnit)}`}
					{:else if (e.kind === 'plan_buy' || e.kind === 'plan_sell') && (e.price || e.amount)}
						{e.price ? `по ${priceText(e.price, p.priceUnit)}` : ''}{e.amount ? ` на ${money(e.amount, p.currency)}` : ''}
					{:else if e.kind === 'reverse'}
						события от {d(v.events.find((x) => x.id === e.reversesEventId)?.date ?? e.date)}
					{/if}
					{#if e.note}<span class="note">{e.note}</span>{/if}
					{#if e.cancelledAt}<span class="tag">отменено</span>{:else if e.reversedBy}<span class="tag">сторно</span>{:else if e.auto}<span class="tag">авто</span>{/if}
				</span>
				{#if !v.portfolio.auto_source_id && live(e)}
					<button class="undo" title="Изменить" aria-label="Изменить событие" onclick={() => startEdit(e)}
						><Pencil size={16} /></button
					>
				{/if}
				{#if !v.portfolio.auto_source_id && e.canCancel}
					<button class="undo" title="Отменить — ошибка ввода" aria-label="Отменить событие" onclick={() => undo(e.id, 'cancel')}><Undo2 size={16} /></button>
				{:else if !v.portfolio.auto_source_id && e.canReverse && e.kind !== 'note'}
					<button class="undo text" onclick={() => undo(e.id, 'reverse')}>Сторно</button>
				{/if}
			</li>
		{/each}
		{#each v.cash.filter((c) => !c.cancelledAt) as c (c.id)}
			<li>
				<span class="when">{d(c.date)}</span>
				<span class="what"><b>{CASH_LABEL[c.kind]}</b> {money(c.amount, c.currency)}{#if c.note}<span class="note">{c.note}</span>{/if}</span>
			</li>
		{/each}
	</ol>
	{#if !v.portfolio.auto_source_id}
		{#if removing}
			<div class="ask" role="alert">
				<p>
					Удалить <b>{p.symbol}</b> из портфеля «{v.portfolio.name}» целиком: событий {v.events.length}{v.cash.length ? `, записей денег по ней ${v.cash.length}` : ''}, со всей историей?
					Перед удалением приложение сохранит копию журнала.
				</p>
				<div class="btns">
					<button class="danger" onclick={removePosition}>Удалить навсегда</button>
					<button class="ghost" onclick={() => (removing = false)}>Отмена</button>
				</div>
			</div>
		{:else}
			<button class="remove" onclick={() => (removing = true)}><Trash2 size={16} /> Удалить {p.symbol} из портфеля</button>
		{/if}
	{/if}
	<p class="muted small">Ошибку в событии можно исправить — карандаш: дата, количество, цена, комиссия; прежние значения сохраняются в журнале правок. События не удаляются: в первые 24 часа запись можно отменить, позже — сторнировать.</p>
{/if}

<style>
	.name {
		margin: 0 0 var(--s3);
		color: var(--muted);
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
	}
	.name b {
		color: var(--text);
	}
	.nums {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s3);
		margin-bottom: var(--s3);
	}
	.nums div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		display: flex;
		align-items: center;
	}
	.nums b {
		font-size: var(--fs-l);
	}
	.sub {
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.realized {
		margin: 0 0 var(--s3);
	}
	.hyp {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: var(--s3);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
		color: var(--text);
		text-decoration: none;
	}
	.next {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
		margin: var(--s2) 0;
	}
	.next button {
		min-height: var(--tap);
		padding: 0 var(--s4);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		font-weight: 600;
		cursor: pointer;
	}
	.next button.main {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.extra {
		display: flex;
		gap: var(--s2);
		flex-wrap: wrap;
		margin-bottom: var(--s2);
	}
	.extra button {
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.pr {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: var(--s2);
	}
	.pr input {
		min-height: var(--tap);
		padding: 0 var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		box-sizing: border-box;
		width: 100%;
	}
	.pr .main {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.stepform {
		margin: var(--s2) 0;
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	h3 {
		margin: var(--s4) 0 var(--s2);
		font-size: var(--fs-m);
	}
	.stepform h3 {
		margin-top: 0;
	}
	.feed {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.feed li {
		display: flex;
		gap: var(--s3);
		align-items: flex-start;
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.feed li.off .what {
		text-decoration: line-through;
		color: var(--muted);
	}
	.when {
		flex: none;
		width: 64px;
		font-size: var(--fs-s);
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.what {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: baseline;
	}
	.note {
		flex-basis: 100%;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.tag {
		font-size: var(--fs-xs);
		padding: 0 var(--s2);
		border-radius: var(--r-pill);
		background: var(--surface-2);
		color: var(--muted);
		text-decoration: none;
	}
	.undo {
		flex: none;
		min-width: 36px;
		min-height: 36px;
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.remove {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin: var(--s4) 0 0;
		min-height: var(--tap);
		padding: 0;
		border: none;
		background: none;
		color: var(--down);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.ask {
		margin-top: var(--s4);
		padding: var(--s3);
		border: 1px solid var(--down);
		border-radius: var(--r1);
	}
	.ask p {
		margin: 0 0 var(--s3);
	}
	.btns {
		display: flex;
		gap: var(--s2);
	}
	.btns button {
		min-height: var(--tap);
		padding: 0 var(--s4);
		border-radius: var(--r1);
		font: inherit;
		cursor: pointer;
	}
	.danger {
		border: none;
		background: var(--down);
		color: #fff;
	}
	.ghost {
		border: 1px solid var(--line);
		background: none;
		color: var(--text);
	}
	.undo.text {
		font-size: var(--fs-s);
		color: var(--link);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.err {
		color: var(--down);
	}
	.skeleton {
		height: 200px;
		border-radius: var(--r3);
		background: var(--surface-2);
	}
</style>
