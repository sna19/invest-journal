<script lang="ts">
	import { tl, tx } from '#lib/i18n.js';
	import { onMount } from 'svelte';
	import TickerSearch, { rememberSecurity, type Security } from '../TickerSearch.svelte';
	import { israelDate } from '../hypothesis.js';
	import { EVENT_LABEL, money, qtyText, unitFactor } from '../portfolio.js';
	import RiskLabel from '../RiskLabel.svelte';
	import Fold from '../Fold.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import TradePlan, { newDraft, planBody, type PlanDraft, type PlanKind } from './TradePlan.svelte';
	import BasisPicker from '../journal/BasisPicker.svelte';
	import RichEditor from '../journal/RichEditor.svelte';
	import { journalVersion } from '../journal/screen.svelte.js';

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
		/** T-020: a trade from a quarterly model's candidate card */
		/** T-031: cA, cB — the commodity funds' variants */
		modelVariant?: 'A' | 'B' | 'C' | 'D' | 'G' | 'cA' | 'cB' | null;
		lastFee?: Record<string, number>;
		/** the portfolio's currency: the whole purchase cost of a transferred position is in it */
		portfolioCurrency?: string;
		/** «Изменить» (owner's request, 18.11.2026): the event to correct — its date and numbers, in place */
		edit?: { id: number; date: string; qty: number | null; price: number | null; fee: number | null; amount: number | null; costTotal?: number | null; note: string | null } | null;
		/** T-023: a note to start from (a «Что если?» scenario) */
		initialNote?: string | null;
		/** T-015: the portfolio's value in its currency — the trade's risk in % of it */
		portfolioValue?: number | null;
		/** T-015: the position's conditions so far («Хочу купить» → «Купил» keeps them) */
		/** T-032 11б, Д-18: the purchase a sale answers — its thesis is shown with «Сбылось?» */
		buyForSale?: { id: number; type: string; basis: string; expectation: string | null; createdAt: string; html: string } | null;
		existingPlan?: { kind: PlanKind; thesis: string | null; wrongIf: string | null; stop: number | null; target: number | null; reviewDate: string | null; noStopReason: string | null } | null;
		onsaved: (positionId: number) => void;
		oncancel: () => void;
	}
	let { portfolioId, kind, position = null, securityId = null, hypothesisId = null, modelVariant = null, lastFee = {}, portfolioCurrency = 'ILS', edit = null, initialNote = null, portfolioValue = null, existingPlan = null, buyForSale = null, onsaved, oncancel }: Props = $props();
	let costTotal = $state('');
	let warning = $state<string | null>(null);

	const today = israelDate();
	let sec = $state<{ id: number; symbol: string; name: string; currency: string; priceUnit: string } | null>(null);
	let date = $state(today);
	let qty = $state('');
	let price = $state('');
	let fee = $state('');
	let amount = $state('');
	const amount_ = $derived(amount);
	let note = $state('');
	let quoteDate = $state<string | null>(null);
	let fxUsd = $state<number | null>(null);
	let errors = $state<Record<string, string>>({});
	let ask = $state<string | null>(null);
	let saving = $state(false);
	let formError = $state<string | null>(null);

	const trade = $derived(kind === 'buy' || kind === 'sell' || kind === 'opening');

	// T-015: the conditions of a purchase, the review at a sale
	const withPlan = $derived(!edit && (kind === 'buy' || kind === 'plan_buy'));
	const withReview = $derived(!edit && kind === 'sell');
	const planKinds = $derived<PlanKind[]>([...(modelVariant ? (['model'] as const) : []), ...(hypothesisId ? (['hypothesis'] as const) : []), 'own', 'spec']);
	let tplan = $state<PlanDraft>(newDraft('own', israelDate()));
	let exitReason = $state<string | null>(null);
	let followed = $state<boolean | null>(null);
	const EXIT_REASONS: [string, string, string][] = [
		['stop', 'Стоп', 'Stop'],
		['target', 'Цель', 'Target'],
		['model', 'По модели', 'By the model'],
		['thesis_broken', 'Тезис сломан', 'Thesis broken'],
		['changed_mind', 'Передумал', 'Changed my mind']
	];
	let rules = $state<{ id: number; text: string }[]>([]);
	// T-016: a purchase that takes the job's industry over its limit or the speculation over its budget — warned, not refused
	let limitWarns = $state<string[]>([]);
	// T-019 (5): rule 2 — a model's trade later than the first 5 trading days of its quarter
	const lateModel = $derived.by(() => {
		if (!modelVariant || kind !== 'buy' || !date) return 0;
		const d = new Date(date + 'T12:00:00Z');
		const start = new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1, 12));
		let n = 0;
		for (let t = new Date(start); t <= d; t = new Date(t.getTime() + 86_400_000)) if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) n++;
		return n > 5 ? n : 0;
	});
	// T-019 (5): selling a position in profit while others are «held without a thesis» — the disposition effect
	let disposition = $state<string | null>(null);
	$effect(() => {
		if (kind !== 'sell' || !position) return void (disposition = null);
		const pid = position.id;
		fetch(`/api/portfolios/${portfolioId}/riskreport?only=reviews`)
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => {
				const rows = (j?.reviews?.rows ?? []) as { positionId: number; symbol: string; unrealizedPct: number | null; noThesis: boolean }[];
				const me = rows.find((r) => r.positionId === pid);
				const held = rows.filter((r) => r.noThesis && r.positionId !== pid).map((r) => r.symbol);
				disposition = me && (me.unrealizedPct ?? 0) > 0 && held.length ? tx(`Продаёшь позицию в прибыли, а держишь без тезиса: ${held.join(', ')}. Эффект диспозиции — продавать прибыльные и держать убыточные; может, продать стоит их?`, `You sell a position in profit while holding without a thesis: ${held.join(', ')}. The disposition effect — selling winners and keeping losers; maybe those are the ones to sell?`) : null;
			})
			.catch(() => (disposition = null));
	});
	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const amount = kind === 'buy' ? total : kind === 'plan_buy' ? (n(amount_) ?? (n(qty) && n(price) && sec ? n(qty)! * n(price)! * unitFactor(sec.priceUnit) : null)) : null;
		const k = tplan.kind;
		clearTimeout(checkTimer);
		if (!withPlan || !sec || !amount) return void (limitWarns = []);
		const toPc = sec.currency === portfolioCurrency ? 1 : fxUsd ? (sec.currency === 'USD' ? fxUsd : 1 / fxUsd) : 1;
		const sid = sec.id;
		checkTimer = setTimeout(async () => {
			const r = await fetch(`/api/portfolios/${portfolioId}/check?security=${sid}&amount=${Math.round(amount * toPc)}&kind=${k}`).then((x) => x.json()).catch(() => null);
			// T-019: each warning names the rule it comes from
			limitWarns = (r?.items ?? []).map((x: { rule: string; text: string }) => (x.rule === 'spec' ? `${tx('Правило 3: спекуляции — только из игрового бюджета.', 'Rule 3: speculation only from the play budget.')} ${x.text}` : x.text));
		}, 400);
	});
	// T-032 11б: the decision of a purchase or a sale — its basis (by default from the trade's kind or the purchase), the
	// sale's «Почему», «Сбылось?» and the conclusion
	let basisPicked = $state('');
	const basis = $derived(basisPicked || (kind === 'sell' ? (buyForSale?.basis ?? 'intuition') : tplan.kind === 'model' ? 'model' : tplan.kind === 'hypothesis' ? 'hypothesis' : 'intuition'));
	let why = $state('');
	let outcome = $state<string | null>(null);
	let conclusion = $state('');
	const OUTCOMES: [string, string, string][] = [
		['yes', 'Да', 'Yes'],
		['partly', 'Частично', 'Partly'],
		['no', 'Нет', 'No'],
		['early', 'Рано судить', 'Too early']
	];
	const plan = $derived(kind === 'plan_buy' || kind === 'plan_sell');
	const unitLabel = $derived(sec ? (sec.priceUnit === 'ILA' ? tx('агорот', 'agorot') : sec.currency === 'USD' ? '$' : '₪') : '');

	async function quote() {
		if (!sec) return;
		const r = await fetch(`/api/securities/${sec.id}/quote?date=${date}`).then((x) => x.json()).catch(() => null);
		if (!r) return;
		quoteDate = r.date;
		fxUsd = r.fxUsd;
		// the price follows the date until the person types their own
		if ((trade || kind === 'plan_buy') && kind !== 'basis' && r.close !== null && !priceTouched) price = String(Math.round(r.close * 10000) / 10000);
	}
	let priceTouched = false;

	// T-023 (4): what the purchase does to this portfolio's risk
	let risk = $state<{ label: string; twin: string | null } | null>(null);
	async function loadRisk(id: number) {
		risk = null;
		if (kind !== 'buy' && kind !== 'plan_buy') return;
		const r = await fetch(`/api/risk/labels?ids=${id}&portfolio=${portfolioId}`).then((x) => x.json()).catch(() => null);
		if (sec?.id === id && r?.items?.[id]) risk = r.items[id];
	}

	/** T-021: the stop of a purchase starts from the protective plan (the block «Защита») */
	let fromProtection = $state(false);
	async function protectionStop(id: number) {
		if (!tplan || existingPlan?.stop || tplan.stop.trim()) return;
		const r = await fetch(`/api/protection?security=${id}&portfolio=${portfolioId}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
		const it = r?.items?.[0];
		if (!it || !tplan || tplan.stop.trim() || sec?.id !== id) return;
		tplan.stop = it.priceUnit === 'ILA' ? String(Math.round(it.f.stop)) : String(it.f.stop);
		autoPlan = { base: it.price, stopK: it.f.stop / it.price, targetK: null, stop: tplan.stop, target: '', agorot: it.priceUnit === 'ILA' };
		tplan.stopPct = false;
		// T-035: the target too, unless the plan advises a trailing stop instead
		if (!tplan.target.trim() && it.recommended === 'fixed' && it.f.target) {
			tplan.target = it.priceUnit === 'ILA' ? String(Math.round(it.f.target)) : String(it.f.target);
			tplan.targetPct = false;
			if (autoPlan) ((autoPlan.targetK = it.f.target / it.price), (autoPlan.target = tplan.target));
		}
		// the size by the risk budget (the block «Защита»), unless typed
		if (it.size?.qty) {
			if (kind === 'buy' && !qty.trim()) qty = String(it.size.qty);
			if (kind === 'plan_buy' && !amount.trim()) amount = String(Math.round(it.size.amount));
		}
		// «что докажет, что я неправ» — at least the stop's close
		if (!tplan.wrongIf.trim()) tplan.wrongIf = tx(`Закрытие ниже стопа ${tplan.stop}`, `A close under the stop ${tplan.stop}`);
		fromProtection = true;
	}

	/** «Хочу купить» at another price: the protective plan's stop and target move with it, while not typed over */
	let autoPlan: { base: number; stopK: number; targetK: number | null; stop: string; target: string; agorot: boolean } | null = null;
	function rescale() {
		const x = n(price);
		if (!autoPlan || !x || !(x > 0)) return;
		const r = (v: number) => (autoPlan!.agorot ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
		if (tplan.stop === autoPlan.stop) tplan.stop = autoPlan.stop = r(x * autoPlan.stopK);
		if (autoPlan.targetK !== null && tplan.target === autoPlan.target) tplan.target = autoPlan.target = r(x * autoPlan.targetK);
		if (tplan.wrongIf.startsWith(tx('Закрытие ниже стопа ', 'A close under the stop '))) tplan.wrongIf = tx(`Закрытие ниже стопа ${tplan.stop}`, `A close under the stop ${tplan.stop}`);
	}

	/** the quant score's reading as the thesis of a purchase that comes with none (a security card, the search) */
	async function scoreThesis(id: number) {
		if (!tplan || tplan.thesis.trim() || hypothesisId || modelVariant || existingPlan) return;
		const j = await fetch(`/api/score?ids=${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
		const sc = j?.items?.[id] as { color: string; total: number | null; factors: Record<string, { grade: string | null }>; trend: { above: boolean } | null } | undefined;
		if (!sc || sc.total === null || !tplan || tplan.thesis.trim() || sec?.id !== id) return;
		const COLOR: Record<string, [string, string]> = { green: ['зелёная', 'green'], yellow: ['жёлтая', 'yellow'], red: ['красная', 'red'], grey: ['серая', 'grey'] };
		const F: [string, string, string][] = [['quality', 'качество', 'quality'], ['growth', 'рост', 'growth'], ['valuation', 'оценка', 'valuation'], ['momentum', 'моментум', 'momentum']];
		const grades = F.filter(([k]) => sc.factors[k]?.grade).map(([k, ru, en]) => `${tx(ru, en)} ${sc.factors[k].grade}`).join(', ');
		const trend = sc.trend ? (sc.trend.above ? tx('цена выше SMA200', 'the price is above its SMA200') : tx('цена ниже SMA200', 'the price is under its SMA200')) : '';
		tplan.thesis = tx(`Квант-оценка ${Math.round(sc.total * 100)} (${COLOR[sc.color]?.[0] ?? sc.color})`, `Quant score ${Math.round(sc.total * 100)} (${COLOR[sc.color]?.[1] ?? sc.color})`) + (grades ? `: ${grades}` : '') + (trend ? `; ${trend}` : '') + tx('. Почему именно она — допиши своими словами.', '. Why this one — add in your own words.');
		fromScore = true;
	}
	let fromScore = $state(false);

	function use(s: { id: number; symbol: string; name: string; currency: string; priceUnit: string }) {
		sec = s;
		void loadRisk(s.id);
		if ((kind === 'buy' || kind === 'plan_buy') && !edit) {
			void protectionStop(s.id);
			void scoreThesis(s.id);
		}
		if (trade && fee === '') fee = lastFee[s.currency] !== undefined ? String(lastFee[s.currency]) : '';
		quote();
	}

	onMount(async () => {
		if (initialNote && !edit) note = initialNote;
		if (withPlan) {
			tplan = newDraft(modelVariant ? 'model' : hypothesisId ? 'hypothesis' : 'own', israelDate());
			fetch('/api/rules').then((r) => r.json()).then((j) => (rules = j.items ?? [])).catch(() => {});
			if (existingPlan) {
				const t = (x: number | null) => (x === null ? '' : String(x));
				tplan = { ...tplan, kind: planKinds.includes(existingPlan.kind) ? existingPlan.kind : tplan.kind, thesis: existingPlan.thesis ?? '', wrongIf: existingPlan.wrongIf ?? '', stop: t(existingPlan.stop), stopPct: existingPlan.stop === null, target: t(existingPlan.target), targetPct: existingPlan.target === null, reviewDate: existingPlan.reviewDate ?? tplan.reviewDate, noStop: !!existingPlan.noStopReason, noStopReason: existingPlan.noStopReason ?? '' };
			} else if (hypothesisId) {
				const h = await fetch(`/api/hypotheses/${hypothesisId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
				if (h && !tplan.thesis) {
					tplan.thesis = h.thesis ?? '';
					tplan.wrongIf = h.invalidation ?? '';
					if (h.horizonDate) tplan.reviewDate = h.horizonDate;
				}
			} else if (modelVariant && !tplan.thesis) {
				tplan.thesis = tx(`Квартальная модель${modelVariant.startsWith('c') ? ' (сырьё)' : ''}, вариант ${modelVariant.slice(-1)}: сезонно сильный квартал — держу до конца квартала`, `Quarterly model${modelVariant.startsWith('c') ? ' (commodities)' : ''}, variant ${modelVariant.slice(-1)}: a seasonally strong quarter — held to the quarter's end`);
			}
		}
		if (edit) {
			const t = (x: number | null | undefined) => (x === null || x === undefined ? '' : String(x));
			date = edit.date;
			qty = t(edit.qty);
			price = t(edit.price);
			fee = t(edit.fee);
			amount = t(edit.amount);
			costTotal = t(edit.costTotal);
			note = edit.note ?? '';
			priceTouched = true;
		}
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
			...(edit ? {} : position ? { positionId: position.id } : { securityId: sec.id }),
			kind,
			date,
			qty: trade ? qty : undefined,
			price: trade || plan || kind === 'basis' ? price : undefined,
			fee: trade ? fee : undefined,
			amount: kind === 'plan_buy' ? amount : undefined,
			costTotal: kind === 'basis' ? costTotal : undefined,
			note,
			hypothesisId: edit ? undefined : hypothesisId,
			modelVariant: edit ? undefined : (modelVariant ?? undefined),
			plan: withPlan ? planBody(tplan, n(price)) : undefined,
			review: withReview ? { reason: exitReason, followed } : undefined,
			discipline: edit ? undefined : true,
			decision: edit || (kind !== 'buy' && kind !== 'sell') ? undefined : { basis, why: kind === 'sell' ? why : undefined, outcome: kind === 'sell' ? outcome : undefined, conclusion: kind === 'sell' ? conclusion : undefined },
			confirm
		};
		try {
			const r = edit
				? await fetch(`/api/events/${edit.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
				: await fetch(`/api/portfolios/${portfolioId}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			const j = await r.json().catch(() => ({}));
			if (r.status === 409 && j.confirm) {
				ask = j.message;
				return;
			}
			if (!r.ok) {
				errors = j.errors ?? {};
				formError = tl(j.message) || tx('Не сохранилось', 'Not saved');
				return;
			}
			ask = null;
			// the diary, its feeds and the history show the new decision at once
			journalVersion.n++;
			// a buy without enough money only warns (section 18)
			if (j.warning) {
				warning = j.warning;
				setTimeout(() => onsaved(j.positionId), 2500);
				return;
			}
			onsaved(j.positionId ?? position?.id);
		} catch {
			formError = tx('Нет связи с сервером', 'No connection to the server');
		} finally {
			saving = false;
		}
	}
</script>

<div class="form">
	{#if withPlan && rules.length}
		<Fold key="buy-rules" title={tx('Мои правила', 'My rules')} open={false} summary={tx(`${rules.length} — пробеги глазами перед покупкой`, `${rules.length} — glance over them before buying`)} remind="trade.rules">
			{#snippet aside()}<HelpIcon topicKey="trade.rules" label={tx('мои правила', 'my rules')} />{/snippet}
			<ol class="rules">
				{#each rules as r (r.id)}<li>{r.text}</li>{/each}
			</ol>
			<a class="small" href="/rules">{tx('Изменить', 'Edit')}</a>
		</Fold>
	{/if}
	{#if !sec}
		<TickerSearch onselect={picked} noIndex withManual label={tx('Бумага', 'Security')} autofocus />
	{:else}
		<p class="sec"><b>{sec.symbol}</b> <span class="muted">{sec.name}</span></p>
	{/if}

	{#if sec && risk && risk.label !== 'held'}
		<p class="risk">{tx('Для риска портфеля', 'For the portfolio\'s risk')}: <RiskLabel label={risk.label} twin={risk.twin} /></p>
	{/if}
	{#if sec}
		<div class="row">
			<label>
				<span>{tx('Дата', 'Date')}</span>
				<input type="date" max={today} bind:value={date} onchange={quote} />
				{#if errors.date}<em class="err">{errors.date}</em>{/if}
			</label>
			{#if trade}
				<label>
					<span>{tx('Количество', 'Quantity')}{#if kind === 'sell' && position}<button type="button" class="all" onclick={() => (qty = String(position!.qty))}>{tx('всё', 'all')}: {qtyText(position.qty)}</button>{/if}</span>
					<input inputmode="decimal" bind:value={qty} placeholder="0" />
					{#if errors.qty}<em class="err">{errors.qty}</em>{/if}
				</label>
			{/if}
		</div>

		{#if trade || plan}
			<div class="row">
				<label>
					<span>{plan ? tx('Желаемая цена', 'Desired price') : tx('Цена', 'Price')}, {unitLabel}</span>
					<input inputmode="decimal" bind:value={price} oninput={() => ((priceTouched = true), rescale())} placeholder={plan ? tx('необязательно', 'optional') : ''} />
					{#if quoteDate && !plan}<em class="hint">{tx('закрытие', 'close')} {quoteDate.split('-').reverse().join('.')}</em>{/if}
					{#if errors.price}<em class="err">{errors.price}</em>{/if}
				</label>
				{#if trade && kind !== 'opening'}
					<label>
						<span>{tx('Комиссия', 'Fee')}, {sec.currency === 'USD' ? '$' : '₪'}</span>
						<input inputmode="decimal" bind:value={fee} placeholder="0" />
						{#if errors.fee}<em class="err">{errors.fee}</em>{/if}
					</label>
				{:else if kind === 'plan_buy'}
					<label>
						<span>{tx('Сумма', 'Amount')}, {sec.currency === 'USD' ? '$' : '₪'}</span>
						<input inputmode="decimal" bind:value={amount} placeholder={tx('необязательно', 'optional')} />
					</label>
				{/if}
			</div>
		{/if}

		{#if total !== null && kind !== 'opening'}
			<p class="total">
				{kind === 'buy' ? tx('Списано', 'Paid') : tx('Получено', 'Received')}: <b>{money(total, sec.currency)}</b>
				{#if sec.currency === 'USD' && fxUsd}<span class="muted"> ≈ {money(total * fxUsd)} {tx('по курсу', 'at the rate')} {fxUsd}</span>{/if}
			</p>
		{/if}

		{#if kind === 'basis'}
			<div class="row">
				<label>
					<span>{tx('Средняя цена покупки', 'Average purchase price')}, {unitLabel}</span>
					<input inputmode="decimal" bind:value={price} placeholder={tx('или справа', 'or on the right')} />
				</label>
				<label>
					<span>{tx('Или вся стоимость покупки', 'Or the whole purchase cost')}, {portfolioCurrency === 'USD' ? '$' : '₪'}</span>
					<input inputmode="decimal" bind:value={costTotal} placeholder={tx('как у брокера', 'as at the broker')} />
				</label>
			</div>
			{#if errors.price}<em class="err">{errors.price}</em>{/if}
			{#if !edit}<p class="muted small">{tx('История не меняется: цена покупки запишется отдельным событием, прибыль будет считаться от неё, а не с даты переноса.', 'History does not change: the purchase price is recorded as a separate event, and profit counts from it, not from the carry-over date.')}</p>{/if}
		{/if}

		{#if withPlan}
			<TradePlan
				bind:plan={tplan}
				kinds={planKinds}
				entry={n(price)}
				qty={kind === 'buy' ? n(qty) : n(amount) && n(price) ? n(amount)! / (n(price)! * unitFactor(sec.priceUnit)) : null}
				priceUnit={sec.priceUnit}
				currency={sec.currency}
				{portfolioCurrency}
				{portfolioValue}
				{fxUsd}
				{errors}
			/>
			{#if fromProtection || fromScore}<p class="muted small">{fromProtection ? tx('Стоп, цель и размер — из защитного плана (по ATR и бюджету риска)', 'The stop, the target and the size come from the protective plan (by ATR and the risk budget)') : ''}{fromProtection && fromScore ? '; ' : fromProtection ? '. ' : ''}{fromScore ? tx('тезис — из квант-оценки. ', 'the thesis — from the quant score. ') : ''}{tx('Поправь, если не согласен.', 'Change them if you disagree.')} <HelpIcon topicKey="trade.stop" label={tx("стоп, цель и риск", "stop, target and risk")} /></p>{/if}
			{#if kind === 'buy'}<BasisPicker bind:basis={() => basis, (v) => (basisPicked = v)} />{/if}
		{/if}

		{#each limitWarns as w (w)}<p class="warnbox" role="status">{w}{#if w.startsWith(tx('Правило 3', 'Rule 3'))} <HelpIcon topicKey="trade.rules" label={tx('мои правила', 'my rules')} />{/if}</p>{/each}
		{#if lateModel}<p class="warnbox" role="status">{tx(`Правило 2: вход не по модели — прошло ${lateModel} торговых дней с начала квартала, а модель входит в первые 5. Лучше записать идею гипотезой-симуляцией, чем сделкой.`, `Rule 2: an entry off the model — ${lateModel} trading days since the quarter began, the model enters in the first 5. Better record the idea as a simulated hypothesis than as a trade.`)} <HelpIcon topicKey="trade.rules" label={tx('мои правила', 'my rules')} /></p>{/if}
		{#if disposition}<p class="warnbox" role="status">{disposition} <HelpIcon topicKey="portfolio.disposition" label={tx('эффект диспозиции', 'disposition effect')} /></p>{/if}
		{#if withReview}
			<div class="review">
				<span class="lbl">{tx('Почему продаю', 'Why I sell')} <HelpIcon topicKey="decision.basis" label={tx('решение', 'decision')} /></span>
				<RichEditor bind:value={why} minHeight="3.5em" placeholder={tx('Можно пусто — тогда решение пометится «без обоснования»', 'May be empty — then the decision is marked «no reason»')} />
				<BasisPicker bind:basis={() => basis, (v) => (basisPicked = v)} />
				{#if buyForSale}
					<div class="bought">
						<span class="lbl">{tx('Покупка', 'Purchase')} {new Date(buyForSale.createdAt).toLocaleDateString()}{buyForSale.expectation ? ` · ${buyForSale.expectation}` : ''}</span>
						<div class="thesis">{@html buyForSale.html}</div>
					</div>
					<span class="lbl">{tx('Сбылось?', 'Did it come true?')} <HelpIcon topicKey="decision.outcome" label={tx('сбылось ли', 'did it come true')} /></span>
					<div class="chips">
						{#each OUTCOMES as [k, ru, en] (k)}
							<button type="button" class:on={outcome === k} aria-pressed={outcome === k} onclick={() => (outcome = k)}>{tx(ru, en)}</button>
						{/each}
					</div>
					{#if errors.outcome}<em class="err">{errors.outcome}</em>{/if}
					<RichEditor bind:value={conclusion} minHeight="3em" placeholder={tx('Вывод: что подтвердилось, что нет, чему научился', 'Conclusion: what held, what did not, what I learned')} />
				{/if}
				<span class="lbl">{tx('Причина выхода', 'Reason for the exit')} <HelpIcon topicKey="trade.review" label={tx('разбор при продаже', 'review at the sale')} /></span>
				<div class="chips">
					{#each EXIT_REASONS as [k, ru, en] (k)}
						<button type="button" class:on={exitReason === k} aria-pressed={exitReason === k} onclick={() => (exitReason = k)}>{tx(ru, en)}</button>
					{/each}
				</div>
				{#if errors.exitReason}<em class="err">{errors.exitReason}</em>{/if}
				<span class="lbl">{tx('Правило соблюдено?', 'Was the rule kept?')}</span>
				<div class="chips">
					<button type="button" class:on={followed === true} aria-pressed={followed === true} onclick={() => (followed = true)}>{tx('Да', 'Yes')}</button>
					<button type="button" class:on={followed === false} aria-pressed={followed === false} onclick={() => (followed = false)}>{tx('Нет', 'No')}</button>
				</div>
				{#if errors.followed}<em class="err">{errors.followed}</em>{/if}
			</div>
		{/if}

		<label>
			<span>{kind === 'drop' ? tx('Почему передумал', 'Why I changed my mind') : plan ? tx('Причина', 'Reason') : kind === 'note' ? tx('Заметка', 'Note') : tx('Заметка (необязательно)', 'Note (optional)')}</span>
			<textarea rows="2" bind:value={note}></textarea>
			{#if errors.note}<em class="err">{errors.note}</em>{/if}
		</label>

		{#if warning}<p class="warnbox" role="status">{warning}</p>{/if}
		{#if ask}
			<div class="ask" role="alert">
				<p>{tl(ask)}</p>
				<div class="btns">
					<button class="primary" disabled={saving} onclick={() => save(true)}>{tx('Сохранить всё равно', 'Save anyway')}</button>
					<button class="ghost" onclick={() => (ask = null)}>{tx('Исправить', 'Fix')}</button>
				</div>
			</div>
		{:else}
			{#if formError}<p class="err">{formError}</p>{/if}
			<div class="btns">
				<button class="primary" disabled={saving} onclick={() => save()}>{saving ? tx('Сохраняю…', 'Saving…') : edit ? tx('Сохранить', 'Save') : EVENT_LABEL[kind]}</button>
				<button class="ghost" onclick={oncancel}>{tx('Отмена', 'Cancel')}</button>
			</div>
		{/if}
		{#if position && trade}<p class="muted small">{tx('В позиции сейчас', 'Position now')} {qtyText(position.qty)} · {tx('цены в', 'prices in')} {unitLabel}{sec.priceUnit === 'ILA' ? tx(' (не в шекелях)', ' (not shekels)') : ''}</p>{/if}
		{#if !position && sec.priceUnit === 'ILA' && trade}<p class="muted small">{tx('Цены бумаг TASE — в агоротах: 65 ₪ = 6 500 аг.', 'TASE prices are in agorot: ₪65 = 6,500 ag.')}</p>{/if}
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
	.warnbox {
		margin: 0;
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: var(--fs-s);
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
	.review {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.lbl {
		font-size: var(--fs-s);
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s1);
	}
	.chips button {
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.chips button.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.bought {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: var(--s2) var(--s3);
		border-left: 3px solid var(--accent);
		border-radius: var(--r1);
		background: var(--surface);
	}
	.thesis :global(p) {
		margin: 0;
	}
	.rules {
		margin: 0 0 var(--s2);
		padding-left: 1.2em;
		font-size: var(--fs-s);
	}
	.risk {
		margin: 0 0 var(--s2);
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
