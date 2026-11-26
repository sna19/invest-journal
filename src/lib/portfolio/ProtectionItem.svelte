<script lang="ts">
	import { onMount } from 'svelte';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Copy from '@lucide/svelte/icons/copy';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { showToast } from '#lib/toast.svelte.js';
	import { tx } from '#lib/i18n.js';
	import { money, priceText, qtyText } from '#lib/portfolio.js';
	import { plain, type PItem } from './protection.js';
	import { protectFocus } from './protect.svelte.js';

	/**
	 * T-021: the protective plan of one position (or of a purchase to come): the recommended stop with the reason for
	 * it, the other kind to compare, the maximum loss, and the cheat sheet for the broker — every value copied by a tap —
	 * with «Я выставил», which records the order. The levels can be changed before; a stop is only raised.
	 */
	interface Props {
		item: PItem;
		/** show the portfolio's name (the security is held in more than one) */
		showPortfolio?: boolean;
		/** the cheat sheet open from the start («Защитить всё») */
		open?: boolean;
		onsaved?: () => void;
	}
	let { item, showPortfolio = false, open = false, onsaved }: Props = $props();

	let sheet = $state(false);
	let type = $state<'fixed' | 'trail'>('fixed');
	let stop = $state('');
	let limit = $state('');
	let trail = $state('');
	let busy = $state(false);
	let el: HTMLElement | undefined = $state();

	const u = $derived(item.priceUnit);
	const pt = (x: number | null | undefined) => priceText(x ?? null, u);
	const num = (s: string) => {
		const x = Number(s.replace(',', '.').replace(/\s/g, ''));
		return s.trim() && Number.isFinite(x) ? x : null;
	};
	const pct1 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
	const at = $derived(item.broker ? tx(`в ${item.broker}`, `at ${item.broker}`) : tx('у брокера', 'at the broker'));

	function reset() {
		type = item.recommended;
		stop = plain(item.f.stop, u);
		limit = plain(item.f.limit, u);
		trail = String(item.f.trailPct);
	}
	onMount(() => {
		reset();
		if (open) sheet = true;
	});
	// after «Купил»: this position's cheat sheet opens by itself
	$effect(() => {
		if (item.position && protectFocus.positionId === item.position.id) {
			reset();
			sheet = true;
			protectFocus.positionId = null;
			setTimeout(() => el?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
		}
	});

	const LEVEL: Record<string, (d: number) => [string, string]> = {
		low_short: (d) => [`минимума ${d} дней`, `the ${d}-day low`],
		low_long: (d) => [`минимума ${d} дней`, `the ${d}-day low`],
		sma: (d) => [`средней ${d} дней`, `the ${d}-day average`]
	};
	const why = $derived.by(() => {
		const f = item.f;
		const atrText = `ATR ${pt(f.atr)} = ${pct1(f.atrPct)}`;
		if (!f.level) return tx(`цена минус 3 ATR: рядом нет уровня поддержки (${atrText})`, `the price minus 3 ATR: no support level near (${atrText})`);
		return tx(`ниже ${LEVEL[f.level.kind](f.level.days)[0]} ${pt(f.level.value)} на 0,5 ATR (${atrText})`, `under ${LEVEL[f.level.kind](f.level.days)[1]} ${pt(f.level.value)} by 0.5 ATR (${atrText})`);
	});
	const TYPE_WHY: Record<PItem['why'], [string, string]> = {
		model_term: ['позиция модели со сроком', "a model's position with a term"],
		spec: ['спекуляция', 'speculation'],
		no_thesis: ['держу без тезиса', 'held without a thesis'],
		profit: ['позиция в прибыли — трейлинг фиксирует её при развороте', 'in profit — the trailing stop keeps it on a turn'],
		no_term: ['на рост без срока — трейлинг идёт за ценой', 'for growth with no term — the trailing stop follows the price'],
		term: ['позиция со сроком', 'a position with a term'],
		new: ['новая покупка: стоп задаёт размер', 'a new purchase: the stop sets the size']
	};
	const STATUS = {
		protected: ['защищена', 'protected'],
		near: ['цена ближе 1 ATR к стопу', 'the price is within 1 ATR of the stop'],
		unprotected: ['без защиты', 'not protected'],
		declined: ['без стопа', 'no stop']
	} as const;

	const lowered = $derived(type === 'fixed' && item.order?.level !== null && item.order?.level !== undefined && (num(stop) ?? 0) < item.order.level - 1e-9);
	const loss = $derived.by(() => {
		const q = item.position?.qty ?? item.size?.qty ?? 0;
		const s = type === 'fixed' ? num(stop) : item.price * (1 - (num(trail) ?? 0) / 100);
		if (!s || !item.maxLoss) return null;
		const k = item.maxLoss.fixed / Math.max(1e-9, (item.price - item.f.stop) * q);
		return Number.isFinite(k) && q ? (item.price - s) * q * k : null;
	});

	async function copy(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			showToast(tx(`${label}: ${value} — скопировано`, `${label}: ${value} — copied`));
		} catch {
			showToast(value);
		}
	}
	async function placed() {
		if (!item.position || lowered) return;
		busy = true;
		const body = type === 'fixed' ? { positionId: item.position.id, type, stop: num(stop), limit: num(limit), price: item.price, qty: item.position.qty } : { positionId: item.position.id, type, trailPct: num(trail), price: item.price, qty: item.position.qty };
		const r = await fetch('/api/protection/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		busy = false;
		if (!r.ok) {
			const j = await r.json().catch(() => null);
			return showToast(Object.values(j?.errors ?? {}).join(', ') || tx('Не записалось', 'Not saved'));
		}
		sheet = false;
		showToast(tx(`${item.symbol}: защита записана`, `${item.symbol}: protection recorded`));
		onsaved?.();
	}
	const qtyNow = $derived(item.position?.qty ?? item.size?.qty ?? 0);
	const rows = $derived(
		type === 'fixed'
			? [
					[tx('Тип заявки', 'Order type'), 'Stop Limit', 'Stop Limit'],
					[tx('Стоп', 'Stop'), stop, stop],
					[tx('Лимит', 'Limit'), limit, limit],
					[tx('Количество', 'Quantity'), qtyText(qtyNow), String(qtyNow)],
					[tx('Срок', 'Time in force'), 'GTC', 'GTC']
				]
			: [
					[tx('Тип заявки', 'Order type'), 'Trailing Stop %', 'Trailing Stop'],
					[tx('Трейлинг, %', 'Trail, %'), trail, trail],
					[tx('Количество', 'Quantity'), qtyText(qtyNow), String(qtyNow)],
					[tx('Срок', 'Time in force'), 'GTC', 'GTC']
				]
	);
</script>

<div class="pi" bind:this={el}>
	{#if item.status}
		<p class="st {item.status}">
			{#if item.status === 'protected'}<ShieldCheck size={16} />{:else}<ShieldAlert size={16} />{/if}
			<b>{tx(STATUS[item.status][0], STATUS[item.status][1])}</b>{#if item.status === 'declined' && item.noStopReason}: {item.noStopReason}{/if}
			{#if showPortfolio && item.position}<span class="muted"> · {item.position.portfolio}</span>{/if}
		</p>
	{/if}
	{#if item.order}
		<p class="small">
			{tx(`У брокера с ${item.order.setDate.split('-').reverse().join('.')}:`, `At the broker since ${item.order.setDate}:`)}
			{#if item.order.type === 'fixed'}{tx('стоп-лимит', 'stop-limit')} {pt(item.order.stop)}{#if item.order.limitPrice} / {pt(item.order.limitPrice)}{/if}
			{:else}{tx('трейлинг', 'trailing')} {item.order.trailPct}% · {tx('уровень сейчас', 'level now')} <b>{pt(item.order.level)}</b>{/if}
		</p>
	{/if}

	<div class="plan">
		<div class="main" class:rec={item.recommended === 'fixed'}>
			<span class="k">{tx('Стоп-лимит', 'Stop-limit')}{#if item.recommended === 'fixed'} <i>{tx('рекомендую', 'recommended')}</i>{/if}</span>
			<span>{tx('стоп', 'stop')} <b>{pt(item.f.stop)}</b> · {tx('лимит', 'limit')} {pt(item.f.limit)}</span>
			{#if item.maxLoss}<span class="small muted">{tx('убыток до стопа', 'loss to the stop')} {money(item.maxLoss.fixed, item.maxLoss.currency)} ({pct1(item.maxLoss.pctFixed)} {tx('портфеля', 'of the portfolio')})</span>{/if}
		</div>
		<div class="main" class:rec={item.recommended === 'trail'}>
			<span class="k">{tx('Трейлинг', 'Trailing')}{#if item.recommended === 'trail'} <i>{tx('рекомендую', 'recommended')}</i>{/if}</span>
			<span><b>{item.f.trailPct}%</b> · {tx('сейчас', 'now')} {pt(item.f.trailStop)}</span>
			{#if item.maxLoss}<span class="small muted">{tx('убыток до стопа', 'loss to the stop')} {money(item.maxLoss.trail, item.maxLoss.currency)} ({pct1(item.maxLoss.pctTrail)})</span>{/if}
		</div>
	</div>
	<p class="why small">{tx('Почему', 'Why')}: {why}. {tx('Тип', 'Kind')}: {tx(...TYPE_WHY[item.why])}.</p>
	{#if item.size}
		<p class="small">
			{tx('Размер', 'Size')}: <b>{qtyText(item.size.qty)}</b> {tx('шт.', 'sh.')} · {money(item.size.amount, item.currency === 'USD' ? 'USD' : 'ILS')}
			<span class="muted">— {tx(`риск ${money(item.size.budget, item.currency === 'USD' ? 'USD' : 'ILS')} портфеля «${item.size.portfolio}»`, `risking ${money(item.size.budget, item.currency === 'USD' ? 'USD' : 'ILS')} of «${item.size.portfolio}»`)}</span>
		</p>
	{/if}
	{#if item.approx}<p class="small warn">{tx('Приблизительно: дневной истории нет, ATR оценён по месячным колебаниям. История загружается.', 'Approximate: no daily history, the ATR is estimated from the monthly swings. The history is loading.')}</p>{/if}

	{#if item.position}
		{#if !sheet}
			<button class="cta" class:hot={item.status === 'unprotected'} onclick={() => (reset(), (sheet = true))}>{item.order ? tx('Изменить стоп', 'Change the stop') : tx('Шпаргалка для брокера', 'Cheat sheet for the broker')}</button>
		{:else}
			<div class="cheat">
				<div class="seg" role="radiogroup" aria-label={tx('Тип стопа', 'Stop kind')}>
					<button role="radio" aria-checked={type === 'fixed'} class:on={type === 'fixed'} onclick={() => (type = 'fixed')}>{tx('Стоп-лимит', 'Stop-limit')}</button>
					<button role="radio" aria-checked={type === 'trail'} class:on={type === 'trail'} onclick={() => (type = 'trail')}>{tx('Трейлинг', 'Trailing')}</button>
				</div>
				{#if type === 'fixed'}
					<div class="edit">
						<label>{tx('Стоп', 'Stop')} <input inputmode="decimal" bind:value={stop} /></label>
						<label>{tx('Лимит', 'Limit')} <input inputmode="decimal" bind:value={limit} /></label>
					</div>
				{:else}
					<div class="edit"><label>{tx('Трейлинг, %', 'Trail, %')} <input inputmode="decimal" bind:value={trail} /></label></div>
				{/if}
				{#if lowered}<p class="small err">{tx(`Стоп можно только поднимать: сейчас у брокера ${pt(item.order?.level)}.`, `A stop is only raised: at the broker now ${pt(item.order?.level)}.`)}</p>{/if}
				<ul class="rows">
					{#each rows as [label, shown, value] (label)}
						<li><button onclick={() => copy(value, label)}><span class="muted">{label}</span><b>{shown}</b><Copy size={14} /></button></li>
					{/each}
				</ul>
				{#if loss !== null && item.maxLoss}<p class="small muted">{tx('Убыток до стопа', 'Loss to the stop')}: {money(loss, item.maxLoss.currency)}</p>{/if}
				<div class="acts">
					<button class="primary" disabled={busy || lowered} onclick={placed}>{tx(`Я выставил ${at}`, `I placed it ${at}`)}</button>
					<button class="ghost" onclick={() => (sheet = false)}>{tx('Позже', 'Later')}</button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.pi {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.pi p {
		margin: 0;
	}
	.st {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-s);
	}
	.st.protected {
		color: var(--up);
	}
	.st.unprotected {
		color: var(--down);
	}
	.st.near {
		color: var(--warn-text);
	}
	.st.declined {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.muted {
		color: var(--muted);
	}
	.warn {
		color: var(--warn-text);
	}
	.err {
		color: var(--down);
	}
	.plan {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		font-size: var(--fs-s);
		font-variant-numeric: tabular-nums;
	}
	.main.rec {
		border-color: var(--accent);
	}
	.k {
		font-weight: 600;
	}
	.k i {
		display: block;
		font-style: normal;
		font-weight: 500;
		font-size: var(--fs-xs);
		color: var(--accent);
	}
	.why {
		color: var(--muted);
	}
	.cta {
		min-height: var(--tap);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.cta.hot {
		border: none;
		background: var(--down);
		color: #fff;
		font-weight: 600;
	}
	.cheat {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.seg {
		display: flex;
		gap: 6px;
	}
	.seg button {
		flex: 1;
		min-height: 36px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg button.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
	}
	.edit {
		display: flex;
		gap: 8px;
	}
	.edit label {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.edit input {
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 40px;
		border: none;
		border-top: 1px solid var(--line);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		text-align: left;
		cursor: pointer;
	}
	.rows button span {
		flex: 1;
	}
	.rows button b {
		font-variant-numeric: tabular-nums;
	}
	.acts {
		display: flex;
		gap: 8px;
	}
	.acts button {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border-radius: var(--r2);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.primary {
		flex: 1;
		border: none;
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.primary:disabled {
		opacity: 0.5;
	}
	.ghost {
		border: 1px solid var(--line);
		background: none;
		color: var(--text);
	}
</style>
