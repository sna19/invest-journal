<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import StickyNote from '@lucide/svelte/icons/sticky-note';
	import Flag from '@lucide/svelte/icons/flag';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TopBar from '#lib/TopBar.svelte';
	import Empty from '#lib/Empty.svelte';
	import Sheet from '#lib/Sheet.svelte';
	import HypothesisCard, { SIGNAL, shown, short, type Row } from '#lib/HypothesisCard.svelte';
	import Pct from '#lib/Pct.svelte';
	import Spark from '#lib/Spark.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { showToast } from '#lib/toast.svelte.js';
	import { nextPricesRun, noResultYet } from '#lib/hypothesis.js';

	/** Spec section 9 — the list of hypotheses with filters; gestures of section 13. */
	type Status = 'open' | 'closed' | 'all';
	type Mode = 'all' | 'sim' | 'real';
	type Market = 'all' | 'us' | 'il';
	const KEY = 'hypotheses-filter';

	let items = $state<Row[] | null>(null);
	let problem = $state<string | undefined>();
	let status = $state<Status>('open');
	let mode = $state<Mode>('all');
	let market = $state<Market>('all');
	let defaultOnly = $state(false);
	let openId = $state<number | null>(null);
	let noteFor = $state<Row | null>(null);
	let closeFor = $state<Row | null>(null);
	let noteText = $state('');
	let late = $state(false);
	let lastPricesAt = $state<string | null>(null);
	let reason = $state('');
	let closeError = $state<string | null>(null);

	async function load() {
		const p = new URLSearchParams({ status, mode, market });
		if (defaultOnly) p.set('defaultHorizon', '1');
		try {
			const r = await fetch(`/api/hypotheses?${p}`);
			if (!r.ok) throw new Error();
			const j = await r.json();
			items = j.items;
			late = j.late;
			lastPricesAt = j.lastPricesAt;
			problem = undefined;
		} catch {
			problem = 'Нет связи с сервером.';
		}
	}

	function setFilter(f: () => void) {
		f();
		try {
			localStorage.setItem(KEY, JSON.stringify({ status, mode, market, defaultOnly }));
		} catch {
			/* ignore */
		}
		load();
	}

	onMount(() => {
		try {
			const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
			if (v) ({ status, mode, market, defaultOnly } = { status, mode, market, defaultOnly, ...v });
		} catch {
			/* ignore */
		}
		const o = Number(page.url.searchParams.get('open'));
		if (o) {
			openId = o;
			replaceState('/', {});
		}
		load();
	});

	// a link from a source card may point to a hypothesis outside the current filter: fetch it on its own
	let single = $state<Row | null>(null);
	$effect(() => {
		const id = openId;
		if (id === null || !items || items.some((r) => r.h.id === id) || single?.h.id === id) return;
		fetch(`/api/hypotheses/${id}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => (single = j));
	});
	const opened = $derived(items?.find((r) => r.h.id === openId) ?? (single?.h.id === openId ? single : null));
	const filtered = $derived(status !== 'open' || mode !== 'all' || market !== 'all' || defaultOnly);

	function changed(h: Row['h']) {
		if (!items) return;
		if (h.status === 'cancelled') items = items.filter((r) => r.h.id !== h.id);
		else if (items.some((r) => r.h.id === h.id)) items = items.map((r) => (r.h.id === h.id ? { ...r, h: { ...r.h, ...h } } : r));
		else load();
	}

	async function closeEarlyNow() {
		if (!closeFor) return;
		closeError = null;
		const r = await fetch(`/api/hypotheses/${closeFor.h.id}/close`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ reason })
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (closeError = j.message ?? 'Не закрылась');
		showToast(`${closeFor.h.symbol} закрыта досрочно: превышение ${j.excessPct > 0 ? '+' : ''}${j.excessPct.toFixed(1)}%`);
		closeFor = null;
		reason = '';
		load();
	}

	async function saveNote() {
		if (!noteFor) return;
		const r = await fetch(`/api/hypotheses/${noteFor.h.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ note: noteText })
		});
		if (r.ok) changed(await r.json());
		noteFor = null;
	}

	// ── gestures (section 13): a row swiped right — a note; left — early close; the list pulled down — refresh
	let swipe = $state<{ id: number; dx: number } | null>(null);
	let start: { x: number; y: number; id: number; horizontal: boolean | null } | null = null;
	const THRESHOLD = 80;

	function down(e: PointerEvent, id: number) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		start = { x: e.clientX, y: e.clientY, id, horizontal: null };
	}
	function move(e: PointerEvent) {
		if (!start) return;
		const dx = e.clientX - start.x;
		const dy = e.clientY - start.y;
		if (start.horizontal === null && Math.hypot(dx, dy) > 10) start.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
		if (start.horizontal) swipe = { id: start.id, dx: Math.max(-140, Math.min(140, dx)) };
	}
	function up() {
		const s = swipe;
		const id = start?.id;
		start = null;
		swipe = null;
		if (!s || id === undefined) return;
		const row = items?.find((r) => r.h.id === id);
		if (!row) return;
		if (s.dx > THRESHOLD) {
			noteFor = row;
			noteText = row.h.note ?? '';
		} else if (s.dx < -THRESHOLD && row.h.status === 'open') {
			closeFor = row;
			reason = '';
			closeError = null;
		}
	}
	function tap(id: number) {
		// a tap, not the end of a swipe
		if (!swipe) openId = id;
	}

	let pull = $state(0);
	let pullStart: number | null = null;
	let refreshing = $state(false);
	function touchStart(e: TouchEvent) {
		pullStart = window.scrollY <= 0 ? e.touches[0].clientY : null;
	}
	function touchMove(e: TouchEvent) {
		if (pullStart === null) return;
		pull = Math.max(0, Math.min(90, (e.touches[0].clientY - pullStart) / 2));
	}
	async function touchEnd() {
		if (pull > 60) {
			refreshing = true;
			await load();
			refreshing = false;
		}
		pull = 0;
		pullStart = null;
	}

	// T-007: the results are on a date, the next prices come on schedule
	const pricesAsOf = $derived(
		(items ?? [])
			.filter((r) => r.h.status === 'open' && r.h.lastDate)
			.map((r) => r.h.lastDate!)
			.sort()
			.at(-1) ?? null
	);
	const days = (d: string) => Math.round((Date.parse(d + 'T12:00:00') - Date.now()) / 86400000);
</script>

<svelte:head><title>Гипотезы · Журнал гипотез</title></svelte:head>
<svelte:window onpointermove={move} onpointerup={up} onpointercancel={up} />

<div class="pull" style:height="{refreshing ? 40 : pull}px" aria-hidden={!refreshing}>
	<span class:spin={refreshing} style:transform="rotate({pull * 4}deg)"><RefreshCw size={20} /></span>
</div>

<div ontouchstart={touchStart} ontouchmove={touchMove} ontouchend={touchEnd} role="presentation">
	<TopBar title="Гипотезы" help="hypothesis.list" />

	<div class="filters">
		<div class="seg" role="radiogroup" aria-label="Статус">
			{#each [['open', 'Открытые'], ['closed', 'Закрытые'], ['all', 'Все']] as [v, t] (v)}
				<button role="radio" aria-checked={status === v} class:on={status === v} onclick={() => setFilter(() => (status = v as Status))}>{t}</button>
			{/each}
		</div>
		<div class="chips">
			{#each [['all', 'Любой режим'], ['sim', 'Симуляция'], ['real', 'Реальные']] as [v, t] (v)}
				<button aria-pressed={mode === v} class:on={mode === v} onclick={() => setFilter(() => (mode = v as Mode))}>{t}</button>
			{/each}
		</div>
		<div class="chips">
			{#each [['all', 'Все рынки'], ['us', 'США'], ['il', 'Израиль']] as [v, t] (v)}
				<button aria-pressed={market === v} class:on={market === v} onclick={() => setFilter(() => (market = v as Market))}>{t}</button>
			{/each}
			<button aria-pressed={defaultOnly} class:on={defaultOnly} onclick={() => setFilter(() => (defaultOnly = !defaultOnly))}>Срок по умолчанию</button>
		</div>
	</div>

	{#if problem}<p class="warn" role="alert">{problem}</p>{/if}
	{#if late}
		<a class="warn late" href="/settings">
			Цены не обновлялись больше двух дней{lastPricesAt ? ` (последний раз ${new Date(lastPricesAt).toLocaleDateString('ru-RU')})` : ''} — результаты устарели. Подробности в «Настройках».
		</a>
	{/if}

	{#if items === null}
		{#each [1, 2, 3] as i (i)}<div class="skeleton"></div>{/each}
	{:else if items.length === 0 && !filtered}
		<Empty title="Записывайте, что утверждает источник">
			Прочитали статью с проверяемым утверждением — «покупать», целевая цена, ясная позиция или новость — запишите
			его как гипотезу в тот же день. Приложение зафиксирует цену входа, сравнит бумагу с бенчмарком и закроет гипотезу
			в срок; по закрытым станет видно, стоит ли действовать после чтения этого источника. Уверенность ставить не
			обязательно.
			{#snippet action()}<a href="/new">Новая гипотеза</a>{/snippet}
		</Empty>
	{:else if items.length === 0}
		<p class="muted center">Под эти фильтры гипотез нет.</p>
	{:else}
		{#if pricesAsOf}
			<p class="muted small hint-row prices">
				<span>Цены на {short(pricesAsOf)} · следующее обновление — {nextPricesRun()}</span>
				<HelpIcon topicKey="result.prices" label="когда обновляются цены" />
			</p>
		{/if}
		<p class="muted small hint-row">
			<span>Справа — превышение над бенчмарком. Смахните строку вправо — заметка, влево — досрочное закрытие.</span>
			<HelpIcon topicKey="result.excess" label="превышение" />
		</p>
		<ul class="list">
			{#each items as r (r.h.id)}
				{@const h = r.h}
				{@const dx = swipe?.id === h.id ? swipe.dx : 0}
				<li class="swipe">
					<div class="behind left" class:armed={dx > THRESHOLD}><StickyNote size={20} /> Заметка</div>
					<div class="behind right" class:armed={dx < -THRESHOLD}>Закрыть <Flag size={20} /></div>
					<button
						class="row"
						style:transform={dx ? `translateX(${dx}px)` : undefined}
						onpointerdown={(e) => down(e, h.id)}
						onclick={() => tap(h.id)}
						aria-label="{h.symbol}: открыть карточку"
					>
						<span class="top">
							<b class="sym">{h.symbol}</b>
							<span class="dir {h.direction}">{h.direction === 'long' ? '▲ рост' : '▼ падение'}</span>
							<span class="grow"></span>
							{#if h.entryPrice === null}
								<span class="wait">ожидает цену</span>
							{:else if noResultYet(h)}
								<span class="wait">результат {nextPricesRun().startsWith('сегодня') ? 'сегодня' : 'завтра'}</span>
							{:else}
								<Spark points={r.spark ?? null} />
								<b class="res"><Pct value={shown(h).x} /></b>
							{/if}
						</span>
						<span class="mid">{h.securityName}</span>
						<span class="bottom">
							<span class="src">{r.sourceName} · {SIGNAL[h.signalType]}{#if h.mode === 'real'}{' · '}<b>реальные</b>{/if}</span>
							<span class="when">
								{#if h.status === 'open'}
									{days(h.horizonDate) > 0 ? `${days(h.horizonDate)} дн.` : 'сегодня'}{#if h.horizonSource === 'default'}&nbsp;·&nbsp;по умолч.{/if}
								{:else}
									{h.outcome === 'hit' ? 'сработала' : 'не сработала'}{h.status === 'closed_early' ? ', досрочно' : ''} · {short(h.exitDate ?? h.horizonDate)}
								{/if}
							</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

{#if opened}
	<Sheet title="{opened.h.symbol} {opened.h.direction === 'long' ? '▲ Рост' : '▼ Падение'}" onclose={() => (openId = null)}>
		<HypothesisCard row={opened} onchange={changed} onclose={() => (openId = null)} />
	</Sheet>
{/if}

{#if noteFor}
	<Sheet title="Заметка · {noteFor.h.symbol}" onclose={() => (noteFor = null)}>
		<!-- svelte-ignore a11y_autofocus -->
		<textarea class="note" rows="4" aria-label="Заметка" placeholder="Что заметили по ходу" bind:value={noteText} autofocus></textarea>
		<button class="primary" onclick={saveNote}>Сохранить заметку</button>
	</Sheet>
{/if}

{#if closeFor}
	<Sheet title="Досрочно закрыть · {closeFor.h.symbol}" onclose={() => (closeFor = null)}>
		{#if closeFor.h.entryPrice === null}
			<p>Цены входа ещё нет — закрыть можно после первой цены.</p>
		{:else}
			<p class="muted">Результат зафиксируется на последнюю цену; в статистике досрочные закрытия идут отдельной строкой.</p>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="note" aria-label="Причина" placeholder="Причина, например: тезис больше не актуален" bind:value={reason} autofocus />
			{#if closeError}<p class="err">{closeError}</p>{/if}
			<button class="primary" disabled={!reason.trim()} onclick={closeEarlyNow}>Закрыть досрочно</button>
		{/if}
	</Sheet>
{/if}

<style>
	.pull {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		overflow: hidden;
		color: var(--muted);
	}
	.spin {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		margin-bottom: var(--s3);
	}
	.seg {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2px;
		padding: 2px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.seg button {
		min-height: 40px;
		border: none;
		border-radius: 10px;
		background: none;
		cursor: pointer;
	}
	.seg button.on {
		background: var(--surface);
		font-weight: 600;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
	}
	.chips button {
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.chips button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.swipe {
		position: relative;
		border-radius: var(--r2);
		overflow: hidden;
		background: var(--surface-2);
	}
	.behind {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		gap: var(--s2);
		padding: 0 var(--s4);
		color: var(--muted);
		font-weight: 600;
	}
	.behind.right {
		justify-content: flex-end;
	}
	.behind.armed {
		color: var(--accent);
	}
	.row {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3) var(--s4);
		border: none;
		border-radius: var(--r2);
		background: var(--surface);
		text-align: left;
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
		cursor: pointer;
		transition: transform 0.12s;
	}
	.top,
	.bottom {
		display: flex;
		align-items: baseline;
		gap: var(--s2);
	}
	.grow {
		flex: 1;
	}
	.sym {
		font-size: var(--fs-l);
	}
	.dir {
		white-space: nowrap;
		font-size: var(--fs-s);
	}
	/* the source gives way; the term or the outcome always shows in full */
	.src {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.when {
		flex: none;
		white-space: nowrap;
	}
	.dir.long {
		color: var(--up);
	}
	.dir.short {
		color: var(--down);
	}
	.mid {
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bottom {
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.res {
		font-size: var(--fs-m);
	}
	.late {
		display: block;
		text-decoration: none;
		margin-bottom: var(--s3);
	}
	.hint-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
	}
	.err {
		color: var(--down);
		font-size: var(--fs-s);
	}
	.wait {
		font-size: var(--fs-s);
		font-weight: 600;
		color: var(--warn-text);
		background: var(--warn-bg);
		padding: 2px var(--s2);
		border-radius: var(--r-pill);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
		margin: 0 0 var(--s2);
	}
	.center {
		text-align: center;
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 84px;
		margin-bottom: var(--s2);
		border-radius: var(--r2);
		background: var(--surface);
	}
	.note {
		box-sizing: border-box;
		width: 100%;
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		margin-bottom: var(--s3);
	}
	.primary {
		width: 100%;
		min-height: 48px;
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
</style>
