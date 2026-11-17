<script lang="ts">
	import { onMount } from 'svelte';
	import TickerSearch, { rememberSecurity, type Security } from '../TickerSearch.svelte';
	import { israelDate } from '../hypothesis.js';
	import { EVENT_LABEL, money, qtyText, unitFactor } from '../portfolio.js';

	/**
	 * Spec section 18 «Быстрый ввод» — one form for every step of a position. «Купил / Продал» in under 30 s:
	 * the security from the search or from the position card; the date — today; the price — the last known;
	 * the currency — by the security; the fee — as in this portfolio's last trade. A price far from the day's
	 * range is asked about once (a typo, agorot for shekels).
	 */
	export interface Pos {
		id: number;
		securityId: number;
		symbol: string;
		name: string;
		currency: string;
		priceUnit: string;
		qty: number;
	}
	interface Props {
		portfolioId: number;
		kind: string;
		/** the position the step is for; without it the security is chosen here (or given) */
		position?: Pos | null;
		securityId?: number | null;
		hypothesisId?: number | null;
		lastFee?: Record<string, number>;
		onsaved: (positionId: number) => void;
		oncancel: () => void;
	}
	let { portfolioId, kind, position = null, securityId = null, hypothesisId = null, lastFee = {}, onsaved, oncancel }: Props = $props();

	const today = israelDate();
	let sec = $state<{ id: number; symbol: string; name: string; currency: string; priceUnit: string } | null>(null);
	let date = $state(today);
	let qty = $state('');
	let price = $state('');
	let fee = $state('');
	let amount = $state('');
	let note = $state('');
	let quoteDate = $state<string | null>(null);
	let fxUsd = $state<number | null>(null);
	let errors = $state<Record<string, string>>({});
	let ask = $state<string | null>(null);
	let saving = $state(false);
	let formError = $state<string | null>(null);

	const trade = $derived(kind === 'buy' || kind === 'sell');
	const plan = $derived(kind === 'plan_buy' || kind === 'plan_sell');
	const unitLabel = $derived(sec ? (sec.priceUnit === 'ILA' ? 'агорот' : sec.currency === 'USD' ? '$' : '₪') : '');

	async function quote() {
		if (!sec) return;
		const r = await fetch(`/api/securities/${sec.id}/quote?date=${date}`).then((x) => x.json()).catch(() => null);
		if (!r) return;
		quoteDate = r.date;
		fxUsd = r.fxUsd;
		// the price follows the date until the person types their own
		if ((trade || kind === 'plan_buy') && r.close !== null && !priceTouched) price = String(r.close);
	}
	let priceTouched = false;

	function use(s: { id: number; symbol: string; name: string; currency: string; priceUnit: string }) {
		sec = s;
		if (trade && fee === '') fee = lastFee[s.currency] !== undefined ? String(lastFee[s.currency]) : '';
		quote();
	}

	onMount(async () => {
		if (position) use({ id: position.securityId, symbol: position.symbol, name: position.name, currency: position.currency, priceUnit: position.priceUnit });
		else if (securityId) {
			const r = await fetch(`/api/securities/${securityId}/quote`).then((x) => x.json()).catch(() => null);
			if (r) use({ id: r.securityId, symbol: r.symbol, name: r.name, currency: r.currency, priceUnit: r.priceUnit });
		}
	});

	function picked(s: Security) {
		rememberSecurity(s);
		use({ id: s.id, symbol: s.symbol, name: s.nameEn, currency: s.priceUnit === 'USD' ? 'USD' : 'ILS', priceUnit: s.priceUnit });
	}

	const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.').replace(/\s/g, '')));
	const total = $derived.by(() => {
		const q = n(qty);
		const p = n(price);
		if (!sec || !trade || !q || !p) return null;
		const f = unitFactor(sec.priceUnit);
		const fe = n(fee) ?? 0;
		return q * p * f + (kind === 'buy' ? fe : -fe);
	});

	async function save(confirm = false) {
		if (!sec) return;
		saving = true;
		errors = {};
		formError = null;
		const body = {
			...(position ? { positionId: position.id } : { securityId: sec.id }),
			kind,
			date,
			qty: trade ? qty : undefined,
			price: trade || plan ? price : undefined,
			fee: trade ? fee : undefined,
			amount: kind === 'plan_buy' ? amount : undefined,
			note,
			hypothesisId,
			confirm
		};
		try {
			const r = await fetch(`/api/portfolios/${portfolioId}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			const j = await r.json().catch(() => ({}));
			if (r.status === 409 && j.confirm) {
				ask = j.message;
				return;
			}
			if (!r.ok) {
				errors = j.errors ?? {};
				formError = j.message ?? 'Не сохранилось';
				return;
			}
			ask = null;
			onsaved(j.positionId);
		} catch {
			formError = 'Нет связи с сервером';
		} finally {
			saving = false;
		}
	}
</script>

<div class="form">
	{#if !sec}
		<TickerSearch onselect={picked} noIndex label="Бумага" autofocus />
	{:else}
		<p class="sec"><b>{sec.symbol}</b> <span class="muted">{sec.name}</span></p>
	{/if}

	{#if sec}
		<div class="row">
			<label>
				<span>Дата</span>
				<input type="date" max={today} bind:value={date} onchange={quote} />
				{#if errors.date}<em class="err">{errors.date}</em>{/if}
			</label>
			{#if trade}
				<label>
					<span>Количество{#if kind === 'sell' && position}<button type="button" class="all" onclick={() => (qty = String(position!.qty))}>всё: {qtyText(position.qty)}</button>{/if}</span>
					<input inputmode="decimal" bind:value={qty} placeholder="0" />
					{#if errors.qty}<em class="err">{errors.qty}</em>{/if}
				</label>
			{/if}
		</div>

		{#if trade || plan}
			<div class="row">
				<label>
					<span>{plan ? 'Желаемая цена' : 'Цена'}, {unitLabel}</span>
					<input inputmode="decimal" bind:value={price} oninput={() => (priceTouched = true)} placeholder={plan ? 'необязательно' : ''} />
					{#if quoteDate && !plan}<em class="hint">закрытие {quoteDate.split('-').reverse().join('.')}</em>{/if}
					{#if errors.price}<em class="err">{errors.price}</em>{/if}
				</label>
				{#if trade}
					<label>
						<span>Комиссия, {sec.currency === 'USD' ? '$' : '₪'}</span>
						<input inputmode="decimal" bind:value={fee} placeholder="0" />
						{#if errors.fee}<em class="err">{errors.fee}</em>{/if}
					</label>
				{:else if kind === 'plan_buy'}
					<label>
						<span>Сумма, {sec.currency === 'USD' ? '$' : '₪'}</span>
						<input inputmode="decimal" bind:value={amount} placeholder="необязательно" />
					</label>
				{/if}
			</div>
		{/if}

		{#if total !== null}
			<p class="total">
				{kind === 'buy' ? 'Списано' : 'Получено'}: <b>{money(total, sec.currency)}</b>
				{#if sec.currency === 'USD' && fxUsd}<span class="muted"> ≈ {money(total * fxUsd)} по курсу {fxUsd}</span>{/if}
			</p>
		{/if}

		<label>
			<span>{kind === 'drop' ? 'Почему передумал' : plan ? 'Причина' : kind === 'note' ? 'Заметка' : 'Заметка (необязательно)'}</span>
			<textarea rows="2" bind:value={note}></textarea>
			{#if errors.note}<em class="err">{errors.note}</em>{/if}
		</label>

		{#if ask}
			<div class="ask" role="alert">
				<p>{ask}</p>
				<div class="btns">
					<button class="primary" disabled={saving} onclick={() => save(true)}>Сохранить всё равно</button>
					<button class="ghost" onclick={() => (ask = null)}>Исправить</button>
				</div>
			</div>
		{:else}
			{#if formError}<p class="err">{formError}</p>{/if}
			<div class="btns">
				<button class="primary" disabled={saving} onclick={() => save()}>{saving ? 'Сохраняю…' : EVENT_LABEL[kind]}</button>
				<button class="ghost" onclick={oncancel}>Отмена</button>
			</div>
		{/if}
		{#if position && trade}<p class="muted small">В позиции сейчас {qtyText(position.qty)} · цены в {unitLabel}{sec.priceUnit === 'ILA' ? ' (не в шекелях)' : ''}</p>{/if}
		{#if !position && sec.priceUnit === 'ILA' && trade}<p class="muted small">Цены бумаг TASE — в агоротах: 65 ₪ = 6 500 аг.</p>{/if}
	{/if}
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.sec {
		margin: 0;
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
	label > span {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--s1);
	}
	input,
	textarea {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		box-sizing: border-box;
		width: 100%;
	}
	textarea {
		padding: var(--s2) var(--s3);
		resize: vertical;
	}
	.all {
		border: none;
		background: none;
		color: var(--link);
		font-size: var(--fs-s);
		padding: 0;
		cursor: pointer;
	}
	.total {
		margin: 0;
	}
	.hint {
		font-style: normal;
		font-size: var(--fs-xs);
	}
	.err {
		font-style: normal;
		color: var(--down);
		font-size: var(--fs-s);
		margin: 0;
	}
	.ask {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.ask p {
		margin: 0 0 var(--s2);
	}
	.btns {
		display: flex;
		gap: var(--s2);
	}
	.primary,
	.ghost {
		min-height: var(--tap);
		padding: 0 var(--s4);
		border-radius: var(--r2);
		font-weight: 600;
		cursor: pointer;
	}
	.primary {
		flex: 1;
		border: none;
		background: var(--accent);
		color: var(--accent-text);
	}
	.ghost {
		border: 1px solid var(--line);
		background: var(--surface);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
		margin: 0;
	}
</style>
