<script lang="ts">
	import { onMount } from 'svelte';
	import Undo2 from '@lucide/svelte/icons/undo-2';
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
	}
	let { positionId, onchange }: Props = $props();

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
			valueIls: number;
			unrealized: number;
			unrealizedPct: number | null;
			unrealizedIls: number;
			fromPrice: number;
			fromFx: number;
			realized: number;
			realizedIls: number;
		};
		portfolio: { id: number; name: string; kind: string; auto_source_id: number | null };
		events: {
			id: number;
			kind: string;
			date: string;
			qty: number | null;
			price: number | null;
			fee: number | null;
			fxRate: number | null;
			amount: number | null;
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
	let problem = $state<string | null>(null);

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
	const NEXT_LABEL: Record<string, string> = { buy: 'Купил', sell: 'Продал', plan_buy: 'Хочу купить', plan_sell: 'Хочу продать', drop: 'Передумал', note: 'Заметка', watch: 'Наблюдаю' };

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
			<div><span class="k">Стоимость</span><b>{money(p.valueIls)}</b><span class="sub">{p.currency === 'USD' ? money(p.value, 'USD') + ' · ' : ''}{priceText(p.lastPrice, p.priceUnit)} на {p.lastDate ? d(p.lastDate) : '—'}</span></div>
			<div><span class="k">Не реализовано</span><b><Pct value={p.unrealizedPct} /></b><span class="sub">{money(p.unrealized, p.currency, true)}{p.currency === 'USD' ? ` · ${money(p.unrealizedIls, 'ILS', true)}` : ''}</span></div>
			{#if p.currency === 'USD'}
				<div>
					<span class="k">В шекелях <HelpIcon topicKey="portfolio.fx" label="рост и курс" /></span>
					<span class="sub">от цены {money(p.fromPrice, 'ILS', true)}</span>
					<span class="sub">от курса {money(p.fromFx, 'ILS', true)}</span>
				</div>
			{/if}
		</div>
	{/if}
	{#if p.realized !== 0}
		<p class="realized">Реализовано (FIFO): <b>{money(p.realized, p.currency, true)}</b>{#if p.currency === 'USD'} · {money(p.realizedIls, 'ILS', true)}{/if}</p>
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

	{#if step}
		<div class="stepform">
			<h3>{NEXT_LABEL[step]}</h3>
			<EventForm
				portfolioId={v.portfolio.id}
				kind={step}
				position={{ id: p.id, securityId: p.securityId, symbol: p.symbol, name: p.name, currency: p.currency, priceUnit: p.priceUnit, qty: p.qty }}
				lastFee={v.lastFee}
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
					{#if e.kind === 'buy' || e.kind === 'sell'}
						{qtyText(e.qty ?? 0)} × {priceText(e.price, p.priceUnit)}{#if e.fee}, комиссия {money(e.fee, p.currency)}{/if}{#if p.currency === 'USD' && e.fxRate}, курс {e.fxRate}{/if}
					{:else if (e.kind === 'plan_buy' || e.kind === 'plan_sell') && (e.price || e.amount)}
						{e.price ? `по ${priceText(e.price, p.priceUnit)}` : ''}{e.amount ? ` на ${money(e.amount, p.currency)}` : ''}
					{:else if e.kind === 'reverse'}
						события от {d(v.events.find((x) => x.id === e.reversesEventId)?.date ?? e.date)}
					{/if}
					{#if e.note}<span class="note">{e.note}</span>{/if}
					{#if e.cancelledAt}<span class="tag">отменено</span>{:else if e.reversedBy}<span class="tag">сторно</span>{:else if e.auto}<span class="tag">авто</span>{/if}
				</span>
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
	<p class="muted small">События не удаляются: в первые 24 часа запись можно отменить, позже — сторнировать и ввести верную.</p>
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
