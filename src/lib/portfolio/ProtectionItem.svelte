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
	/** T-035: the take-profit; empty — none (a growth position keeps the trailing stop instead) */
	let tp = $state('');
	// owner 28.11.2026: every level as a price and as a percent at once — typing one fills the other
	let stopPct = $state('');
	let limitPct = $state('');
	let trailPrice = $state('');
	let tpPct = $state('');
	let busy = $state(false);
	let el: HTMLElement | undefined = $state();

	const u = $derived(item.priceUnit);
	const pt = (x: number | null | undefined) => priceText(x ?? null, u);
	const num = (s: string) => {
		const x = Number(s.replace(',', '.').replace(/\s/g, ''));
		return s.trim() && Number.isFinite(x) ? x : null;
	};
	const pct1 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
	// ── a price ↔ a percent ↔ money ───────────────────────────────────────────────────────────────────────
	const P = $derived(item.price);
	const q = $derived(item.calc?.qty ?? item.position?.qty ?? item.size?.qty ?? 0);
	/** money (the portfolio's currency) of a move of `d` price units on the whole position */
	const onPos = (d: number) => (item.calc ? d * q * item.calc.perUnit : null);
	const ofPortfolio = (x: number | null) => (x !== null && item.calc && item.calc.portfolioValue > 0 ? (x / item.calc.portfolioValue) * 100 : null);
	const cur = $derived(item.calc?.currency ?? item.maxLoss?.currency ?? 'USD');
	const pctTxt = (x: number | null | undefined, sign = true) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`);
	const pctIn = (x: number) => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : '');
	const below = (level: number | null) => (level ? (1 - level / P) * 100 : null);
	const above = (level: number | null) => (level ? (level / P - 1) * 100 : null);
	/** the stop against the purchase price: what it keeps, or what it loses from the purchase */
	const vsBuy = (level: number | null) => (level && item.calc?.avgPrice ? (level / item.calc.avgPrice - 1) * 100 : null);
	function syncFromPrices() {
		stopPct = pctIn(below(num(stop)) ?? NaN);
		limitPct = num(stop) && num(limit) ? pctIn((1 - num(limit)! / num(stop)!) * 100) : '';
		trailPrice = num(trail) !== null ? plain(P * (1 - num(trail)! / 100), u) : '';
		tpPct = pctIn(above(num(tp)) ?? NaN);
	}
	const onStop = () => ((stopPct = pctIn(below(num(stop)) ?? NaN)), num(limitPct) !== null && num(stop) && (limit = plain(num(stop)! * (1 - num(limitPct)! / 100), u)));
	const onStopPct = () => ((stop = num(stopPct) !== null ? plain(P * (1 - num(stopPct)! / 100), u) : ''), num(limitPct) !== null && num(stop) && (limit = plain(num(stop)! * (1 - num(limitPct)! / 100), u)));
	const onLimit = () => (limitPct = num(stop) && num(limit) ? pctIn((1 - num(limit)! / num(stop)!) * 100) : '');
	const onLimitPct = () => (limit = num(stop) && num(limitPct) !== null ? plain(num(stop)! * (1 - num(limitPct)! / 100), u) : '');
	const onTrail = () => (trailPrice = num(trail) !== null ? plain(P * (1 - num(trail)! / 100), u) : '');
	const onTrailPrice = () => (trail = num(trailPrice) ? pctIn((1 - num(trailPrice)! / P) * 100) : '');
	const onTp = () => (tpPct = pctIn(above(num(tp)) ?? NaN));
	const onTpPct = () => (tp = num(tpPct) !== null ? plain(P * (1 + num(tpPct)! / 100), u) : '');
	/** the level the order would sell at now */
	const exitLevel = $derived(type === 'fixed' ? num(stop) : num(trail) !== null ? P * (1 - num(trail)! / 100) : null);
	const riskMoney = $derived(exitLevel !== null ? onPos(P - exitLevel) : null);
	const gainMoney = $derived(num(tp) ? onPos(num(tp)! - P) : null);
	const rr = $derived(riskMoney && gainMoney && riskMoney > 0 ? gainMoney / riskMoney : null);

	const at = $derived(item.broker ? tx(`в ${item.broker}`, `at ${item.broker}`) : tx('у брокера', 'at the broker'));

	function reset() {
		type = item.recommended;
		stop = plain(item.f.stop, u);
		limit = plain(item.f.limit, u);
		trail = String(item.f.trailPct);
		tp = item.recommended === 'trail' ? '' : plain(item.f.target, u);
		syncFromPrices();
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
		const base = { positionId: item.position.id, type, price: item.price, qty: item.position.qty, takeProfit: num(tp) };
		const body = type === 'fixed' ? { ...base, stop: num(stop), limit: num(limit) } : { ...base, trailPct: num(trail) };
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
	const unitSign = $derived(u === 'ILA' ? tx('аг.', 'ag.') : u === 'USD' ? '$' : '₪');
	const qtyNow = $derived(item.position?.qty ?? item.size?.qty ?? 0);
	const rows = $derived(
		type === 'fixed'
			? [
					[tx('Тип заявки', 'Order type'), 'Stop Limit', 'Stop Limit'],
					[tx('Стоп', 'Stop'), stop, stop],
					[tx('Лимит', 'Limit'), limit, limit],
					[tx('Количество', 'Quantity'), qtyText(qtyNow), String(qtyNow)],
					[tx('Срок', 'Time in force'), 'GTC', 'GTC'],
					...(num(tp) ? [[tx('Тейк-профит (Limit, продажа)', 'Take-profit (Limit, sell)'), tp, tp]] : [])
				]
			: [
					[tx('Тип заявки', 'Order type'), 'Trailing Stop %', 'Trailing Stop'],
					[tx('Трейлинг, %', 'Trail, %'), trail, trail],
					[tx('Количество', 'Quantity'), qtyText(qtyNow), String(qtyNow)],
					[tx('Срок', 'Time in force'), 'GTC', 'GTC'],
					...(num(tp) ? [[tx('Тейк-профит (Limit, продажа)', 'Take-profit (Limit, sell)'), tp, tp]] : [])
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
			{#if item.order.takeProfit}{tx('цель', 'target')} {pt(item.order.takeProfit)} · {/if}{#if item.order.type === 'fixed'}{tx('стоп-лимит', 'stop-limit')} {pt(item.order.stop)}{#if item.order.limitPrice} / {pt(item.order.limitPrice)}{/if}
			{:else}{tx('трейлинг', 'trailing')} {item.order.trailPct}% · {tx('уровень сейчас', 'level now')} <b>{pt(item.order.level)}</b>{/if}
		</p>
	{/if}

	<div class="plan">
		<div class="main" class:rec={item.recommended === 'fixed'}>
			<span class="k">{tx('Стоп-лимит', 'Stop-limit')}{#if item.recommended === 'fixed'} <i>{tx('рекомендую', 'recommended')}</i>{/if}</span>
			<span>{tx('стоп', 'stop')} <b>{pt(item.f.stop)}</b> <span class="d">{pctTxt(-(below(item.f.stop) ?? 0))}</span></span>
			<span class="small">{tx('лимит', 'limit')} {pt(item.f.limit)} <span class="d">{pctTxt(-(below(item.f.limit) ?? 0))}</span></span>
			<span class="small muted">{tx('на акцию', 'a share')} −{pt(P - item.f.stop)}{#if onPos(P - item.f.stop) !== null} · {tx('на позиции', 'on the position')} −{money(onPos(P - item.f.stop)!, cur)} ({pct1(ofPortfolio(onPos(P - item.f.stop)))} {tx('портфеля', 'of the portfolio')}){/if}</span>
			{#if vsBuy(item.f.stop) !== null}<span class="small" class:up={vsBuy(item.f.stop)! > 0} class:down={vsBuy(item.f.stop)! < 0}>{vsBuy(item.f.stop)! > 0 ? tx(`сохранит ${pctTxt(vsBuy(item.f.stop))} к цене покупки`, `keeps ${pctTxt(vsBuy(item.f.stop))} over the purchase`) : tx(`${pctTxt(vsBuy(item.f.stop))} от цены покупки`, `${pctTxt(vsBuy(item.f.stop))} from the purchase`)}</span>{/if}
		</div>
		<div class="main" class:rec={item.recommended === 'trail'}>
			<span class="k">{tx('Трейлинг', 'Trailing')}{#if item.recommended === 'trail'} <i>{tx('рекомендую', 'recommended')}</i>{/if}</span>
			<span><b>{item.f.trailPct}%</b> = {tx('стоп сейчас', 'stop now')} <b>{pt(item.f.trailStop)}</b></span>
			<span class="small muted">{tx('идёт за ценой вверх, вниз не опускается', 'follows the price up, never down')}</span>
			<span class="small muted">{tx('на акцию', 'a share')} −{pt(P - item.f.trailStop)}{#if onPos(P - item.f.trailStop) !== null} · {tx('на позиции', 'on the position')} −{money(onPos(P - item.f.trailStop)!, cur)} ({pct1(ofPortfolio(onPos(P - item.f.trailStop)))} {tx('портфеля', 'of the portfolio')}){/if}</span>
			{#if vsBuy(item.f.trailStop) !== null}<span class="small" class:up={vsBuy(item.f.trailStop)! > 0} class:down={vsBuy(item.f.trailStop)! < 0}>{vsBuy(item.f.trailStop)! > 0 ? tx(`сохранит ${pctTxt(vsBuy(item.f.trailStop))} к цене покупки`, `keeps ${pctTxt(vsBuy(item.f.trailStop))} over the purchase`) : tx(`${pctTxt(vsBuy(item.f.trailStop))} от цены покупки`, `${pctTxt(vsBuy(item.f.trailStop))} from the purchase`)}</span>{/if}
		</div>
	</div>
	<p class="small muted">{tx('Цена сейчас', 'Price now')} <b>{pt(P)}</b>{#if item.calc?.avgPrice} · {tx('покупка', 'bought at')} {pt(item.calc.avgPrice)} ({pctTxt((P / item.calc.avgPrice - 1) * 100)}){/if}{#if q} · {qtyText(q)} {tx('шт.', 'sh.')}{/if}</p>
	<p class="why small">{tx('Почему', 'Why')}: {why}. {tx('Тип', 'Kind')}: {tx(...TYPE_WHY[item.why])}.</p>
	<p class="small tpline">
		{#if item.recommended === 'trail'}
			{tx('Цель', 'Target')}: <b>{tx('не ставь — держи трейлинг', 'none — keep the trailing stop')}</b> <span class="muted">({tx(`если нужна: ${pt(item.f.target)}, ${pctTxt(above(item.f.target))}`, `if you want one: ${pt(item.f.target)}, ${pctTxt(above(item.f.target))}`)})</span>
		{:else}
			{tx('Цель (тейк-профит)', 'Target (take-profit)')}: <b>{pt(item.f.target)}</b> <span class="d up">{pctTxt(above(item.f.target))}</span>{#if onPos(item.f.target - P) !== null} · +{money(onPos(item.f.target - P)!, cur)}{/if} · {tx(`${String(item.f.targetR).replace('.', ',')} риска: прибыль в ${String(item.f.targetR).replace('.', ',')} раза больше убытка до стопа`, `${item.f.targetR} risks: the gain is ${item.f.targetR}× the loss to the stop`)}{#if item.f.resistance}<span class="muted"> — {tx(`под максимумом 52 недель ${pt(item.f.resistance)}`, `under the 52 weeks' high ${pt(item.f.resistance)}`)}{#if item.f.targetR < 1.5}; {tx('до него мало места — сделка так себе', 'little room to it — a weak trade')}{/if}</span>{/if}
		{/if}
		<HelpIcon topicKey="trade.orders" label={tx('виды заявок', 'order types')} />
	</p>
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
				<p class="small muted">{tx(`Цена сейчас ${pt(P)}. В каждой строке — цена или процент: введи одно, второе посчитается.`, `Price now ${pt(P)}. Each line — a price or a percent: type one, the other is computed.`)}</p>
				{#if type === 'fixed'}
					<div class="pair">
						<span class="pl">{tx('Стоп', 'Stop')}</span>
						<label class="pin"><input inputmode="decimal" bind:value={stop} oninput={onStop} aria-label={tx('Стоп, цена', 'Stop, price')} /><span>{unitSign}</span></label>
						<label class="pin"><input inputmode="decimal" bind:value={stopPct} oninput={onStopPct} aria-label={tx('Стоп, % ниже цены', 'Stop, % under the price')} /><span>% {tx('ниже цены', 'under')}</span></label>
					</div>
					<p class="hint">{#if num(stop)}{tx('на акцию', 'a share')} −{pt(P - num(stop)!)}{#if onPos(P - num(stop)!) !== null} · {tx('на позиции', 'on the position')} −{money(onPos(P - num(stop)!)!, cur)} ({pct1(ofPortfolio(onPos(P - num(stop)!)))} {tx('портфеля', 'of the portfolio')}){/if}{#if vsBuy(num(stop)) !== null} · {tx('к покупке', 'vs the purchase')} {pctTxt(vsBuy(num(stop)))}{/if}{/if}</p>
					<div class="pair">
						<span class="pl">{tx('Лимит', 'Limit')}</span>
						<label class="pin"><input inputmode="decimal" bind:value={limit} oninput={onLimit} aria-label={tx('Лимит, цена', 'Limit, price')} /><span>{unitSign}</span></label>
						<label class="pin"><input inputmode="decimal" bind:value={limitPct} oninput={onLimitPct} aria-label={tx('Лимит, % ниже стопа', 'Limit, % under the stop')} /><span>% {tx('ниже стопа', 'under stop')}</span></label>
					</div>
					<p class="hint">{tx('Не продаст дешевле лимита: при обвале ниже него заявка может не исполниться.', 'It will not sell under the limit: in a crash below it the order may not fill.')}</p>
				{:else}
					<div class="pair">
						<span class="pl">{tx('Трейлинг', 'Trailing')}</span>
						<label class="pin"><input inputmode="decimal" bind:value={trail} oninput={onTrail} aria-label={tx('Трейлинг, %', 'Trail, %')} /><span>%</span></label>
						<label class="pin"><input inputmode="decimal" bind:value={trailPrice} oninput={onTrailPrice} aria-label={tx('Стоп сейчас, цена', 'Stop now, price')} /><span>{unitSign} {tx('сейчас', 'now')}</span></label>
					</div>
					<p class="hint">{#if num(trail) !== null}{tx(`Стоп сейчас ${pt(P * (1 - num(trail)! / 100))}; цена выросла до ${pt(P * 1.1)} — стоп поднимется до ${pt(P * 1.1 * (1 - num(trail)! / 100))}.`, `Stop now ${pt(P * (1 - num(trail)! / 100))}; the price up to ${pt(P * 1.1)} — the stop goes up to ${pt(P * 1.1 * (1 - num(trail)! / 100))}.`)}{#if onPos((P * num(trail)!) / 100) !== null}&nbsp;{tx('Сейчас на позиции', 'Now on the position')} −{money(onPos((P * num(trail)!) / 100)!, cur)} ({pct1(ofPortfolio(onPos((P * num(trail)!) / 100)))} {tx('портфеля', 'of the portfolio')}){#if vsBuy(P * (1 - num(trail)! / 100)) !== null}, {tx('к покупке', 'vs the purchase')} {pctTxt(vsBuy(P * (1 - num(trail)! / 100)))}{/if}.{/if}{/if}</p>
				{/if}
				<div class="pair">
					<span class="pl">{tx('Цель', 'Target')}</span>
					<label class="pin"><input inputmode="decimal" bind:value={tp} oninput={onTp} placeholder={plain(item.f.target, u)} aria-label={tx('Тейк-профит, цена', 'Take-profit, price')} /><span>{unitSign}</span></label>
					<label class="pin"><input inputmode="decimal" bind:value={tpPct} oninput={onTpPct} placeholder={pctIn(above(item.f.target) ?? NaN)} aria-label={tx('Тейк-профит, % выше цены', 'Take-profit, % over the price')} /><span>% {tx('выше', 'over')}</span></label>
				</div>
				<p class="hint">{#if num(tp)}{tx('на акцию', 'a share')} +{pt(num(tp)! - P)}{#if gainMoney !== null} · {tx('на позиции', 'on the position')} +{money(gainMoney, cur)}{/if}{:else}{tx('Пусто — без цели (для трейлинга так и задумано).', 'Empty — no target (as meant for a trailing stop).')}{/if}</p>
				{#if riskMoney !== null}
					<p class="rr">
						{tx('Риск', 'Risk')} <b class="down">−{money(riskMoney, cur)}</b> ({pct1(ofPortfolio(riskMoney))} {tx('портфеля', 'of the portfolio')})
						{#if gainMoney !== null} · {tx('цель', 'target')} <b class="up">+{money(gainMoney, cur)}</b> · {tx('соотношение', 'ratio')} <b>1 : {rr !== null ? rr.toFixed(1).replace('.', tx(',', '.')) : '—'}</b>{/if}
						<HelpIcon topicKey="trade.stop" label={tx('стоп, цель и риск', 'stop, target and risk')} />
					</p>
				{/if}
				{#if lowered}<p class="small err">{tx(`Стоп можно только поднимать: сейчас у брокера ${pt(item.order?.level)}.`, `A stop is only raised: at the broker now ${pt(item.order?.level)}.`)}</p>{/if}
				<ul class="rows">
					{#each rows as [label, shown, value] (label)}
						<li><button onclick={() => copy(value, label)}><span class="muted">{label}</span><b>{shown}</b><Copy size={14} /></button></li>
					{/each}
				</ul>
				{#if num(tp)}
					<p class="small oco">
						{#if item.oco === true}{tx('Выставь стоп и цель одной заявкой OCO: сработает одна — вторая снимется сама.', 'Place the stop and the target as one OCO order: when one fills, the other is cancelled.')}
						{:else if item.oco === false}{tx('Две отдельные заявки. Когда сработает одна — сразу сними вторую, иначе она продаст то, чего уже нет.', 'Two separate orders. When one fills, cancel the other at once, or it will sell what is no longer there.')}
						{:else}{tx('Если брокер умеет OCO — выставь стоп и цель одной заявкой (сработает одна — вторая снимется). Если нет — две отдельные, и когда сработает одна, сразу сними вторую.', 'If the broker takes OCO — place the stop and the target as one order. If not — two separate ones, and when one fills, cancel the other at once.')}{/if}
					</p>
				{/if}
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
	.d {
		font-size: var(--fs-xs);
		color: var(--down);
		font-variant-numeric: tabular-nums;
	}
	.d.up,
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px 8px;
		align-items: center;
	}
	.pl {
		grid-column: 1 / -1;
		font-size: var(--fs-s);
		font-weight: 600;
	}
	.pin {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.pin input {
		flex: 1;
		min-width: 0;
		width: 100%;
	}
	.pin span {
		white-space: nowrap;
	}
	.hint {
		margin: 0 0 8px !important;
		font-size: var(--fs-xs);
		color: var(--muted);
		line-height: 1.4;
	}
	.rr {
		padding: 8px 10px;
		border-radius: var(--r2);
		background: var(--surface-2);
		font-size: var(--fs-s);
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
	.tpline {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.oco {
		margin: 0;
		color: var(--muted);
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
	.pin input {
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
