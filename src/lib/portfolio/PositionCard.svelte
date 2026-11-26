<script lang="ts">
	import { protectFocus } from './protect.svelte.js';
	import TvLink from '../TvLink.svelte';
	import { loc, tl, tx } from '#lib/i18n.js';
	import { onMount, tick } from 'svelte';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import HelpIcon from '../HelpIcon.svelte';
	import Pct from '../Pct.svelte';
	import EventForm from './EventForm.svelte';
	import TradePlan, { newDraft, planBody, PLAN_KIND_LABEL, type PlanDraft, type PlanKind } from './TradePlan.svelte';
	import { israelDate } from '../hypothesis.js';
	import { journalVersion } from '../journal/screen.svelte.js';
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
		/** T-030: inside the security's card — no name line (the card shows it), the day and the holding time */
		compact?: boolean;
	}
	let { positionId, onchange, ondeleted, compact = false }: Props = $props();
	let removing = $state(false);
	async function removePosition() {
		problem = null;
		const r = await fetch(`/api/positions/${positionId}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (problem = tl(j.message) || tx('Не удалилось', 'Not deleted'));
		showToast(`${j.symbol} ${tx('удалена из портфеля', 'removed from the portfolio')}`);
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
			openedAt: string;
			dayPct: number | null;
			dayPc: number | null;
			dayDate: string | null;
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
		portfolioValue: number;
		plan: { id: number; kind: PlanKind; thesis: string | null; wrongIf: string | null; stop: number | null; target: number | null; reviewDate: string | null; noStopReason: string | null; reason: string | null; createdAt: string } | null;
		reviews: Record<string, { reason: string; followed: number }>;
		signals: { kind: 'stop' | 'target' | 'review' | 'model_end' | 'no_stop' | 'path'; order?: boolean; price: number | null; priceDate: string | null }[];
		decisions: { id: number; type: string; basis: string; noReason: number; outcome: string | null }[];
		review: { date: string; wouldBuy: number; thesis: string | null; exitCondition: string | null } | null;
		buyForSale: { id: number; type: string; basis: string; expectation: string | null; createdAt: string; html: string } | null;
	}

	// T-015: the trade's conditions — filled later or changed by «Пересмотрел»
	let planning = $state(false);
	let draft = $state<PlanDraft>(newDraft('own', israelDate()));
	let planReason = $state('');
	let planErrors = $state<Record<string, string>>({});
	function startPlan() {
		if (!v) return;
		const x = v.plan;
		const t = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
		draft = x
			? { kind: x.kind, thesis: x.thesis ?? '', wrongIf: x.wrongIf ?? '', stop: t(x.stop), stopPct: false, target: t(x.target), targetPct: false, reviewDate: x.reviewDate ?? '', noStop: x.stop === null && !!x.noStopReason, noStopReason: x.noStopReason ?? '' }
			: newDraft('own', israelDate());
		planReason = '';
		planErrors = {};
		step = null;
		planning = true;
	}
	async function savePlan() {
		if (!v) return;
		planErrors = {};
		const entry = v.position.avgPrice;
		const r = await fetch(`/api/positions/${positionId}/plan`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...planBody(draft, entry), reason: planReason }) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) {
			planErrors = j.errors ?? {};
			problem = tl(j.message) || tx('Не сохранилось', 'Not saved');
			return;
		}
		problem = null;
		planning = false;
		journalVersion.n++;
		showToast(v.plan ? tx('Пересмотр записан', 'Review saved') : tx('Условия сделки записаны', 'Trade conditions saved'));
		await load();
		onchange();
	}
	const SIGNAL_TEXT: Record<string, [string, string]> = {
		stop: ['Стоп пробит', 'Stop broken'],
		path: ['Метка пути доходности — пересмотри тезис (блок «Как набиралась прибыль»)', 'A mark of the return\'s path — review the thesis (block «How the profit was made»)'],
		no_stop: ['Куплено без стопа — выставь стоп у брокера (блок «Защита»)', 'Bought without a stop — place one at the broker (block «Protection»)'],
		target: ['Цель достигнута', 'Target reached'],
		review: ['Пора пересмотреть', 'Time to review'],
		model_end: ['Период модели закончился — по правилу 2 продать', 'The model\'s period is over — rule 2 says sell']
	};
	const EXIT_TEXT: Record<string, [string, string]> = {
		stop: ['стоп', 'stop'],
		target: ['цель', 'target'],
		model: ['по модели', 'by the model'],
		thesis_broken: ['тезис сломан', 'thesis broken'],
		changed_mind: ['передумал', 'changed my mind']
	};

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
		if (!r.ok) return (problem = (await r.json().catch(() => ({}))).message ?? tx('Не сохранилось', 'Not saved'));
		pricing = false;
		priceValue = '';
		showToast(tx('Цена записана', 'Price saved'));
		await load();
		onchange();
	}

	async function load() {
		const r = await fetch(`/api/positions/${positionId}`).catch(() => null);
		if (!r?.ok) return (problem = tx('Нет связи с сервером', 'No connection to the server'));
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
	const NEXT_LABEL: Record<string, string> = { // shown through tl()
		basis: 'Цена покупки', buy: 'Купил', sell: 'Продал', plan_buy: 'Хочу купить', plan_sell: 'Хочу продать', drop: 'Передумал', note: 'Заметка', watch: 'Наблюдаю' };

	async function undo(id: number, how: 'cancel' | 'reverse') {
		problem = null;
		const r = await fetch(`/api/events/${id}/${how}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (problem = tl(j.message) || tx('Не получилось', 'It did not work'));
		showToast(how === 'cancel' ? tx('Событие отменено', 'Event cancelled') : tx('Сторно записано — событие больше не учитывается', 'Reversal saved — the event no longer counts'));
		await load();
		onchange();
	}

	// «17 нояб.» this year, «17 нояб. 2025» before it
	const d = (s: string) =>
		new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', ...(s.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
	const holdDays = (from: string) => Math.max(0, Math.round((Date.now() - Date.parse(from + 'T12:00:00')) / 86_400_000));
	const live = (e: View['events'][number]) => !e.cancelledAt && !e.reversedBy && e.kind !== 'reverse';
</script>

{#if !v}
	<div class="skeleton"></div>
{:else}
	{@const p = v.position}
	{#if compact}
		<h2 class="mytitle">{tx('Моя позиция', 'My position')} · {v.portfolio.name}<HelpIcon topicKey="security.position" label={tx('моя позиция', 'my position')} /></h2>
		<p class="name">{#if v.review?.wouldBuy === 0 && p.qty > 0}<span class="nostop">{tx('держу без тезиса', 'held without a thesis')}</span>{/if}<b>{STAGE_LABEL[p.stage]}</b><HelpIcon topicKey="portfolio.stages" label={tx('этапы позиции', 'position stages')} /></p>
	{:else}
	<p class="name">{p.name} · {p.exchange.replace('_', ' ')} · <a href="/security/{p.securityId}">{tx('график', 'chart')}</a> <TvLink exchange={p.exchange} symbol={p.symbol} /> · <b>{STAGE_LABEL[p.stage]}</b><HelpIcon topicKey="portfolio.stages" label={tx('этапы позиции', 'position stages')} /></p>
	{/if}

	{#if p.qty > 0}
		<div class="nums">
			<div><span class="k">{tx('В позиции', 'Position')}</span><b>{qtyText(p.qty)}</b><span class="sub">{tx('средняя', 'average')} {priceText(p.avgPrice, p.priceUnit)}</span></div>
			<div>
				<span class="k">{tx('Стоимость', 'Value')}</span><b>{money(p.valuePc, pc)}</b>
				<span class="sub"
					>{p.currency !== pc ? money(p.value, p.currency) + ' · ' : ''}{priceText(p.lastPrice, p.priceUnit)}
					{p.eventPrice ? tx('цена переноса — цен в базе ещё нет', 'carry-over price — no prices in the base yet') : p.manualPrice ? `${tx('ручная цена от', 'manual price of')} ${p.lastDate ? d(p.lastDate) : '—'}` : `${tx('на', 'as of')} ${p.lastDate ? d(p.lastDate) : '—'}`}</span
				>
			</div>
			<div>
				<span class="k">{p.fromTransfer ? tx('С даты переноса', 'Since carry-over') : tx('Не реализовано', 'Unrealized')}</span><b><Pct value={p.unrealizedPct} /></b>
				<span class="sub">{money(p.unrealized, p.currency, true)}{p.currency !== pc ? ` · ${money(p.unrealizedPc, pc, true)}` : ''}</span>
			</div>
			{#if compact}
				<div>
					<span class="k">{tx('За день', 'Today')}</span><b><Pct value={p.dayPct} /></b>
					<span class="sub">{p.dayPc !== null ? money(p.dayPc, pc, true) : '—'}</span>
				</div>
				<div>
					<span class="k">{tx('Владею', 'Held')}</span><b>{holdDays(p.openedAt)} {tx('дн.', 'd')}</b>
					<span class="sub">{tx('с', 'since')} {d(p.openedAt)}</span>
				</div>
			{/if}
			{#if p.currency !== pc}
				<div>
					<span class="k">{tx('В валюте портфеля', 'In the portfolio currency')} <HelpIcon topicKey="portfolio.fx" label={tx('рост и курс', 'growth and rate')} /></span>
					<span class="sub">{tx('от цены', 'from price')} {money(p.fromPrice, pc, true)}</span>
					<span class="sub">{tx('от курса', 'from the rate')} {money(p.fromFx, pc, true)}</span>
				</div>
			{/if}
		</div>
	{/if}
	{#if p.realized !== 0}
		<p class="realized">{tx('Реализовано (FIFO)', 'Realized (FIFO)')}: <b>{money(p.realized, p.currency, true)}</b>{#if p.currency !== pc} · {money(p.realizedPc, pc, true)}{/if}</p>
	{/if}
	{#if !v.portfolio.auto_source_id && p.qty > 0 && (v.hasOpening || p.eventPrice || p.manualPrice)}
		<div class="extra">
			{#if v.hasOpening}
				<button onclick={() => (step = 'basis')}>{p.fromTransfer ? tx('Добавить цену покупки', 'Add the purchase price') : tx('Изменить цену покупки', 'Change the purchase price')}</button>
			{/if}
			{#if p.eventPrice || p.manualPrice}
				<button onclick={() => (pricing = true)}>{tx('Ввести цену', 'Enter a price')}</button>
			{/if}
		</div>
		{#if pricing}
			<div class="stepform">
				<h3>{tx('Ручная цена', 'Manual price')}, {p.priceUnit === 'ILA' ? tx('агорот', 'agorot') : p.currency === 'USD' ? '$' : '₪'}</h3>
				<div class="pr">
					<input type="date" bind:value={priceDate} aria-label={tx('Дата цены', 'Price date')} />
					<input inputmode="decimal" bind:value={priceValue} placeholder={tx('цена', 'price')} aria-label={tx('Цена', 'Price')} />
					<button class="main" disabled={!priceValue.trim()} onclick={() => savePrice(p.securityId)}>{tx('Сохранить', 'Save')}</button>
				</div>
				<p class="sub">{tx('Пока у поставщика нет цены этой бумаги. Цена от поставщика за тот же день её заменит.', 'The provider has no price for this security yet. A provider price for the same day will replace it.')}</p>
			</div>
		{/if}
	{/if}

	{#if v.signals.length && !v.portfolio.auto_source_id}
		<div class="signals" role="alert">
			{#each v.signals as s, i (`${s.kind}|${i}`)}
				<p><b>{tx(...SIGNAL_TEXT[s.kind])}</b>{#if (s.kind === 'stop' || s.kind === 'target') && s.price !== null} · {priceText(s.price, p.priceUnit)}{/if}</p>
			{/each}
			<div class="btns">
				<button class="main" onclick={() => ((planning = false), (step = 'sell'))}>{tx('Продал', 'Sold')}</button>
				<button class="ghost" onclick={startPlan}>{tx('Пересмотрел', 'Reviewed')}</button>
			</div>
		</div>
	{/if}

	{#if v.plan}
		{@const x = v.plan}
		<div class="planbox">
			<p class="ph">
				<span>{tx('Условия сделки', 'Trade conditions')} · {tx(...PLAN_KIND_LABEL[x.kind])}</span>
				{#if x.stop === null}<span class="nostop">{tx('без стопа', 'no stop')}</span>{/if}
				{#if v.decisions.at(-1)?.noReason}<span class="nostop">{tx('без обоснования', 'no reason')}</span>{/if}
				<HelpIcon topicKey="trade.stop" label={tx('стоп, цель и риск', 'stop, target and risk')} />
			</p>
			{#if x.thesis}<p class="th">{x.thesis}</p>{/if}
			{#if x.wrongIf}<p class="sub">{tx('Неправ, если', 'Wrong if')}: {x.wrongIf}</p>{/if}
			<p class="sub">
				{tx('Стоп', 'Stop')} {x.stop !== null ? priceText(x.stop, p.priceUnit) : '—'}{#if x.stop !== null && p.lastPrice} ({Math.round((x.stop / p.lastPrice - 1) * 1000) / 10}%){/if}
				· {tx('цель', 'target')} {x.target !== null ? priceText(x.target, p.priceUnit) : '—'}
				· {tx('пересмотр', 'review')} {x.reviewDate ? d(x.reviewDate) : '—'}
			</p>
			{#if x.stop === null && x.noStopReason}<p class="sub">{tx('Без стопа', 'No stop')}: {x.noStopReason}</p>{/if}
		</div>
	{:else if !v.portfolio.auto_source_id && p.qty > 0}
		<div class="planbox empty">
			<p class="sub">{tx('У позиции нет условий выхода (правило 1).', 'The position has no exit conditions (rule 1).')}</p>
		</div>
	{/if}
	{#if !v.portfolio.auto_source_id && p.qty > 0 && !planning && !v.signals.length}
		<div class="extra"><button onclick={startPlan}>{v.plan ? tx('Пересмотрел', 'Reviewed') : tx('Задать условия сделки', 'Set the trade conditions')}</button></div>
	{/if}
	{#if planning}
		<div class="stepform">
			<h3>{v.plan ? tx('Пересмотрел', 'Reviewed') : tx('Условия сделки', 'Trade conditions')}</h3>
			<TradePlan
				bind:plan={draft}
				kinds={['model', 'hypothesis', 'own', 'spec']}
				entry={p.avgPrice}
				qty={p.qty}
				priceUnit={p.priceUnit}
				currency={p.currency}
				portfolioCurrency={pc}
				portfolioValue={v.portfolioValue}
				fxUsd={v.fxUsd}
				errors={planErrors}
				strict={false}
			/>
			{#if v.plan}
				<label class="reason">
					<span>{tx('Почему пересмотрел', 'Why reviewed')}</span>
					<input bind:value={planReason} placeholder={tx('одной фразой — запишется в историю', 'one sentence — goes into the history')} />
					{#if planErrors.reason}<em class="err">{planErrors.reason}</em>{/if}
				</label>
			{/if}
			<div class="btns">
				<button class="main" onclick={savePlan}>{tx('Сохранить', 'Save')}</button>
				<button class="ghost" onclick={() => (planning = false)}>{tx('Отмена', 'Cancel')}</button>
			</div>
		</div>
	{/if}

	{#each v.hypotheses as h (h.id)}
		<a class="hyp" href="/?open={h.id}">
			<span>{tx('Гипотеза', 'Hypothesis')} №{h.id} {tx('от', 'of')} {d(h.entryDate)}{h.pauseDays !== null ? ` · ${tx(`куплено через ${h.pauseDays} дн.`, `bought ${h.pauseDays} d later`)}` : ''}</span>
			{#if h.fromBuy !== null}
				<span class="sub">{tx('от даты гипотезы', 'since the hypothesis')} <Pct value={h.fromIdea} /> · {tx('от покупки', 'since the purchase')} <Pct value={h.fromBuy} /></span>
			{:else if h.fromIdea !== null}
				<span class="sub">{tx('с даты гипотезы', 'since the hypothesis')} <Pct value={h.fromIdea} /></span>
			{/if}
		</a>
	{/each}

	{#if editing}
		<div class="stepform" bind:this={editEl}>
			<h3>{tx('Изменить', 'Edit')}: {(EVENT_LABEL[editing.kind] ?? editing.kind).toLowerCase()} {tx('от', 'of')} {d(editing.date)}</h3>
			<EventForm
				portfolioId={v.portfolio.id}
				kind={editing.kind}
				position={{ id: p.id, securityId: p.securityId, symbol: p.symbol, name: p.name, currency: p.currency, priceUnit: p.priceUnit, qty: p.qty }}
				portfolioCurrency={pc}
				edit={editing}
				onsaved={async () => {
					showToast(`${p.symbol}: ${tx('событие изменено', 'event changed')}`);
					editing = null;
					await load();
					onchange();
				}}
				oncancel={() => (editing = null)}
			/>
		</div>
	{:else if step}
		<div class="stepform">
			<h3>{tl(NEXT_LABEL[step])}</h3>
			<EventForm
				portfolioId={v.portfolio.id}
				kind={step}
				position={{ id: p.id, securityId: p.securityId, symbol: p.symbol, name: p.name, currency: p.currency, priceUnit: p.priceUnit, qty: p.qty }}
				lastFee={v.lastFee}
				portfolioCurrency={pc}
				portfolioValue={v.portfolioValue}
				existingPlan={v.plan}
				buyForSale={v.buyForSale}
				onsaved={async () => {
					showToast(`${p.symbol}: ${tl(NEXT_LABEL[step!]).toLowerCase()} — ${tx('записано', 'saved')}`);
					// T-021: after «Купил» the block «Защита» opens its cheat sheet for this position
					if (step === 'buy') {
						protectFocus.positionId = p.id;
						window.scrollTo({ top: 0, behavior: 'smooth' });
					}
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
				<button class:main={k === 'buy' || k === 'sell'} onclick={() => (step = k)}>{tl(NEXT_LABEL[k])}</button>
			{/each}
		</div>
	{:else}
		<p class="muted small">{tx('Автоматический портфель: события записывает приложение по гипотезам источника.', 'Automatic portfolio: the app records events from the source\'s hypotheses.')}</p>
	{/if}
	{#if problem}<p class="err" role="alert">{problem}</p>{/if}

	<h3>{tx('История', 'History')}</h3>
	<ol class="feed">
		{#each v.events as e (e.id)}
			<li class:off={!live(e)}>
				<span class="when">{d(e.date)}</span>
				<span class="what">
					<b>{EVENT_LABEL[e.kind] ?? e.kind}</b>
					{#if e.kind === 'buy' || e.kind === 'sell' || e.kind === 'opening'}
						{qtyText(e.qty ?? 0)} × {priceText(e.price, p.priceUnit)}{#if e.fee}, {tx('комиссия', 'fee')} {money(e.fee, p.currency)}{/if}{#if p.currency !== pc && e.fxRate}, {tx('курс', 'rate')} {e.fxRate}{/if}
					{:else if e.kind === 'basis'}
						{e.costTotal ? `${tx('стоимость покупки', 'purchase cost')} ${money(e.costTotal, pc)}` : `${tx('средняя', 'average')} ${priceText(e.price, p.priceUnit)}`}
					{:else if (e.kind === 'plan_buy' || e.kind === 'plan_sell') && (e.price || e.amount)}
						{e.price ? `${tx('по', 'at')} ${priceText(e.price, p.priceUnit)}` : ''}{e.amount ? ` ${tx('на', 'for')} ${money(e.amount, p.currency)}` : ''}
					{:else if e.kind === 'reverse'}
						{tx('события от', 'of the event of')} {d(v.events.find((x) => x.id === e.reversesEventId)?.date ?? e.date)}
					{/if}
					{#if e.kind === 'sell' && v.reviews[e.id]}
						{@const rv = v.reviews[e.id]}
						<span class="note">{tx('Выход', 'Exit')}: {tx(...EXIT_TEXT[rv.reason])} · {rv.followed ? tx('правило соблюдено', 'rule kept') : tx('правило нарушено', 'rule broken')}</span>
					{/if}
					{#if e.note}<span class="note">{e.note}</span>{/if}
					{#if e.cancelledAt}<span class="tag">{tx('отменено', 'cancelled')}</span>{:else if e.reversedBy}<span class="tag">{tx('сторно', 'reversed')}</span>{:else if e.auto}<span class="tag">{tx('авто', 'auto')}</span>{/if}
				</span>
				{#if !v.portfolio.auto_source_id && live(e)}
					<button class="undo" title={tx('Изменить', 'Edit')} aria-label={tx('Изменить событие', 'Edit the event')} onclick={() => startEdit(e)}
						><Pencil size={16} /></button
					>
				{/if}
				{#if !v.portfolio.auto_source_id && e.canCancel}
					<button class="undo" title={tx('Отменить — ошибка ввода', 'Cancel — input error')} aria-label={tx('Отменить событие', 'Cancel the event')} onclick={() => undo(e.id, 'cancel')}><Undo2 size={16} /></button>
				{:else if !v.portfolio.auto_source_id && e.canReverse && e.kind !== 'note'}
					<button class="undo text" onclick={() => undo(e.id, 'reverse')}>{tx('Сторно', 'Reverse')}</button>
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
					{tx('Удалить', 'Delete')} <b>{p.symbol}</b> {tx('из портфеля', 'from the portfolio')} «{v.portfolio.name}» {tx('целиком: событий', 'entirely: events')} {v.events.length}{v.cash.length ? `, ${tx('записей денег по ней', 'cash records for it')} ${v.cash.length}` : ''}, {tx('со всей историей?', 'with the whole history?')}
					{tx('Перед удалением приложение сохранит копию журнала.', 'Before deleting, the app saves a copy of the journal.')}
				</p>
				<div class="btns">
					<button class="danger" onclick={removePosition}>{tx('Удалить навсегда', 'Delete forever')}</button>
					<button class="ghost" onclick={() => (removing = false)}>{tx('Отмена', 'Cancel')}</button>
				</div>
			</div>
		{:else}
			<button class="remove" onclick={() => (removing = true)}><Trash2 size={16} /> {tx('Удалить', 'Delete')} {p.symbol} {tx('из портфеля', 'from the portfolio')}</button>
		{/if}
	{/if}
	<p class="muted small">{tx('Ошибку в событии можно исправить — карандаш: дата, количество, цена, комиссия; прежние значения сохраняются в журнале правок. События не удаляются: в первые 24 часа запись можно отменить, позже — сторнировать.', 'A mistake in an event can be fixed with the pencil: date, quantity, price, fee; old values are kept in the edit log. Events are not deleted: within 24 hours a record can be cancelled, later — reversed.')}</p>
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
	.signals {
		margin: 0 0 var(--s3);
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.signals p {
		margin: 0 0 var(--s2);
	}
	.btns .main {
		flex: 1;
		border: none;
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.planbox {
		margin: 0 0 var(--s3);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.planbox p {
		margin: 0;
	}
	.planbox.empty {
		border: 1px dashed var(--down);
		background: none;
	}
	.ph {
		display: flex;
		align-items: center;
		gap: var(--s2);
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.planbox .th {
		margin: 2px 0;
	}
	.nostop {
		padding: 0 var(--s2);
		border-radius: var(--r-pill);
		background: var(--down);
		color: #fff;
		text-transform: none;
		letter-spacing: 0;
	}
	.reason {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
		margin: var(--s3) 0;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.reason input {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.stepform .btns {
		margin-top: var(--s3);
	}
	.mytitle {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 0 var(--s2);
		font-size: var(--fs-m);
	}
	.skeleton {
		height: 200px;
		border-radius: var(--r3);
		background: var(--surface-2);
	}
</style>
