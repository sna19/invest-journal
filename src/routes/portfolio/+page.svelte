<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Wallet from '@lucide/svelte/icons/wallet';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import TopBar from '#lib/TopBar.svelte';
	import Empty from '#lib/Empty.svelte';
	import Sheet from '#lib/Sheet.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Pct from '#lib/Pct.svelte';
	import EventForm from '#lib/portfolio/EventForm.svelte';
	import PositionCard from '#lib/portfolio/PositionCard.svelte';
	import { israelDate } from '#lib/hypothesis.js';
	import { CASH_LABEL, money, priceText, qtyText, STAGE_LABEL, STAGES, type Stage } from '#lib/portfolio.js';
	import { showToast } from '#lib/toast.svelte.js';

	/**
	 * Spec section 18 — «Портфель»: the switcher of portfolios, the value in shekels and the return against the
	 * benchmarks, positions by stage (held, want to sell, want to buy, watching, closed). Real and virtual
	 * portfolios work the same; an automatic one follows its source's hypotheses.
	 */
	interface P {
		id: number;
		name: string;
		kind: 'real' | 'virtual';
		auto_source_id: number | null;
		auto_amount_ils: number;
		sourceName?: string | null;
	}
	interface Pos {
		id: number;
		securityId: number;
		symbol: string;
		name: string;
		currency: string;
		priceUnit: string;
		stage: Stage;
		qty: number;
		avgPrice: number | null;
		lastPrice: number | null;
		valueIls: number;
		unrealizedPct: number | null;
		unrealizedIls: number;
		realizedIls: number;
		weight?: number;
		plan: { kind: string; price: number | null; amount: number | null; note: string | null } | null;
		closedAt: string | null;
	}
	interface View {
		portfolio: P;
		summary: {
			value: number;
			cash: number;
			held: number;
			invested: number;
			twrPct: number | null;
			from: string | null;
			realizedIls: number;
			unrealizedIls: number;
			fxUsd: number;
			pricesAsOf: string | null;
			benchmarks: { key: string; label: string; returnPct: number | null; returnIlsPct?: number | null }[];
		};
		positions: Pos[];
		lastFee: Record<string, number>;
		cash: { id: number; kind: string; date: string; amount: number; currency: string; note: string | null; cancelledAt: string | null; reversedBy: number | null; auto: boolean; canCancel: boolean; canReverse: boolean }[];
	}

	const KEY = 'portfolio-current';
	let list = $state<P[] | null>(null);
	let current = $state<number | null>(null);
	let v = $state<View | null>(null);
	let problem = $state<string | null>(null);
	let creating = $state(false);
	let newName = $state('');
	let newKind = $state<'real' | 'virtual'>('real');
	let createError = $state<string | null>(null);
	let adding = $state<{ kind: string; securityId: number | null; hypothesisId: number | null } | null>(null);
	let opened = $state<number | null>(null);
	let cashing = $state(false);
	let cashKind = $state('deposit');
	let cashAmount = $state('');
	let cashCurrency = $state<'ILS' | 'USD'>('ILS');
	let cashDate = $state(israelDate());
	let cashNote = $state('');
	let cashError = $state<string | null>(null);

	async function loadList() {
		const r = await fetch('/api/portfolios').catch(() => null);
		if (!r?.ok) return (problem = 'Нет связи с сервером.');
		list = (await r.json()).items;
		if (!list!.some((p) => p.id === current)) current = list![0]?.id ?? null;
	}
	async function load() {
		if (current === null) return (v = null);
		const r = await fetch(`/api/portfolios/${current}`).catch(() => null);
		if (!r?.ok) return (problem = 'Нет связи с сервером.');
		v = await r.json();
		problem = null;
	}
	function choose(id: number) {
		current = id;
		try {
			localStorage.setItem(KEY, String(id));
		} catch {
			/* ignore */
		}
		load();
	}

	onMount(async () => {
		try {
			current = Number(localStorage.getItem(KEY)) || null;
		} catch {
			/* ignore */
		}
		const want = Number(page.url.searchParams.get('p'));
		if (want) current = want;
		await loadList();
		if (want) replaceState('/portfolio', {});
		// from a hypothesis card: «Хочу купить» / «Купил» with the link to it (a real portfolio first)
		const add = Number(page.url.searchParams.get('add'));
		if (add) {
			const real = list?.find((p) => p.kind === 'real' && p.id === current) ?? list?.find((p) => p.kind === 'real');
			if (real) current = real.id;
			const kind = page.url.searchParams.get('kind') === 'buy' ? 'buy' : 'plan_buy';
			adding = { kind, securityId: add, hypothesisId: Number(page.url.searchParams.get('hyp')) || null };
			replaceState('/portfolio', {});
			if (!real) creating = true;
		}
		await load();
	});

	async function create() {
		createError = null;
		const r = await fetch('/api/portfolios', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: newName, kind: newKind }) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (createError = j.message ?? 'Не создался');
		creating = false;
		newName = '';
		await loadList();
		choose(j.id);
	}

	async function addCash() {
		cashError = null;
		const r = await fetch(`/api/portfolios/${current}/cash`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind: cashKind, amount: cashAmount, currency: cashCurrency, date: cashDate, note: cashNote })
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (cashError = j.message ?? 'Не сохранилось');
		showToast(`${CASH_LABEL[cashKind]}: ${money(Number(cashAmount.replace(',', '.')), cashCurrency)} — записано`);
		cashing = false;
		cashAmount = '';
		cashNote = '';
		load();
	}
	async function undoCash(id: number, how: 'cancel' | 'reverse') {
		const r = await fetch(`/api/cash/${id}/${how}`, { method: 'POST' });
		if (!r.ok) return (problem = (await r.json().catch(() => ({}))).message ?? 'Не получилось');
		showToast(how === 'cancel' ? 'Запись отменена' : 'Сторно записано');
		load();
	}

	const by = (s: Stage) => v?.positions.filter((p) => p.stage === s) ?? [];
	// «17 нояб.» this year, «17 нояб. 2025» before it
	const d = (s: string) =>
		new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(s.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
</script>

<svelte:head><title>Портфель · Журнал гипотез</title></svelte:head>

<TopBar title="Портфель" help="portfolio.kinds" />

{#if list && list.length}
	<div class="switch" role="tablist" aria-label="Портфели">
		{#each list as p (p.id)}
			<button role="tab" aria-selected={p.id === current} class:on={p.id === current} onclick={() => choose(p.id)}
				>{p.name}{#if p.kind === 'virtual' && !p.auto_source_id}<small> · вирт.</small>{/if}</button
			>
		{/each}
		<button class="add" aria-label="Новый портфель" onclick={() => (creating = true)}><Plus size={18} /></button>
	</div>
{/if}

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if list === null}
	<div class="skeleton"></div>
{:else if !list.length}
	<Empty title="Ваши портфели">
		Здесь будут реальный портфель и виртуальные: позиции от «наблюдаю» до «продал», стоимость в шекелях и доходность против
		S&P 500 и ТА-125. Всё вводится вручную, сделка — за полминуты.
		{#snippet action()}<button onclick={() => ((newName = 'Мой портфель'), (newKind = 'real'), (creating = true))}>Создать портфель</button>{/snippet}
	</Empty>
{:else if v}
	{@const s = v.summary}
	{#if v.portfolio.auto_source_id}
		<p class="auto">
			Автоматический: каждая гипотеза «{v.portfolio.sourceName}» на рост покупается на {money(v.portfolio.auto_amount_ils)} и продаётся при закрытии.
			<HelpIcon topicKey="portfolio.source_auto" label="автоматический портфель" />
		</p>
	{/if}
	<section class="card summary">
		<div class="value">
			<span class="k">Стоимость</span>
			<b>{money(s.value)}</b>
			<span class="sub">в бумагах {money(s.held)} · деньги {money(s.cash)}</span>
		</div>
		<div class="ret">
			<span class="k">Доходность <HelpIcon topicKey="portfolio.twr" label="доходность TWR" /></span>
			<b><Pct value={s.twrPct} /></b>
			<span class="sub">{s.from ? `с ${d(s.from)}` : 'пока нет сделок'}</span>
		</div>
		{#if s.from}
			<ul class="bench">
				{#each s.benchmarks as b (b.key)}
					<li>
						<span>{b.label}</span>
						<Pct value={b.returnPct} plain />
						{#if b.returnIlsPct !== undefined && b.returnIlsPct !== null}<span class="sub">в ₪ <Pct value={b.returnIlsPct} plain /></span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<p class="sub line">
			Реализовано {money(s.realizedIls, 'ILS', true)} · не реализовано {money(s.unrealizedIls, 'ILS', true)} · $ = {s.fxUsd} ₪
			<HelpIcon topicKey="portfolio.fx" label="курс" />
			{#if s.pricesAsOf}<br />Цены на {d(s.pricesAsOf)}{/if}
		</p>
	</section>

	{#if !v.portfolio.auto_source_id}
		<div class="actions">
			<button class="main" onclick={() => (adding = { kind: 'buy', securityId: null, hypothesisId: null })}>Купил</button>
			<button onclick={() => (adding = { kind: 'plan_buy', securityId: null, hypothesisId: null })}>Хочу купить</button>
			<button onclick={() => (adding = { kind: 'watch', securityId: null, hypothesisId: null })}>Наблюдаю</button>
			<button onclick={() => (cashing = true)}><Wallet size={18} /> Деньги</button>
		</div>
	{/if}

	{#if !v.positions.length}
		<p class="muted center">Позиций пока нет. «Купил» — сделка; «Хочу купить» и «Наблюдаю» — бумага на заметку, с причиной.</p>
	{/if}

	{#each STAGES as st (st)}
		{@const rows = by(st)}
		{#if rows.length}
			<details class="stage" open={st !== 'closed'}>
				<summary>
					<h2>{STAGE_LABEL[st]} <span class="n">{rows.length}</span></h2>
					{#if st === 'holding'}<HelpIcon topicKey="portfolio.stages" label="этапы позиции" />{/if}
				</summary>
				<ul class="list">
					{#each rows as p (p.id)}
						<li>
							<button onclick={() => (opened = p.id)}>
								<span class="top">
									<b>{p.symbol}</b>
									<span class="grow"></span>
									{#if st === 'holding' || st === 'plan_sell'}
										<span>{money(p.valueIls)}</span>
										<b class="res"><Pct value={p.unrealizedPct} /></b>
									{:else if st === 'closed'}
										<span class="sub">{p.closedAt ? d(p.closedAt) : ''}</span>
										{#if p.realizedIls}<b class="res">{money(p.realizedIls, 'ILS', true)}</b>{/if}
									{:else if p.plan?.price}
										<span class="sub">по {priceText(p.plan.price, p.priceUnit)} · сейчас {priceText(p.lastPrice, p.priceUnit)}</span>
									{:else}
										<span class="sub">{priceText(p.lastPrice, p.priceUnit)}</span>
									{/if}
								</span>
								<span class="mid">
									{p.name}{#if st === 'holding' || st === 'plan_sell'} · {qtyText(p.qty)} шт. · {Math.round(p.weight ?? 0)}%{/if}
								</span>
								{#if p.plan?.note && st !== 'closed' && st !== 'holding'}<span class="note">{p.plan.note}</span>{/if}
								<ChevronRight size={18} />
							</button>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	{/each}

	{#if v.cash.length}
		<details class="stage">
			<summary><h2>Деньги <span class="n">{v.cash.filter((c) => !c.cancelledAt && c.kind !== 'reverse').length}</span></h2></summary>
			<ul class="list cash">
				{#each v.cash as c (c.id)}
					<li class:off={c.cancelledAt || c.reversedBy || c.kind === 'reverse'}>
						<span class="when">{d(c.date)}</span>
						<span class="what"><b>{CASH_LABEL[c.kind]}</b> {money(c.amount, c.currency)}{#if c.note} · {c.note}{/if}{#if c.auto} · авто{/if}</span>
						{#if !c.auto && c.canCancel}
							<button class="undo" aria-label="Отменить запись" onclick={() => undoCash(c.id, 'cancel')}><Undo2 size={16} /></button>
						{:else if !c.auto && c.canReverse}
							<button class="undo text" onclick={() => undoCash(c.id, 'reverse')}>Сторно</button>
						{/if}
					</li>
				{/each}
			</ul>
		</details>
	{/if}
	<p class="muted small">Взносы и выводы можно не записывать: покупка, на которую не хватило денег, считается взносом. Доходность от этого не искажается.</p>
{/if}

{#if creating}
	<Sheet title="Новый портфель" onclose={() => (creating = false)}>
		<div class="form">
			<label>Название <input bind:value={newName} placeholder="Мой портфель" /></label>
			<div class="seg" role="radiogroup" aria-label="Вид">
				<button role="radio" aria-checked={newKind === 'real'} class:on={newKind === 'real'} onclick={() => (newKind = 'real')}>Реальный</button>
				<button role="radio" aria-checked={newKind === 'virtual'} class:on={newKind === 'virtual'} onclick={() => (newKind = 'virtual')}>Виртуальный</button>
			</div>
			<p class="muted small">Устроены одинаково: реальный — ваши деньги, виртуальный — проверка идей без денег. Автоматический портфель источника включается в карточке источника.</p>
			{#if createError}<p class="err">{createError}</p>{/if}
			<button class="primary" disabled={!newName.trim()} onclick={create}>Создать</button>
		</div>
	</Sheet>
{/if}

{#if adding && current !== null && v}
	<Sheet title={adding.kind === 'buy' ? 'Купил' : adding.kind === 'plan_buy' ? 'Хочу купить' : 'Наблюдаю'} onclose={() => (adding = null)}>
		<EventForm
			portfolioId={current}
			kind={adding.kind}
			securityId={adding.securityId}
			hypothesisId={adding.hypothesisId}
			lastFee={v.lastFee}
			onsaved={(pid) => {
				adding = null;
				showToast('Записано');
				load();
				opened = pid;
			}}
			oncancel={() => (adding = null)}
		/>
		{#if adding.hypothesisId}<p class="muted small">Позиция будет связана с гипотезой №{adding.hypothesisId}.</p>{/if}
	</Sheet>
{/if}

{#if opened !== null}
	{@const p = v?.positions.find((x) => x.id === opened)}
	<Sheet title={p ? `${p.symbol} · ${v?.portfolio.name}` : 'Позиция'} onclose={() => (opened = null)}>
		<PositionCard positionId={opened} onchange={load} />
	</Sheet>
{/if}

{#if cashing}
	<Sheet title="Деньги портфеля" onclose={() => (cashing = false)}>
		<div class="form">
			<div class="seg five" role="radiogroup" aria-label="Вид">
				{#each ['deposit', 'withdraw', 'dividend', 'fee', 'tax'] as k (k)}
					<button role="radio" aria-checked={cashKind === k} class:on={cashKind === k} onclick={() => (cashKind = k)}>{CASH_LABEL[k]}</button>
				{/each}
			</div>
			<div class="row">
				<label>Сумма <input inputmode="decimal" bind:value={cashAmount} placeholder="0" /></label>
				<label
					>Валюта
					<select bind:value={cashCurrency}><option value="ILS">₪</option><option value="USD">$</option></select>
				</label>
			</div>
			<label>Дата <input type="date" max={israelDate()} bind:value={cashDate} /></label>
			<label>Заметка <input bind:value={cashNote} placeholder="необязательно" /></label>
			{#if cashError}<p class="err">{cashError}</p>{/if}
			<button class="primary" disabled={!cashAmount.trim()} onclick={addCash}>Записать</button>
			<p class="muted small">Взнос и вывод — деньги извне, они не меняют доходность. Дивиденд, комиссия и налог — её часть.</p>
		</div>
	</Sheet>
{/if}

<style>
	.switch {
		display: flex;
		gap: var(--s2);
		overflow-x: auto;
		scrollbar-width: none;
		margin-bottom: var(--s3);
	}
	.switch button {
		flex: none;
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-s);
		cursor: pointer;
		white-space: nowrap;
	}
	.switch button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.switch .add {
		display: inline-flex;
		align-items: center;
		min-width: 36px;
		justify-content: center;
		padding: 0;
	}
	.auto {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 0 var(--s3);
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.card {
		padding: var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
		margin-bottom: var(--s3);
	}
	.summary {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s3);
	}
	.value,
	.ret {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.value b,
	.ret b {
		font-size: var(--fs-xl);
	}
	.k {
		display: flex;
		align-items: center;
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.sub {
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.bench {
		grid-column: 1 / -1;
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bench li {
		display: flex;
		gap: var(--s2);
		align-items: baseline;
	}
	.bench li span:first-child {
		width: 72px;
		color: var(--muted);
		font-size: var(--fs-s);
	}
	.line {
		grid-column: 1 / -1;
		margin: 0;
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s2);
		margin-bottom: var(--s3);
	}
	.actions button {
		justify-content: center;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: var(--tap);
		padding: 0 var(--s4);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		font-weight: 600;
		cursor: pointer;
	}
	.actions button.main {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.stage {
		margin-bottom: var(--s3);
	}
	.stage summary {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: var(--tap);
		list-style: none;
		cursor: pointer;
	}
	.stage summary::-webkit-details-marker {
		display: none;
	}
	h2 {
		margin: 0;
		font-size: var(--fs-m);
	}
	.n {
		color: var(--muted);
		font-weight: 400;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.list button {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3) calc(var(--s4) + 20px) var(--s3) var(--s4);
		border: none;
		border-radius: var(--r2);
		background: var(--surface);
		text-align: left;
		cursor: pointer;
	}
	.list button > :global(svg) {
		position: absolute;
		right: var(--s3);
		top: 50%;
		transform: translateY(-50%);
		color: var(--muted);
	}
	.top {
		display: flex;
		align-items: baseline;
		gap: var(--s2);
	}
	.grow {
		flex: 1;
	}
	.mid,
	.note {
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.note {
		font-style: italic;
	}
	.cash li {
		display: flex;
		align-items: center;
		gap: var(--s3);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--surface);
	}
	.cash li.off .what {
		text-decoration: line-through;
		color: var(--muted);
	}
	.when {
		flex: none;
		width: 64px;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.what {
		flex: 1;
	}
	.undo {
		min-width: 36px;
		min-height: 36px;
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.undo.text {
		color: var(--link);
		font-size: var(--fs-s);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.form label {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.form input,
	.form select {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		box-sizing: border-box;
		width: 100%;
	}
	.row {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: var(--s3);
	}
	.seg {
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.seg button {
		flex: 1;
		min-height: 36px;
		border: none;
		border-radius: var(--r1);
		background: none;
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg button.on {
		background: var(--surface);
		font-weight: 600;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
	}
	.seg.five button {
		padding: 0 2px;
	}
	.primary {
		min-height: var(--tap);
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.5;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.center {
		text-align: center;
	}
	.err {
		color: var(--down);
		margin: 0;
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 160px;
		border-radius: var(--r3);
		background: var(--surface);
	}
</style>
