<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import TopBar from '#lib/TopBar.svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import ScoreDot from '#lib/ScoreDot.svelte';
	import ProtectionItem from '#lib/portfolio/ProtectionItem.svelte';
	import type { PItem } from '#lib/portfolio/protection.js';
	import { showToast } from '#lib/toast.svelte.js';
	import { loc, tx } from '#lib/i18n.js';
	import { money, priceText } from '#lib/portfolio.js';

	/**
	 * T-035 «Сигналы»: what to sell (the hard rules), what to review (the soft ones), what to place at the broker, and
	 * the week's ideas to buy with their plans. Each idea is a hypothesis of the source «Сигналы» — «Источники» measure it.
	 */
	type Trade = { key: string; kind: string; positionId: number; securityId: number; symbol: string; portfolio: string; price: number | null; stop: number | null; target: number | null; priceUnit: string; reviewDate: string | null; flag?: string; order?: boolean };
	type Soft = { kind: 'score_red' | 'below_sma' | 'overweight' | 'deep_loss'; key: string; positionId: number; securityId: number; symbol: string; portfolio: string; detail: string };
	type Idea = {
		id: number;
		securityId: number;
		rank: number;
		status: 'new' | 'bought' | 'wanted' | 'skipped';
		reason: string | null;
		hypothesisId: number | null;
		/** «Хочу купить» / «Купил» pressed, the form not saved */
		unsaved?: boolean;
		data: { symbol: string; name: string; market: 'US' | 'IL'; reasons: string[]; total: number; plan: { price: number; priceUnit: string; recommended: 'fixed' | 'trail'; stop: number; limit: number; trailPct: number; target: number; targetR: number; qty: number | null; amount: number | null; portfolio: string | null; maxLoss: number | null; maxLossPct: number | null; currency: string | null } };
	};
	type Want = { positionId: number; securityId: number; symbol: string; name: string; priceUnit: string; portfolio: string; price: number | null; want: number | null; toWant: number | null; stop: number | null; target: number | null; reviewDate: string | null; thesis: string | null; note: string | null; days: number | null; status: 'buy' | 'broken' | 'decide' | 'no_plan' | 'wait' };
	const WANT_STATUS: Record<Want['status'], [string, string]> = {
		buy: ['Цена дошла до желаемой. Перечитай тезис: если жив — покупай по плану (стоп и цель уже в нём) и выставь стоп у брокера.', 'The wanted price came. Re-read the thesis: if it holds, buy by the plan (the stop and the target are in it) and place the stop at the broker.'],
		broken: ['Цена ушла ниже стопа плана ещё до покупки — по твоему же плану идея неверна. «Передумал» — или новый план с новым уровнем.', 'The price went under the plan\'s stop before the purchase — by your own plan the idea is wrong. «Changed my mind» — or a new plan at a new level.'],
		decide: ['Ждёт давно или пришла дата пересмотра. Реши: купить сейчас, передумать или новый план с новой датой. Вечный «Хочу купить» — это не решение.', 'It waits long, or its review date came. Decide: buy now, drop it, or a new plan with a new date. A forever «Want to buy» is no decision.'],
		no_plan: ['Нет стопа в плане: открой бумагу → «Новый план», стоп и цель заполнятся из защитного плана.', 'No stop in the plan: open it → «New plan», the stop and the target fill in from the protective plan.'],
		wait: ['Жди желаемой цены. Сигнал придёт сам (и пуш, если включён «Хочу купить» в уведомлениях).', 'Wait for the wanted price. The signal comes by itself (and a push, if «Want to buy» is on in the notifications).']
	};
	type Settings = { weekday: number; hour: number; maxIdeas: number; markets: ('US' | 'IL')[]; minTurnoverUsd: number; minPriceUsd: number; reportDays: number; maxWeightPct: number; horizonMonths: number; minR: number };
	let v = $state<{ run: string | null; ideas: Idea[]; day: { sell: Trade[]; review: Trade[]; soft: Soft[]; protect: PItem[]; want: Want[] }; settings: Settings } | null>(null);
	let keepFor = $state<string | null>(null);
	let keepWhy = $state('');
	let skipFor = $state<number | null>(null);
	let skipWhy = $state('');
	let funnel = $state<Record<string, number> | null>(null);
	let busy = $state(false);

	async function load() {
		const r = await fetch('/api/ideas').catch(() => null);
		if (r?.ok) v = await r.json();
	}
	onMount(load);
	async function post(b: object) {
		const r = await fetch('/api/ideas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).catch(() => null);
		const j = await r?.json().catch(() => null);
		if (!r?.ok) {
			showToast(Object.values(j?.errors ?? {}).join(', ') || tx('Не получилось', 'It did not work'));
			return null;
		}
		return j;
	}
	const pt = (x: number | null | undefined, u: string) => priceText(x ?? null, u);
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
	const FLAG: Record<string, string> = { fading: 'выдыхается', stuck: 'застряла', spike: 'всплеск', bounce: 'отскок' };
	function tradeText(s: Trade) {
		if (s.kind === 'stop') return `${s.order ? tx('стоп у брокера должен был сработать', 'the stop at the broker should have worked') : tx('стоп пробит', 'stop broken')}: ${pt(s.price, s.priceUnit)} ≤ ${pt(s.stop, s.priceUnit)}`;
		if (s.kind === 'model_end') return tx('период модели закончился — продать по правилу 2', 'the model\'s period is over — sell by rule 2');
		if (s.kind === 'target') return `${tx('цель достигнута', 'target reached')}: ${pt(s.price, s.priceUnit)} ≥ ${pt(s.target, s.priceUnit)} — ${tx('зафиксируй или переведи в трейлинг', 'take it or switch to a trailing stop')}`;
		if (s.kind === 'path') return tx(`метка «${FLAG[s.flag ?? ''] ?? s.flag}» — характер движения изменился`, `the mark «${s.flag}» — the movement changed`);
		if (s.kind === 'no_stop') return tx('куплено без стопа', 'bought without a stop');
		return `${tx('пора пересмотреть', 'time to review')}${s.reviewDate ? ` (${d(s.reviewDate)})` : ''}`;
	}
	const SOFT: Record<Soft['kind'], [string, string]> = { score_red: ['квант-оценка красная', 'the quant score is red'], below_sma: ['цена ниже SMA200', 'the price is under its SMA200'], overweight: ['позиция слишком большая', 'the position is too big'], deep_loss: ['глубокая просадка', 'a deep loss'] };
	async function keep(key: string) {
		if (await post({ action: 'keep', key, reason: keepWhy })) {
			keepFor = null;
			keepWhy = '';
			showToast(tx('Записано в дневник; напомню через 30 дней', 'In the diary; a reminder in 30 days'));
			await load();
		}
	}
	async function mark(i: Idea, status: 'bought' | 'wanted' | 'skipped') {
		if (!(await post({ action: 'mark', id: i.id, status, reason: status === 'skipped' ? skipWhy : '' }))) return;
		if (status === 'skipped') {
			skipFor = null;
			skipWhy = '';
			showToast(tx('Пропущено — в дневнике; идея всё равно измеряется', 'Skipped — in the diary; the idea is still measured'));
			return load();
		}
		const note = encodeURIComponent(`Идея недели: ${i.data.reasons[0]}`);
		goto(`/portfolio?add=${i.securityId}&kind=${status === 'bought' ? 'buy' : 'plan_buy'}${i.hypothesisId ? `&hyp=${i.hypothesisId}` : ''}&note=${note}`);
	}
	async function runNow() {
		busy = true;
		const j = await post({ action: 'run' });
		busy = false;
		if (j) showToast(j.recorded ? tx(`Идей: ${j.recorded}`, `Ideas: ${j.recorded}`) : j.skipped === 'already this week' ? tx('На этой неделе идеи уже есть', 'This week\'s ideas are already there') : tx('Ни одна бумага не прошла фильтры', 'No share passed the filters'));
		await load();
	}
	async function saveSettings() {
		if (!v) return;
		const j = await post({ action: 'settings', ...v.settings });
		if (j) ((v.settings = j.settings), showToast(tx('Сохранено', 'Saved')));
	}
	async function preview() {
		const r = await fetch('/api/ideas?preview=1').then((x) => x.json()).catch(() => null);
		funnel = r?.funnel ?? null;
	}
	const DAYS = $derived(Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 1 + i).toLocaleDateString(loc(), { weekday: 'long' })));
	const FUNNEL: Record<string, [string, string]> = { liquid: ['ликвидных акций', 'liquid shares'], green: ['зелёная квант-оценка', 'green quant score'], noMarks: ['без «выдыхается / застряла»', 'no «fading / stuck»'], noReport: ['без отчёта в ближайшие дни', 'no report soon'], room: ['цель не ближе 1,5 риска', 'the target at least 1.5 risks'], limits: ['в пределах лимитов', 'within the limits'], notDuplicate: ['не дублируют портфель', 'not duplicating the portfolio'] };
</script>

<svelte:head><title>{tx('Сигналы', 'Signals')}</title></svelte:head>
<TopBar title={tx('Сигналы', 'Signals')} help="signals.screen" back={{ href: '/more', label: tx('Ещё', 'More') }} />

{#if !v}
	<p class="muted">{tx('Загружаю…', 'Loading…')}</p>
{:else}
	<p class="sim">{tx('Пока система проверяется — сигналы ведутся в симуляции (источник «Сигналы» в «Источниках»). Решение о сделке — твоё.', 'While the system is being tested, the signals are kept in simulation (the source «Signals» in «Sources»). The decision is yours.')}</p>

	<Fold key="sig-sell" remind="signals.screen" title={`${tx('Продать', 'Sell')} · ${v.day.sell.length}`} open={v.day.sell.length > 0}>
		{#if !v.day.sell.length}<p class="muted small">{tx('Жёстких сигналов нет: стопы не пробиты, периоды моделей не кончились.', 'No hard signals: no stop broken, no model period over.')}</p>{/if}
		{#each v.day.sell as s (s.key)}
			<a class="row hot" href="/position/{s.positionId}"><b>{s.symbol}</b> {tradeText(s)} <span class="muted">· {s.portfolio} · {tx('Продал? Внеси продажу', 'Sold? Enter the sale')} →</span></a>
		{/each}
	</Fold>

	<Fold key="sig-review" remind="signals.screen" title={`${tx('Пересмотреть', 'Review')} · ${v.day.review.length + v.day.soft.length}`} open={v.day.review.length + v.day.soft.length > 0}>
		{#if !v.day.review.length && !v.day.soft.length}<p class="muted small">{tx('Всё спокойно.', 'All calm.')}</p>{/if}
		{#each v.day.review as s (s.key)}
			<a class="row" href="/security/{s.securityId}?position={s.positionId}"><b>{s.symbol}</b> {tradeText(s)} <span class="muted">· {s.portfolio} →</span></a>
		{/each}
		{#each v.day.soft as s (s.key)}
			<div class="row">
				<a href="/security/{s.securityId}?position={s.positionId}"><b>{s.symbol}</b> {tx(...SOFT[s.kind])}: {s.detail} <span class="muted">· {s.portfolio} →</span></a>
				{#if keepFor === s.key}
					<input bind:value={keepWhy} placeholder={tx('Держу, потому что…', 'I keep it because…')} />
					<div class="btns"><button class="primary" onclick={() => keep(s.key)}>{tx('Записать', 'Save')}</button><button class="ghost" onclick={() => (keepFor = null)}>{tx('Отмена', 'Cancel')}</button></div>
				{:else}
					<div class="btns"><a class="ghost" href="/security/{s.securityId}?position={s.positionId}">{tx('Продал', 'Sold')}</a><button class="ghost" onclick={() => ((keepFor = s.key), (keepWhy = ''))}>{tx('Держу — потому что…', 'Keep — because…')}</button></div>
				{/if}
			</div>
		{/each}
	</Fold>

	<Fold key="sig-protect" remind="trade.orders" title={`${tx('Выставь у брокера', 'Place at the broker')} · ${v.day.protect.length}`} open={v.day.protect.length > 0}>
		{#snippet aside()}<HelpIcon topicKey="trade.orders" label={tx('виды заявок', 'order types')} />{/snippet}
		{#if !v.day.protect.length}<p class="muted small">{tx('Все позиции со стопом, а где нужна — и с целью.', 'Every position has a stop, and a target where one is advised.')}</p>{/if}
		{#each v.day.protect as it (it.position?.id)}
			<section class="item">
				<h3><a href="/security/{it.securityId}?position={it.position?.id}">{it.symbol}</a> <span class="muted">· {it.position?.portfolio}</span></h3>
				<ProtectionItem item={it} onsaved={load} />
			</section>
		{/each}
	</Fold>

	<Fold key="sig-want" remind="portfolio.want" title={`${tx('Хочу купить', 'Want to buy')} · ${v.day.want.length}`} open={v.day.want.some((w) => w.status !== 'wait')}>
		{#snippet aside()}<HelpIcon topicKey="portfolio.want" label={tx('как работать с «Хочу купить»', 'how to work with «Want to buy»')} />{/snippet}
		{#if !v.day.want.length}<p class="muted small">{tx('Запланированных покупок нет. «Хочу купить» — в карточке бумаги, у идеи недели или в портфеле.', 'No planned purchases. «Want to buy» is on a security card, an idea of the week or the portfolio.')}</p>{/if}
		{#each v.day.want as w (w.positionId)}
			<section class="item want" class:hot={w.status === 'buy' || w.status === 'broken'}>
				<h3><a href="/position/{w.positionId}">{w.symbol}</a><ScoreDot id={w.securityId} /> <span class="muted name">{w.name} · {w.portfolio}{w.days !== null ? ` · ${tx(`ждёт ${w.days} дн.`, `waits ${w.days} d`)}` : ''}</span></h3>
				<div class="plan">
					<span>{tx('Сейчас', 'Now')} <b>{pt(w.price, w.priceUnit)}</b></span>
					{#if w.want}<span>{tx('Желаемая', 'Wanted')} <b>{pt(w.want, w.priceUnit)}</b>{#if w.toWant !== null}&nbsp;({w.toWant > 0 ? tx(`ещё −${w.toWant.toFixed(1)}%`, `−${w.toWant.toFixed(1)}% to go`) : tx('дошла', 'reached')}){/if}</span>{/if}
					{#if w.stop}<span>{tx('Стоп', 'Stop')} <b>{pt(w.stop, w.priceUnit)}</b></span>{/if}
					{#if w.target}<span>{tx('Цель', 'Target')} <b>{pt(w.target, w.priceUnit)}</b></span>{/if}
					{#if w.reviewDate}<span>{tx('Решить до', 'Decide by')} {d(w.reviewDate)}</span>{/if}
				</div>
				{#if w.thesis || w.note}<p class="muted small">{w.thesis ?? w.note}</p>{/if}
				<p class="small">{tx(...WANT_STATUS[w.status])}</p>
				<div class="btns"><a class="ghost" href="/position/{w.positionId}">{tx('Купил / Передумал / Новый план', 'Bought / Changed my mind / New plan')} →</a></div>
			</section>
		{/each}
	</Fold>

	<Fold key="sig-buy" title={`${tx('Купить — идеи недели', 'Buy — the week\'s ideas')} · ${v.ideas.length}`} remind="signals.screen">
		{#snippet aside()}<HelpIcon topicKey="signals.screen" label={tx('как отбираются', 'how they are chosen')} />{/snippet}
		<p class="muted small">
			{v.run ? tx(`Отбор от ${d(v.run)}.`, `Chosen on ${d(v.run)}.`) : tx('Идей ещё не было.', 'No ideas yet.')}
			{tx(`Следующий — ${DAYS[v.settings.weekday]} в ${v.settings.hour}:00.`, `Next — ${DAYS[v.settings.weekday]} at ${v.settings.hour}:00.`)}
			{#if !v.run || Date.now() - Date.parse(v.run) > 6 * 86_400_000}<button class="link" disabled={busy} onclick={runNow}>{busy ? tx('отбираю…', 'choosing…') : tx('Отобрать сейчас', 'Choose now')}</button>{/if}
		</p>
		{#each v.ideas as i (i.id)}
			{@const p = i.data.plan}
			<section class="idea" class:done={i.status !== 'new'}>
				<h3><a href="/security/{i.securityId}">{i.data.symbol}</a><ScoreDot id={i.securityId} /> <span class="muted name">{i.data.name}</span></h3>
				<ul class="why">{#each i.data.reasons as r (r)}<li>{r}</li>{/each}</ul>
				<div class="plan">
					<span>{tx('Цена', 'Price')} <b>{pt(p.price, p.priceUnit)}</b></span>
					{#if p.recommended === 'trail'}<span>{tx('Трейлинг', 'Trailing')} <b>{p.trailPct}%</b></span>{:else}<span>{tx('Стоп', 'Stop')} <b>{pt(p.stop, p.priceUnit)}</b> / {pt(p.limit, p.priceUnit)} (−{((1 - p.stop / p.price) * 100).toFixed(1)}% = {tx('1 риск', '1 risk')})</span>{/if}
					<span>{tx('Цель', 'Target')} <b>{pt(p.target, p.priceUnit)}</b> (+{((p.target / p.price - 1) * 100).toFixed(1)}% · {String(p.targetR).replace('.', tx(',', '.'))} {tx('риска', 'risks')}: {tx('возможная прибыль в', 'the possible gain is')} {String(p.targetR).replace('.', tx(',', '.'))} {tx('раза больше убытка до стопа', 'times the loss to the stop')}) <HelpIcon topicKey="trade.stop" label={tx('что такое риск', 'what a risk is')} /></span>
					{#if p.qty}<span>{tx('Размер', 'Size')} <b>{p.qty}</b> {tx('шт.', 'sh.')}{#if p.amount} · {money(p.amount, p.priceUnit === 'USD' ? 'USD' : 'ILS')}{/if}</span>{/if}
					{#if p.maxLoss !== null && p.currency}<span>{tx('Убыток до стопа', 'Loss to the stop')} {money(p.maxLoss, p.currency)}{#if p.maxLossPct !== null} ({p.maxLossPct.toFixed(1)}%){/if}</span>{/if}
				</div>
				{#if i.status === 'new'}
					{#if i.unsaved}<p class="small warnline">{tx('«Хочу купить» или «Купил» было нажато, но форма не сохранилась — позиции нет. Нажми ещё раз и сохрани форму кнопкой внизу (если она не сохраняется, под ней написано почему).', '«Want to buy» or «Bought» was pressed but the form was not saved — there is no position. Press it again and save the form with the button at the bottom (if it does not save, the reason is written under it).')}</p>{/if}
					{#if skipFor === i.id}
						<input bind:value={skipWhy} placeholder={tx('Пропускаю, потому что…', 'I skip it because…')} />
						<div class="btns"><button class="ghost" onclick={() => mark(i, 'skipped')}>{tx('Пропустить', 'Skip')}</button><button class="ghost" onclick={() => (skipFor = null)}>{tx('Отмена', 'Cancel')}</button></div>
					{:else}
						<div class="btns">
							<button class="primary" onclick={() => mark(i, 'bought')}>{tx('Купил', 'Bought')}</button>
							<button class="ghost" onclick={() => mark(i, 'wanted')}>{tx('Хочу купить', 'Want to buy')}</button>
							<button class="ghost" onclick={() => ((skipFor = i.id), (skipWhy = ''))}>{tx('Пропустить', 'Skip')}</button>
						</div>
					{/if}
				{:else}
					<p class="muted small">{i.status === 'bought' ? tx('Куплено', 'Bought') : i.status === 'wanted' ? tx('В «Хочу купить»', 'In «Want to buy»') : tx(`Пропущено: ${i.reason ?? ''}`, `Skipped: ${i.reason ?? ''}`)}</p>
				{/if}
			</section>
		{/each}
	</Fold>

	<Fold key="sig-settings" remind="signals.screen" title={tx('Настройки сигналов', 'Signal settings')} open={false}>
		<div class="set">
			<label>{tx('День отбора идей', 'The ideas\' day')}<select bind:value={v.settings.weekday} onchange={saveSettings}>{#each DAYS as dn, k (k)}<option value={k}>{dn}</option>{/each}</select></label>
			<label>{tx('Час (Израиль)', 'Hour (Israel)')}<input inputmode="numeric" bind:value={v.settings.hour} onchange={saveSettings} /></label>
			<label>{tx('Идей в неделю, не больше', 'Ideas a week, at most')}<input inputmode="numeric" bind:value={v.settings.maxIdeas} onchange={saveSettings} /></label>
			<div class="mk">
				{tx('Биржи', 'Markets')}:
				{#each [['US', 'США'], ['IL', 'TASE']] as [k, ru] (k)}
					<label class="cb"><input type="checkbox" checked={v.settings.markets.includes(k as 'US' | 'IL')} onchange={(e) => ((v!.settings.markets = e.currentTarget.checked ? [...v!.settings.markets, k as 'US' | 'IL'] : v!.settings.markets.filter((x) => x !== k)), saveSettings())} />{tx(ru, k)}</label>
				{/each}
			</div>
			<label>{tx('Оборот в день, не меньше, $', 'Daily turnover, at least, $')}<input inputmode="numeric" bind:value={v.settings.minTurnoverUsd} onchange={saveSettings} /></label>
			<label>{tx('Цена не ниже, $', 'Price at least, $')}<input inputmode="decimal" bind:value={v.settings.minPriceUsd} onchange={saveSettings} /></label>
			<label>{tx('Без отчёта в ближайшие, дней', 'No report within, days')}<input inputmode="numeric" bind:value={v.settings.reportDays} onchange={saveSettings} /></label>
			<label>{tx('Позиция больше, % портфеля — пересмотреть', 'A position over, % of the portfolio — review')}<input inputmode="numeric" bind:value={v.settings.maxWeightPct} onchange={saveSettings} /></label>
			<label>{tx('Цель не ближе, рисков', 'The target at least, risks')}<input inputmode="decimal" bind:value={v.settings.minR} onchange={saveSettings} /></label>
			<label>{tx('Срок идеи, месяцев', 'An idea\'s term, months')}<input inputmode="numeric" bind:value={v.settings.horizonMonths} onchange={saveSettings} /></label>
		</div>
		<p class="muted small">{tx('Стоп, трейлинг, цель (сколько рисков) и OCO — в «Настройки → Защитный план».', 'The stop, trailing, target (how many risks) and OCO — in «Settings → Protective plan».')}</p>
		<button class="ghost wide" onclick={preview}>{tx('Как сработает воронка сейчас', 'How the funnel works now')}</button>
		{#if funnel}
			<ul class="funnel">{#each Object.entries(funnel) as [k, n] (k)}<li><span>{tx(...(FUNNEL[k] ?? [k, k]))}</span><b>{n}</b></li>{/each}</ul>
		{/if}
	</Fold>
{/if}

<style>
	.sim {
		margin: 0 0 var(--s3);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: var(--fs-xs);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
		color: var(--text);
		text-decoration: none;
		font-size: var(--fs-s);
	}
	.row a {
		color: var(--text);
		text-decoration: none;
	}
	a.row.hot b,
	a.row.hot {
		color: var(--down);
	}
	.btns {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.btns button,
	.btns a {
		min-height: 36px;
		padding: 0 12px;
		border-radius: var(--r2);
		font-size: var(--fs-s);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		text-decoration: none;
	}
	.primary {
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
	.wide {
		width: 100%;
		min-height: 38px;
		border-radius: var(--r2);
		margin-top: var(--s2);
	}
	input,
	select {
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
	}
	.item,
	.idea {
		padding: var(--s3) 0;
		border-top: 1px solid var(--line);
	}
	.want.hot {
		border-left: 3px solid var(--accent);
		padding-left: var(--s2);
	}
	.want p {
		margin: 0 0 6px;
	}
	.warnline {
		color: var(--down);
		margin: 0 0 6px;
	}
	.idea.done {
		opacity: 0.7;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: 0 0 6px;
		font-size: var(--fs-m);
	}
	h3 a {
		color: var(--text);
	}
	.name {
		font-size: var(--fs-xs);
		font-weight: 400;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.why {
		margin: 0 0 6px;
		padding-left: 1.2em;
		font-size: var(--fs-xs);
	}
	.plan {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin-bottom: 8px;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.link {
		border: none;
		background: none;
		color: var(--accent);
		font-size: var(--fs-xs);
		cursor: pointer;
		padding: 0;
	}
	.set {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.set label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--fs-s);
	}
	.mk {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: var(--fs-s);
	}
	.cb {
		display: inline-flex !important;
		flex-direction: row !important;
		align-items: center;
		gap: 4px;
	}
	.funnel {
		list-style: none;
		margin: var(--s2) 0 0;
		padding: 0;
	}
	.funnel li {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		border-top: 1px solid var(--line);
		font-size: var(--fs-s);
	}
</style>
