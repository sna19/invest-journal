<script lang="ts" module>
	export type PlanKind = 'model' | 'hypothesis' | 'own' | 'spec';
	/** what the form holds; stop and target are typed as a price or as % from the entry */
	export interface PlanDraft {
		kind: PlanKind;
		thesis: string;
		wrongIf: string;
		stop: string;
		stopPct: boolean;
		target: string;
		targetPct: boolean;
		reviewDate: string;
		noStop: boolean;
		noStopReason: string;
	}
	export const PLAN_KIND_LABEL: Record<PlanKind, [string, string]> = {
		model: ['Модель', 'Model'],
		hypothesis: ['Гипотеза', 'Hypothesis'],
		own: ['Своя идея', 'Own idea'],
		spec: ['Спекуляция', 'Speculation']
	};

	/** the last day of the quarter of `date` (a model's period), or three months on */
	export function reviewDefault(kind: PlanKind, date: string) {
		const [y, m, d] = date.split('-').map(Number);
		if (kind === 'model') {
			const q = Math.ceil(m / 3);
			return new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
		}
		const last = new Date(Date.UTC(y, m - 1 + 4, 0)).getUTCDate();
		return new Date(Date.UTC(y, m - 1 + 3, Math.min(d, last))).toISOString().slice(0, 10);
	}

	export function newDraft(kind: PlanKind, date: string, thesis = ''): PlanDraft {
		return { kind, thesis, wrongIf: '', stop: '', stopPct: true, target: '', targetPct: true, reviewDate: reviewDefault(kind, date), noStop: false, noStopReason: '' };
	}

	const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.').replace(/\s/g, '')));
	const r4 = (x: number) => Math.round(x * 10000) / 10000;

	/** the stop as a price in the price unit, from a price or a % below the entry */
	export function stopPrice(p: PlanDraft, entry: number | null): number | null {
		const x = n(p.stop);
		if (x === null || !Number.isFinite(x)) return null;
		if (!p.stopPct) return x;
		return entry ? r4(entry * (1 - Math.abs(x) / 100)) : null;
	}
	export function targetPrice(p: PlanDraft, entry: number | null): number | null {
		const x = n(p.target);
		if (x === null || !Number.isFinite(x)) return null;
		if (!p.targetPct) return x;
		return entry ? r4(entry * (1 + Math.abs(x) / 100)) : null;
	}

	/** what goes to the server */
	export function planBody(p: PlanDraft, entry: number | null) {
		return {
			kind: p.kind,
			thesis: p.thesis,
			wrongIf: p.wrongIf,
			stop: p.noStop ? null : stopPrice(p, entry),
			target: targetPrice(p, entry),
			reviewDate: p.reviewDate,
			noStopReason: p.noStop ? p.noStopReason : null
		};
	}
</script>

<script lang="ts">
	import { tx } from '#lib/i18n.js';
	import HelpIcon from '../HelpIcon.svelte';
	import { money, priceText, unitFactor } from '../portfolio.js';
	import { tradeRisk } from '../discipline.js';

	/**
	 * T-015 — the conditions of a trade: its kind, the thesis, «что докажет, что я неправ», the stop and the target (a
	 * price or % from the entry), the review date, and under them the trade's risk: (entry − stop) × quantity, in the
	 * portfolio's currency and in % of its value. Saving without a stop needs «без стопа» and a reason (rule 1).
	 */
	interface Props {
		plan: PlanDraft;
		/** the kinds offered: a model's or a hypothesis's trade only when the trade came from one */
		kinds: PlanKind[];
		entry: number | null;
		qty: number | null;
		priceUnit: string;
		currency: string;
		portfolioCurrency: string;
		portfolioValue: number | null;
		/** ILS per USD */
		fxUsd: number | null;
		errors?: Record<string, string>;
		/** the thesis and the stop are required (a purchase) */
		strict?: boolean;
	}
	let { plan = $bindable(), kinds, entry, qty, priceUnit, currency, portfolioCurrency, portfolioValue, fxUsd, errors = {}, strict = true }: Props = $props();

	const unit = $derived(priceUnit === 'ILA' ? tx('аг.', 'ag.') : currency === 'USD' ? '$' : '₪');
	const stop = $derived(plan.noStop ? null : stopPrice(plan, entry));
	const target = $derived(targetPrice(plan, entry));
	const toPc = $derived(currency === portfolioCurrency ? 1 : !fxUsd ? null : currency === 'USD' ? fxUsd : 1 / fxUsd);
	const risk = $derived(tradeRisk({ entry, stop, qty, factor: unitFactor(priceUnit), toPc, portfolioValue }));

	function setKind(k: PlanKind) {
		const auto = plan.reviewDate === reviewDefault(plan.kind, new Date().toISOString().slice(0, 10));
		plan.kind = k;
		if (auto) plan.reviewDate = reviewDefault(k, new Date().toISOString().slice(0, 10));
	}
</script>

<div class="plan">
	{#if kinds.length > 1}
		<div class="seg" role="radiogroup" aria-label={tx('Вид сделки', 'Kind of trade')}>
			{#each kinds as k (k)}
				<button type="button" role="radio" aria-checked={plan.kind === k} class:on={plan.kind === k} onclick={() => setKind(k)}>{tx(...PLAN_KIND_LABEL[k])}</button>
			{/each}
		</div>
	{:else}
		<p class="kind">{tx('Вид сделки', 'Kind of trade')}: <b>{tx(...PLAN_KIND_LABEL[kinds[0] ?? plan.kind])}</b></p>
	{/if}

	<label>
		<span>{tx('Тезис', 'Thesis')}{strict ? '' : ` (${tx('необязательно', 'optional')})`} <HelpIcon topicKey="trade.thesis" label={tx('тезис', 'thesis')} /></span>
		<textarea rows="2" bind:value={plan.thesis} placeholder={tx('почему эта сделка и к какому сроку', 'why this trade, and by when')}></textarea>
		{#if errors.thesis}<em class="err">{errors.thesis}</em>{/if}
	</label>
	<label>
		<span>{tx('Что докажет, что я неправ', 'What will prove me wrong')}</span>
		<input bind:value={plan.wrongIf} placeholder={tx('необязательно', 'optional')} />
	</label>

	<div class="row">
		<label>
			<span
				>{tx('Стоп', 'Stop')} <HelpIcon topicKey="trade.stop" label={tx('стоп, цель и риск', 'stop, target and risk')} />
				<button type="button" class="unit" disabled={plan.noStop} onclick={() => ((plan.stopPct = !plan.stopPct), (plan.stop = ''))}>{plan.stopPct ? '%' : unit}</button></span
			>
			<input inputmode="decimal" bind:value={plan.stop} disabled={plan.noStop} placeholder={plan.stopPct ? tx('% ниже входа', '% below entry') : tx('цена', 'price')} />
			{#if plan.stopPct && stop !== null}<em class="hint">= {priceText(stop, priceUnit)}</em>{/if}
		</label>
		<label>
			<span>{tx('Цель', 'Target')} <button type="button" class="unit" onclick={() => ((plan.targetPct = !plan.targetPct), (plan.target = ''))}>{plan.targetPct ? '%' : unit}</button></span>
			<input inputmode="decimal" bind:value={plan.target} placeholder={plan.targetPct ? tx('% выше входа', '% above entry') : tx('цена', 'price')} />
			{#if plan.targetPct && target !== null}<em class="hint">= {priceText(target, priceUnit)}</em>{/if}
			{#if errors.target}<em class="err">{errors.target}</em>{/if}
		</label>
	</div>
	{#if errors.stop}<em class="err">{errors.stop}</em>{/if}

	<label class="check"><input type="checkbox" bind:checked={plan.noStop} /> {tx('Без стопа', 'No stop')}</label>
	{#if plan.noStop}
		<label>
			<span>{tx('Почему без стопа', 'Why no stop')}</span>
			<input bind:value={plan.noStopReason} placeholder={tx('позиция получит метку «без стопа»', 'the position gets a «no stop» mark')} />
		</label>
	{/if}

	<label class="date">
		<span>{plan.kind === 'model' ? tx('Пересмотр — конец периода модели', 'Review — end of the model\'s period') : tx('Дата пересмотра', 'Review date')}</span>
		<input type="date" bind:value={plan.reviewDate} />
		{#if errors.reviewDate}<em class="err">{errors.reviewDate}</em>{/if}
	</label>

	{#if risk}
		<p class="risk">
			{tx('Риск сделки', 'Trade risk')}: <b>{money(risk.money, portfolioCurrency)}</b>{#if risk.pct !== null}{' · '}<b>{risk.pct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</b> {tx('портфеля', 'of the portfolio')}{/if}
			<span class="muted">· {tx('стоп на', 'stop')} {risk.stopPct.toLocaleString(undefined, { maximumFractionDigits: 1 })}% {tx('ниже входа', 'below entry')}</span>
		</p>
	{:else if plan.noStop}
		<p class="risk warn">{tx('Без стопа убыток не ограничен', 'Without a stop the loss is not limited')}</p>
	{/if}
</div>

<style>
	.plan {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.kind {
		margin: 0;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s1);
	}
	.seg button {
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg button.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
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
		align-items: center;
		gap: 4px;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: var(--s2);
	}
	label.check input {
		width: 20px;
		height: 20px;
		min-height: 0;
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
		font: inherit;
	}
	textarea {
		padding: var(--s2) var(--s3);
		resize: vertical;
	}
	input:disabled {
		opacity: 0.5;
	}
	.unit {
		margin-left: auto;
		min-width: 36px;
		min-height: 28px;
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface-2);
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.hint {
		font-style: normal;
		font-size: var(--fs-xs);
	}
	.err {
		font-style: normal;
		color: var(--down);
		font-size: var(--fs-s);
	}
	.risk {
		margin: 0;
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--surface);
		font-size: var(--fs-s);
	}
	.risk.warn {
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.muted {
		color: var(--muted);
	}
</style>
