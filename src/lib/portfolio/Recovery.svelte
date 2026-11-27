<script lang="ts">
	import { tx } from '../i18n.js';
	import { priceText } from '../portfolio.js';
	import HelpIcon from '../HelpIcon.svelte';
	import ScoreDot from '../ScoreDot.svelte';
	import { scores } from '../score.svelte.js';

	/**
	 * Owner 27.11.2026: «Разбор просадки» — a held position deep under its purchase price (or far under its high since the
	 * purchase). Not «фиаско», but the state of the price now: how far above the 3-month low, the SMA50 and SMA200, the
	 * month's move; then the one question that matters — would I buy it today at this price — and the two ways out:
	 * hold with a stop from today's price, or sell (or cut to the size I would buy today).
	 */
	interface Props {
		securityId: number;
		avg: number;
		last: number;
		priceUnit: string;
		since: string | null;
		hasStop: boolean;
		onhold: (stop: number | null) => void;
		onsell: () => void;
	}
	let { securityId, avg, last, priceUnit, since, hasStop, onhold, onsell }: Props = $props();
	type R = { last: number; sma50: number | null; sma200: number | null; low: number; lowDate: string; fromLow: number; high: number; highDate: string; fromHigh: number; month: number | null; stage: 'falling' | 'basing' | 'recovering' | 'uptrend' };
	let r = $state<R | null>(null);
	let stop = $state<number | null>(null);
	let open = $state(true);
	$effect(() => {
		const id = securityId;
		fetch(`/api/securities/${id}/recovery${since ? `?since=${since}` : ''}`)
			.then((x) => (x.ok ? x.json() : null))
			.then((j) => (r = j))
			.catch(() => (r = null));
		fetch(`/api/protection?security=${id}`)
			.then((x) => (x.ok ? x.json() : null))
			.then((j) => (stop = j?.items?.[0]?.f?.stop ?? null))
			.catch(() => (stop = null));
	});
	const loss = $derived(last / avg - 1);
	const need = $derived(avg / last - 1);
	const p = (x: number, sign = true) => `${sign && x > 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
	const pt = (x: number | null) => priceText(x, priceUnit);
	const d = (s: string) => s.split('-').reverse().join('.');
	const sc = $derived(scores[securityId]);
	const STAGE: Record<R['stage'], [string, string]> = {
		falling: ['Всё ещё падает: цена у дна 3 месяцев и ниже SMA50 — разворота не видно. Не докупай.', 'Still falling: the price is at its 3-month low and under its SMA50 — no turn in sight. Do not add.'],
		basing: ['Падение остановилось: цена ушла от дна, но ещё ниже SMA50 — база строится, подъём не подтверждён.', 'The fall stopped: the price left the low but is still under its SMA50 — a base is forming, the rise is not confirmed.'],
		recovering: ['Подъём начался: цена выше SMA50. Долгий тренд (SMA200) ещё вниз — это отскок, пока не доказано обратное.', 'The rise began: the price is above its SMA50. The long trend (SMA200) is still down — a rebound until proven otherwise.'],
		uptrend: ['Тренд снова вверх: цена выше SMA50 и SMA200.', 'The trend is up again: the price is above its SMA50 and SMA200.']
	};
</script>

<div class="recov" class:falling={r?.stage === 'falling'}>
	<button type="button" class="t" aria-expanded={open} onclick={() => (open = !open)}>{open ? '▾' : '▸'} {tx('Разбор просадки', 'Drawdown review')}</button>
	<HelpIcon topicKey="portfolio.drawdown" label={tx('разбор просадки', 'drawdown review')} />
	{#if open}
		<p>
			{#if loss < 0}{tx(`Убыток ${p(loss)} от цены покупки ${pt(avg)}. Чтобы вернуться к ней, нужно ${p(need)}`, `A loss of ${p(loss)} from the purchase price ${pt(avg)}. Getting back to it takes ${p(need)}`)}{:else}{tx(`В плюсе ${p(loss)}, но`, `Up ${p(loss)}, but`)}{/if}{#if r}{loss < 0 ? '; ' : ' '}{tx(`от максимума со дня покупки (${pt(r.high)}, ${d(r.highDate)}) — ${p(r.fromHigh)}`, `from the high since the purchase (${pt(r.high)}, ${d(r.highDate)}) — ${p(r.fromHigh)}`)}{/if}.
		</p>
		{#if r}
			<ul class="facts">
				<li>{tx(`От дна 3 месяцев (${pt(r.low)}, ${d(r.lowDate)}) — ${p(r.fromLow)}`, `From the 3-month low (${pt(r.low)}, ${d(r.lowDate)}) — ${p(r.fromLow)}`)}{#if r.month !== null}{tx(`; за месяц ${p(r.month)}`, `; over a month ${p(r.month)}`)}{/if}</li>
				<li>SMA50 {pt(r.sma50)} — {r.sma50 !== null && r.last > r.sma50 ? tx('цена выше', 'price above') : tx('цена ниже', 'price under')}{#if r.sma200 !== null}; SMA200 {pt(r.sma200)} — {r.last > r.sma200 ? tx('цена выше', 'price above') : tx('цена ниже', 'price under')}{/if}</li>
				{#if sc?.market}<li>{tx('Квант-оценка', 'Quant score')} <ScoreDot id={securityId} /> {sc.total !== null ? Math.round(sc.total * 100) : '—'}</li>{/if}
			</ul>
			<p class="stage"><b>{tx(...STAGE[r.stage])}</b></p>
		{/if}
		<ol class="steps">
			<li>{tx(`Забудь цену покупки — рынку она неизвестна, и ждать «вернуться в ноль» — не план. Вопрос один: купил бы я эту бумагу сегодня по ${pt(last)}, с тем, что знаю сейчас?`, `Forget the purchase price — the market does not know it, and waiting to «get back to zero» is no plan. One question: would I buy this share today at ${pt(last)}, knowing what I know now?`)}</li>
			<li>{tx('Нет → продай или сократи до размера, который купил бы сегодня. Убыток уже случился; продажа лишь фиксирует его, а деньги уходят в идею лучше. Зафиксированный убыток уменьшает налог на прибыль того же года — уточни у брокера.', 'No → sell, or cut to the size you would buy today. The loss already happened; a sale only records it, and the money goes to a better idea. A realised loss lowers the tax on the same year\'s gains — check with the broker.')}</li>
			<li>{#if stop}{tx(`Да → держи, но со стопом от сегодняшней цены: ${pt(stop)} (дальше потеряешь не больше ${p(stop / last - 1)}). Запиши тезис — почему она поднимется.`, `Yes → hold, but with a stop from today's price: ${pt(stop)} (no more than ${p(stop / last - 1)} further). Write the thesis — why it will rise.`)}{:else}{tx('Да → держи, но со стопом от сегодняшней цены (под недавним дном, не ближе 2–3 ATR) и с записанным тезисом.', 'Yes → hold, but with a stop from today\'s price (under the recent low, no closer than 2–3 ATR) and a written thesis.')}{/if}</li>
			<li>{tx('Не докупай, «чтобы усреднить», пока цена ниже SMA50: докупать — только когда подъём подтверждён, по новому плану со стопом.', 'Do not buy more «to average down» while the price is under its SMA50: add only when the rise is confirmed, by a new plan with a stop.')}</li>
		</ol>
		<div class="btns">
			<button class="main" onclick={() => onhold(stop)}>{hasStop ? tx('Купил бы — пересмотреть стоп', 'Would buy — review the stop') : tx('Купил бы — держу со стопом', 'Would buy — hold with a stop')}</button>
			<button class="ghost" onclick={onsell}>{tx('Не купил бы — продал', 'Would not — sold')}</button>
		</div>
	{/if}
</div>

<style>
	.recov {
		margin: var(--s3) 0;
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-left: 3px solid #d9a400;
		border-radius: var(--r2);
		font-size: var(--fs-s);
	}
	.recov.falling {
		border-left-color: var(--down);
	}
	.t {
		background: none;
		border: none;
		padding: 4px 0;
		font: inherit;
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
	}
	p {
		margin: 6px 0;
	}
	.facts,
	.steps {
		margin: 6px 0;
		padding-left: 1.2em;
		line-height: 1.45;
	}
	.steps li {
		margin-bottom: 4px;
	}
	.btns {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: var(--s2);
	}
	.btns button {
		min-height: 36px;
		padding: 0 12px;
		border-radius: var(--r2);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.main {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.ghost {
		border: 1px solid var(--line);
		background: none;
		color: var(--text);
	}
</style>
