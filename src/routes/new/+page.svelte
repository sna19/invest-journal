<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ArrowDownRight from '@lucide/svelte/icons/arrow-down-right';
	import X from '@lucide/svelte/icons/x';
	import TopBar from '#lib/TopBar.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import TickerSearch, { type Security } from '#lib/TickerSearch.svelte';
	import { showToast } from '#lib/toast.svelte.js';
	import { HORIZONS, SIGNAL_TYPES, israelDate, normalizeUrl, validate, type Errors, type HypothesisInput } from '#lib/hypothesis.js';

	/**
	 * Spec sections 2, 13 and 17 — a new hypothesis in under a minute from the phone: the link picks the source,
	 * the author is suggested, the term is 3 months unless the article names one, the mode is simulation.
	 * /new?url=… comes from the iPhone shortcut «В журнал гипотез» with the link filled in.
	 */
	interface Source {
		id: number;
		name: string;
		domain: string | null;
		kind: string;
	}

	let sources = $state<Source[]>([]);
	let authors = $state<string[]>([]);

	let url = $state('');
	let sourceId = $state<number | null>(null);
	let sourceAuto = $state(false);
	let articleId = $state<number | null>(null);
	let articleTitle = $state('');
	let author = $state('');
	let security = $state<Security | null>(null);
	let signalType = $state<string | null>(null);
	let direction = $state<'long' | 'short' | null>(null);
	let directionSource = $state<'article' | 'mine'>('article');
	let horizon = $state<string>('none');
	let horizonDate = $state('');
	let thesis = $state('');
	let invalidation = $state('');
	let confidencePct = $state('');
	let mode = $state<'sim' | 'real'>('sim');
	let targetPrice = $state('');
	let amount = $state('');
	let tags = $state('');
	let more = $state(false);

	let newSource = $state<string | null>(null);
	let metaLoading = $state(false);
	let saving = $state(false);
	let submitted = $state(false);
	let serverErrors = $state<Errors>({});
	let formError = $state<string | undefined>();

	const today = israelDate();
	const input = $derived<HypothesisInput>({
		url,
		sourceId,
		articleId,
		articleTitle,
		author,
		securityId: security?.id ?? null,
		signalType,
		direction,
		directionSource: signalType === 'news' ? 'mine' : directionSource,
		thesis,
		confidencePct,
		invalidation,
		mode,
		horizon,
		horizonDate,
		targetPrice,
		amount: mode === 'real' ? amount : '',
		tags
	});
	// section 13: errors show at the field while typing, not only after «Сохранить»
	const errors = $derived<Errors>({ ...validate(input, today, !submitted), ...serverErrors });
	const unit = $derived(security ? (security.priceUnit === 'ILA' ? 'агорот' : security.currency) : '');

	onMount(async () => {
		const r = await fetch('/api/sources').then((r) => r.json()).catch(() => ({ items: [] }));
		sources = r.items;
		const fromShare = page.url.searchParams.get('url') ?? page.url.searchParams.get('text');
		if (fromShare) {
			url = extractUrl(fromShare) ?? fromShare;
			await lookup();
		}
		loadAuthors();
	});

	/** Shortcuts sometimes pass «Title https://…» — take the link out of the text. */
	function extractUrl(s: string) {
		return /https?:\/\/\S+/i.exec(s)?.[0] ?? null;
	}

	let lookupSeq = 0;
	async function lookup() {
		const link = normalizeUrl(extractUrl(url) ?? url);
		if (!link) return;
		const my = ++lookupSeq;
		metaLoading = true;
		try {
			const m = await fetch(`/api/article-meta?url=${encodeURIComponent(link)}`).then((r) => r.json());
			if (my !== lookupSeq) return;
			if (m.source) {
				sourceId = m.source.id;
				sourceAuto = true;
				loadAuthors();
			}
			if (m.article) {
				articleId = m.article.id;
				if (m.article.author && !author) author = m.article.author;
			}
			if (m.title && !articleTitle) articleTitle = m.title;
		} catch {
			/* offline: fill by hand */
		} finally {
			if (my === lookupSeq) metaLoading = false;
		}
	}

	async function loadAuthors() {
		const r = await fetch(`/api/authors${sourceId ? `?sourceId=${sourceId}` : ''}`).then((r) => r.json()).catch(() => ({ items: [] }));
		authors = r.items;
	}

	function pickSource(id: number) {
		sourceId = id;
		sourceAuto = false;
		articleId = null;
		delete serverErrors.sourceId;
		loadAuthors();
	}

	async function addSource() {
		const name = newSource?.trim();
		if (!name) return;
		const r = await fetch('/api/sources', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, domain: normalizeUrl(url) ? new URL(normalizeUrl(url)!).hostname : null })
		});
		if (!r.ok) return (formError = (await r.json().catch(() => ({}))).message ?? 'Источник не добавился');
		const s = await r.json();
		if (!sources.some((x) => x.id === s.id)) sources = [...sources, s];
		newSource = null;
		pickSource(s.id);
	}

	function setSignal(t: string) {
		signalType = t;
		if (t === 'news') directionSource = 'mine';
		else if (directionSource === 'mine' && signalType !== 'news') directionSource = 'article';
	}

	async function save(again: boolean) {
		submitted = true;
		serverErrors = {};
		formError = undefined;
		if (Object.keys(validate(input, today)).length) {
			formError = 'Проверьте отмеченные поля';
			document.querySelector('.err')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			return;
		}
		saving = true;
		try {
			const r = await fetch('/api/hypotheses', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(input)
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) {
				serverErrors = j.errors ?? {};
				formError = j.message ?? 'Не сохранилось';
				return;
			}
			showToast(`Записано: ${j.symbol} ${j.direction === 'long' ? '▲' : '▼'} до ${new Date(j.horizonDate).toLocaleDateString('ru-RU')}`);
			if (again) {
				// same article: keep the link, source, author and title; the next ticker
				articleId = j.articleId;
				security = null;
				signalType = null;
				direction = null;
				directionSource = 'article';
				horizon = 'none';
				horizonDate = '';
				thesis = '';
				invalidation = '';
				confidencePct = '';
				targetPrice = '';
				amount = '';
				submitted = false;
				window.scrollTo({ top: 0, behavior: 'smooth' });
			} else {
				goto(`/?open=${j.id}`);
			}
		} catch {
			formError = 'Нет связи с сервером — попробуйте ещё раз';
		} finally {
			saving = false;
		}
	}

	const sourceName = $derived(sources.find((s) => s.id === sourceId)?.name);
</script>

<svelte:head><title>Новая гипотеза · Журнал гипотез</title></svelte:head>

<TopBar title="Новая гипотеза" back={{ href: '/', label: 'Гипотезы' }} />

<form
	novalidate
	onsubmit={(e) => {
		e.preventDefault();
		save(false);
	}}
>
	<!-- 1. the article -->
	<section class="group">
		<label class="lbl" for="url">Ссылка на статью</label>
		<input
			id="url"
			type="url"
			inputmode="url"
			autocomplete="off"
			autocapitalize="off"
			placeholder="https://…  (пусто — своя идея)"
			bind:value={url}
			onchange={lookup}
			onpaste={() => setTimeout(lookup, 0)}
		/>
		{#if errors.url}<p class="err">{errors.url}</p>{/if}
		{#if metaLoading}<p class="hint">Ищу источник и заголовок…</p>{/if}
		{#if url && (articleTitle || !metaLoading)}
			<input class="title-in" aria-label="Заголовок статьи" placeholder="Заголовок (необязательно)" bind:value={articleTitle} />
		{/if}

		<div class="lbl-row"><span class="lbl">Источник</span>{#if sourceAuto && sourceName}<span class="hint">по ссылке</span>{/if}</div>
		<div class="chips" role="radiogroup" aria-label="Источник">
			{#each sources as s (s.id)}
				<button type="button" role="radio" aria-checked={sourceId === s.id} class:on={sourceId === s.id} onclick={() => pickSource(s.id)}>{s.name}</button>
			{/each}
			{#if newSource === null}
				<button type="button" class="add" onclick={() => (newSource = '')}>+ другой</button>
			{/if}
		</div>
		{#if newSource !== null}
			<div class="inline">
				<!-- svelte-ignore a11y_autofocus -->
				<input aria-label="Новый источник" placeholder="Название источника" bind:value={newSource} autofocus />
				<button type="button" class="small" onclick={addSource}>Добавить</button>
			</div>
		{/if}
		{#if errors.sourceId}<p class="err">{errors.sourceId}</p>{/if}

		<label class="lbl" for="author">Автор <span class="hint">аналитик или инвестдом, а не журналист</span></label>
		<input id="author" list="authors" autocomplete="off" placeholder="Например, Morgan Stanley" bind:value={author} />
		<datalist id="authors">{#each authors as a (a)}<option value={a}></option>{/each}</datalist>
	</section>

	<!-- 2. the security -->
	<section class="group">
		{#if security}
			<div class="lbl-row"><span class="lbl">Бумага</span></div>
			<div class="chosen">
				<div>
					<b>{security.symbol}</b> — {security.nameEn}
					<div class="hint">{security.exchangeName} · {unit} · бенчмарк {security.exchangeCode === 'TASE' ? 'ТА-125' : 'S&P 500'}</div>
				</div>
				<button type="button" class="icon" aria-label="Выбрать другую бумагу" onclick={() => (security = null)}><X size={20} /></button>
			</div>
		{:else}
			<TickerSearch label="Бумага" noIndex onselect={(s) => (security = s)} />
		{/if}
		{#if errors.securityId}<p class="err">{errors.securityId}</p>{/if}
	</section>

	<!-- 3. what the source says -->
	<section class="group">
		<div class="lbl-row">
			<span class="lbl">Тип сигнала</span>
			<HelpIcon topicKey="hypothesis.signal_type" label="тип сигнала" />
		</div>
		<div class="seg four" role="radiogroup" aria-label="Тип сигнала">
			{#each SIGNAL_TYPES as t (t.id)}
				<button type="button" role="radio" aria-checked={signalType === t.id} class:on={signalType === t.id} onclick={() => setSignal(t.id)}>{t.label}</button>
			{/each}
		</div>
		{#if signalType}<p class="hint">{SIGNAL_TYPES.find((t) => t.id === signalType)?.hint}</p>{/if}
		{#if errors.signalType}<p class="err">{errors.signalType}</p>{/if}

		<span class="lbl">Направление</span>
		<div class="seg" role="radiogroup" aria-label="Направление">
			<button type="button" role="radio" aria-checked={direction === 'long'} class:on={direction === 'long'} onclick={() => (direction = 'long')}
				><ArrowUpRight size={18} /> Рост</button
			>
			<button type="button" role="radio" aria-checked={direction === 'short'} class:on={direction === 'short'} onclick={() => (direction = 'short')}
				><ArrowDownRight size={18} /> Падение</button
			>
		</div>
		{#if errors.direction}<p class="err">{errors.direction}</p>{/if}
		{#if signalType === 'news'}
			<p class="hint">Для новости направление — ваше толкование.</p>
		{:else}
			<div class="seg small-seg" role="radiogroup" aria-label="Откуда направление">
				<button type="button" role="radio" aria-checked={directionSource === 'article'} class:on={directionSource === 'article'} onclick={() => (directionSource = 'article')}>Из статьи</button>
				<button type="button" role="radio" aria-checked={directionSource === 'mine'} class:on={directionSource === 'mine'} onclick={() => (directionSource = 'mine')}>Моё толкование</button>
			</div>
		{/if}

		<div class="lbl-row">
			<span class="lbl">Срок из статьи</span>
			<HelpIcon topicKey="hypothesis.horizon" label="срок" />
		</div>
		<div class="chips" role="radiogroup" aria-label="Срок">
			{#each HORIZONS as h (h.id)}
				<button type="button" role="radio" aria-checked={horizon === h.id} class:on={horizon === h.id} onclick={() => (horizon = h.id)}>{h.label}</button>
			{/each}
		</div>
		{#if horizon === 'none'}
			<p class="hint">Статья не называет срок — 3 месяца по умолчанию. <HelpIcon topicKey="hypothesis.default_horizon" label="срок по умолчанию" /></p>
		{:else if horizon === 'date'}
			<input type="date" aria-label="Дата горизонта" min={today} bind:value={horizonDate} />
			{#if errors.horizonDate}<p class="err">{errors.horizonDate}</p>{/if}
		{/if}

		<label class="lbl" for="thesis">Тезис — что утверждает источник</label>
		<textarea id="thesis" rows="2" maxlength="300" placeholder="Одной фразой" bind:value={thesis}></textarea>
		{#if errors.thesis}<p class="err">{errors.thesis}</p>{/if}

		<div class="lbl-row">
			<label class="lbl" for="inv">Я был неправ, если…</label>
			<HelpIcon topicKey="hypothesis.invalidation" label="условие провала" />
		</div>
		<input id="inv" maxlength="300" placeholder="Например, выручка ниже прогноза" bind:value={invalidation} />
		{#if errors.invalidation}<p class="err">{errors.invalidation}</p>{/if}
	</section>

	<!-- 4. optional -->
	<section class="group">
		<div class="lbl-row">
			<label class="lbl" for="conf">Уверенность, % <span class="hint">необязательно</span></label>
			<HelpIcon topicKey="hypothesis.confidence" label="уверенность" />
		</div>
		<input id="conf" class="narrow" type="text" inputmode="numeric" placeholder="—" bind:value={confidencePct} />
		{#if errors.confidencePct}<p class="err">{errors.confidencePct}</p>{/if}

		<div class="lbl-row">
			<span class="lbl">Режим</span>
			<HelpIcon topicKey="hypothesis.mode" label="режим" />
		</div>
		<div class="seg" role="radiogroup" aria-label="Режим">
			<button type="button" role="radio" aria-checked={mode === 'sim'} class:on={mode === 'sim'} onclick={() => (mode = 'sim')}>Симуляция</button>
			<button type="button" role="radio" aria-checked={mode === 'real'} class:on={mode === 'real'} onclick={() => (mode = 'real')}>Реальные деньги</button>
		</div>

		{#if !more}
			<button type="button" class="link" onclick={() => (more = true)}>Ещё поля: целевая цена, {mode === 'real' ? 'сумма, ' : ''}теги</button>
		{:else}
			<label class="lbl" for="tp">Целевая цена из статьи{#if unit}, {unit}{/if}</label>
			<input id="tp" class="narrow" type="text" inputmode="decimal" placeholder="—" bind:value={targetPrice} />
			{#if errors.targetPrice}<p class="err">{errors.targetPrice}</p>{/if}
			{#if mode === 'real'}
				<label class="lbl" for="amt">Сумма{#if security}, {security.currency}{/if}</label>
				<input id="amt" class="narrow" type="text" inputmode="decimal" placeholder="—" bind:value={amount} />
				{#if errors.amount}<p class="err">{errors.amount}</p>{/if}
			{/if}
			<label class="lbl" for="tags">Теги <span class="hint">через запятую</span></label>
			<input id="tags" autocomplete="off" placeholder="полупроводники, дивиденды" bind:value={tags} />
		{/if}
	</section>

	{#if formError}<p class="err form" role="alert">{formError}</p>{/if}
	<div class="actions">
		<button type="submit" class="primary" disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
		<button type="button" class="secondary" disabled={saving} onclick={() => save(true)}>Сохранить и добавить ещё по этой статье</button>
	</div>
	<p class="hint center">После сохранения тикер, направление, срок, уверенность и условие «я неправ» не меняются. <HelpIcon topicKey="result.locked" label="почему нельзя менять" /></p>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: var(--s4);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		padding: var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	.lbl {
		font-weight: 600;
		margin-top: var(--s2);
	}
	.lbl-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		margin-top: var(--s2);
	}
	.lbl-row .lbl {
		margin-top: 0;
	}
	.hint {
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-s);
		font-weight: 400;
	}
	.center {
		text-align: center;
	}
	input,
	textarea {
		box-sizing: border-box;
		width: 100%;
		min-height: var(--tap);
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
	}
	textarea {
		resize: vertical;
		line-height: 1.4;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	.narrow {
		max-width: 140px;
	}
	.title-in {
		font-size: var(--fs-m);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
	}
	.chips button,
	.seg button {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--bg);
		cursor: pointer;
	}
	.chips button.on,
	.seg button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.chips .add {
		border-style: dashed;
		color: var(--muted);
	}
	.seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: var(--s2);
	}
	.seg button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--s1);
		border-radius: var(--r2);
	}
	.seg.four {
		grid-auto-flow: row;
		grid-template-columns: 1fr 1fr;
	}
	.small-seg button {
		min-height: 36px;
		font-size: var(--fs-s);
	}
	.inline {
		display: flex;
		gap: var(--s2);
	}
	.small {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: none;
		border-radius: var(--r2);
		background: var(--text);
		color: var(--bg);
		cursor: pointer;
	}
	.chosen {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.icon {
		flex: none;
		width: var(--tap);
		height: var(--tap);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: var(--r2);
		background: none;
		cursor: pointer;
	}
	.link {
		align-self: flex-start;
		min-height: var(--tap);
		padding: 0;
		border: none;
		background: none;
		color: var(--link);
		cursor: pointer;
	}
	.err {
		margin: 0;
		color: var(--down);
		font-size: var(--fs-s);
	}
	.err.form {
		text-align: center;
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.primary,
	.secondary {
		min-height: 52px;
		border-radius: var(--r2);
		font-weight: 600;
		cursor: pointer;
	}
	.primary {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
		font-size: var(--fs-m);
	}
	.secondary {
		border: 1px solid var(--line);
		background: var(--surface);
	}
	button:disabled {
		opacity: 0.6;
	}
</style>
