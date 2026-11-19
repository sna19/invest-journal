<script lang="ts">
	import { loc, tl, tx } from '#lib/i18n.js';
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
	/** spec section 14 question: a security the price provider does not know — warn when it is chosen */
	let noPrices = $state(false);

	async function choose(s: Security) {
		security = s;
		noPrices = false;
		const r = await fetch(`/api/securities/${s.id}`).then((r) => r.json()).catch(() => null);
		if (security?.id === s.id) noPrices = r?.priceStatus === 'none';
	}

	let newSource = $state<string | null>(null);
	let metaLoading = $state(false);
	let saving = $state(false);
	let submitted = $state(false);
	let serverErrors = $state<Errors>({});
	let formError = $state<string | undefined>();

	const today = israelDate();
	// T-007: an own idea has no article — no «из статьи» for the direction and the term
	const own = $derived(sources.find((x) => x.id === sourceId)?.kind === 'own');
	const input = $derived<HypothesisInput>({
		url,
		sourceId,
		articleId,
		articleTitle,
		author,
		securityId: security?.id ?? null,
		signalType,
		direction,
		directionSource: signalType === 'news' || own ? 'mine' : directionSource,
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
	const unit = $derived(security ? (security.priceUnit === 'ILA' ? tx('агорот', 'agorot') : security.currency) : '');

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
		if (!r.ok) return (formError = (await r.json().catch(() => ({}))).message ?? tx('Источник не добавился', 'The source was not added'));
		const s = await r.json();
		if (!sources.some((x) => x.id === s.id)) sources = [...sources, s];
		newSource = null;
		pickSource(s.id);
	}

	// T-007: for a recommendation, a target or an opinion from an outside source the direction is «из статьи»
	// by default; «моё толкование» stays a deliberate choice
	function setSignal(t: string) {
		signalType = t;
		directionSource = t === 'news' ? 'mine' : 'article';
	}

	async function save(again: boolean) {
		submitted = true;
		serverErrors = {};
		formError = undefined;
		if (Object.keys(validate(input, today)).length) {
			formError = tx('Проверьте отмеченные поля', 'Check the marked fields');
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
				formError = tl(j.message) || tx('Не сохранилось', 'Not saved');
				return;
			}
			showToast(`${tx('Записано', 'Recorded')}: ${j.symbol} ${j.direction === 'long' ? '▲' : '▼'} ${tx('до', 'until')} ${new Date(j.horizonDate).toLocaleDateString(loc())}`);
			if (again) {
				// same article: keep the link, source, author and title; the next ticker
				articleId = j.articleId;
				security = null;
				noPrices = false;
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
			formError = tx('Нет связи с сервером — попробуйте ещё раз', 'No connection to the server — try again');
		} finally {
			saving = false;
		}
	}

	const sourceName = $derived(sources.find((s) => s.id === sourceId)?.name);
</script>

<svelte:head><title>{tx('Новая гипотеза', 'New hypothesis')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Новая гипотеза', 'New hypothesis')} back={{ href: '/', label: tx('Гипотезы', 'Hypotheses') }} />

<form
	novalidate
	onsubmit={(e) => {
		e.preventDefault();
		save(false);
	}}
>
	<!-- 1. the article -->
	<section class="group">
		<label class="lbl" for="url">{tx('Ссылка на статью', 'Article link')}</label>
		<input
			id="url"
			type="url"
			inputmode="url"
			autocomplete="off"
			autocapitalize="off"
			placeholder={tx('https://…  (пусто — своя идея)', 'https://…  (empty — own idea)')}
			bind:value={url}
			onchange={lookup}
			onpaste={() => setTimeout(lookup, 0)}
		/>
		{#if errors.url}<p class="err">{tl(errors.url)}</p>{/if}
		{#if metaLoading}<p class="hint">{tx('Ищу источник и заголовок…', 'Looking for the source and title…')}</p>{/if}
		{#if url && (articleTitle || !metaLoading)}
			<input class="title-in" aria-label={tx('Заголовок статьи', 'Article title')} placeholder={tx('Заголовок (необязательно)', 'Title (optional)')} bind:value={articleTitle} />
		{/if}

		<div class="lbl-row"><span class="lbl">{tx('Источник', 'Source')}</span>{#if sourceAuto && sourceName}<span class="hint">{tx('по ссылке', 'from the link')}</span>{/if}</div>
		<div class="chips" role="radiogroup" aria-label={tx('Источник', 'Source')}>
			{#each sources as s (s.id)}
				<button type="button" role="radio" aria-checked={sourceId === s.id} class:on={sourceId === s.id} onclick={() => pickSource(s.id)}>{tl(s.name)}</button>
			{/each}
			{#if newSource === null}
				<button type="button" class="add" onclick={() => (newSource = '')}>+ {tx('другой', 'other')}</button>
			{/if}
		</div>
		{#if newSource !== null}
			<div class="inline">
				<!-- svelte-ignore a11y_autofocus -->
				<input aria-label={tx('Новый источник', 'New source')} placeholder={tx('Название источника', 'Source name')} bind:value={newSource} autofocus />
				<button type="button" class="small" onclick={addSource}>{tx('Добавить', 'Add')}</button>
			</div>
		{/if}
		{#if errors.sourceId}<p class="err">{tl(errors.sourceId)}</p>{/if}

		<label class="lbl" for="author">{tx('Автор', 'Author')} <span class="hint">{tx('аналитик или инвестдом, а не журналист', 'an analyst or an investment house, not a journalist')}</span></label>
		<input id="author" list="authors" autocomplete="off" placeholder={tx('Например, Morgan Stanley', 'For example, Morgan Stanley')} bind:value={author} />
		<datalist id="authors">{#each authors as a (a)}<option value={a}></option>{/each}</datalist>
	</section>

	<!-- 2. the security -->
	<section class="group">
		{#if security}
			<div class="lbl-row"><span class="lbl">{tx('Бумага', 'Security')}</span></div>
			<div class="chosen">
				<div>
					<b>{security.symbol}</b> — {security.nameEn}
					<div class="hint">{security.exchangeName} · {unit} · {tx('бенчмарк', 'benchmark')} {security.exchangeCode === 'TASE' ? tx('ТА-125', 'TA-125') : 'S&P 500'}</div>
				</div>
				<button type="button" class="icon" aria-label={tx('Выбрать другую бумагу', 'Choose another security')} onclick={() => (security = null)}><X size={20} /></button>
			</div>
		{:else}
			<TickerSearch label={tx('Бумага', 'Security')} noIndex onselect={choose} />
		{/if}
		{#if errors.securityId}<p class="err">{tl(errors.securityId)}</p>{/if}
		{#if security && noPrices}
			<p class="warn-box" role="alert">
				{tx('У поставщика цен нет этой бумаги: гипотеза запишется, но цена входа и результат не появятся. Если есть такая же бумага на другой бирже — лучше выбрать её.', 'The price provider does not have this security: the hypothesis is saved, but no entry price or result will appear. If the same security trades on another exchange — better choose that.')}
			</p>
		{/if}
	</section>

	<!-- 3. what the source says -->
	<section class="group">
		<div class="lbl-row">
			<span class="lbl">{tx('Тип сигнала', 'Signal type')}</span>
			<HelpIcon topicKey="hypothesis.signal_type" label={tx('тип сигнала', 'signal type')} />
		</div>
		<div class="seg four" role="radiogroup" aria-label={tx('Тип сигнала', 'Signal type')}>
			{#each SIGNAL_TYPES as t (t.id)}
				<button type="button" role="radio" aria-checked={signalType === t.id} class:on={signalType === t.id} onclick={() => setSignal(t.id)}>{tl(t.label)}</button>
			{/each}
		</div>
		{#if signalType}<p class="hint">{tl(SIGNAL_TYPES.find((t) => t.id === signalType)?.hint)}</p>{/if}
		{#if errors.signalType}<p class="err">{tl(errors.signalType)}</p>{/if}

		<span class="lbl">{tx('Направление', 'Direction')}</span>
		<div class="seg" role="radiogroup" aria-label={tx('Направление', 'Direction')}>
			<button type="button" role="radio" aria-checked={direction === 'long'} class:on={direction === 'long'} onclick={() => (direction = 'long')}
				><ArrowUpRight size={18} /> {tx('Рост', 'Up')}</button
			>
			<button type="button" role="radio" aria-checked={direction === 'short'} class:on={direction === 'short'} onclick={() => (direction = 'short')}
				><ArrowDownRight size={18} /> {tx('Падение', 'Down')}</button
			>
		</div>
		{#if errors.direction}<p class="err">{tl(errors.direction)}</p>{/if}
		{#if own}
			<p class="hint">{tx('Собственная идея — направление ваше.', 'Own idea — the direction is yours.')}</p>
		{:else if signalType === 'news'}
			<p class="hint">{tx('Для новости направление — ваше толкование.', 'For news the direction is your reading.')}</p>
		{:else}
			<div class="seg small-seg" role="radiogroup" aria-label={tx('Откуда направление', 'Where the direction comes from')}>
				<button type="button" role="radio" aria-checked={directionSource === 'article'} class:on={directionSource === 'article'} onclick={() => (directionSource = 'article')}>{tx('Из статьи', 'From the article')}</button>
				<button type="button" role="radio" aria-checked={directionSource === 'mine'} class:on={directionSource === 'mine'} onclick={() => (directionSource = 'mine')}>{tx('Моё толкование', 'My reading')}</button>
			</div>
		{/if}

		<div class="lbl-row">
			<span class="lbl">{own ? tx('Срок', 'Horizon') : tx('Срок из статьи', 'Horizon from the article')}</span>
			<HelpIcon topicKey="hypothesis.horizon" label={tx('срок', 'horizon')} />
		</div>
		<div class="chips" role="radiogroup" aria-label={tx('Срок', 'Horizon')}>
			{#each HORIZONS as h (h.id)}
				<button type="button" role="radio" aria-checked={horizon === h.id} class:on={horizon === h.id} onclick={() => (horizon = h.id)}
					>{own && h.id === 'none' ? tx('По умолчанию', 'Default') : tl(h.label)}</button
				>
			{/each}
		</div>
		{#if horizon === 'none'}
			<p class="hint">{own ? tx('Срок не выбран', 'No horizon chosen') : tx('Статья не называет срок', 'The article names no horizon')} — {tx('3 месяца по умолчанию.', '3 months by default.')} <HelpIcon topicKey="hypothesis.default_horizon" label={tx('срок по умолчанию', 'default horizon')} /></p>
		{:else if horizon === 'date'}
			<input type="date" aria-label={tx('Дата горизонта', 'Horizon date')} min={today} bind:value={horizonDate} />
			{#if errors.horizonDate}<p class="err">{tl(errors.horizonDate)}</p>{/if}
		{/if}

		<label class="lbl" for="thesis">{tx('Тезис — что утверждает источник', 'Thesis — what the source claims')}</label>
		<textarea id="thesis" rows="2" maxlength="300" placeholder={tx('Одной фразой', 'In one sentence')} bind:value={thesis}></textarea>
		{#if errors.thesis}<p class="err">{tl(errors.thesis)}</p>{/if}

		<div class="lbl-row">
			<label class="lbl" for="inv">{tx('Я был неправ, если…', 'I was wrong if…')}</label>
			<HelpIcon topicKey="hypothesis.invalidation" label={tx('условие провала', 'failure condition')} />
		</div>
		<input id="inv" maxlength="300" placeholder={tx('Например, выручка ниже прогноза', 'For example, revenue below the forecast')} bind:value={invalidation} />
		{#if errors.invalidation}<p class="err">{tl(errors.invalidation)}</p>{/if}
	</section>

	<!-- 4. optional -->
	<section class="group">
		<div class="lbl-row">
			<label class="lbl" for="conf">{tx('Уверенность, %', 'Confidence, %')} <span class="hint">{tx('необязательно', 'optional')}</span></label>
			<HelpIcon topicKey="hypothesis.confidence" label={tx('уверенность', 'confidence')} />
		</div>
		<input id="conf" class="narrow" type="text" inputmode="numeric" placeholder="—" bind:value={confidencePct} />
		{#if errors.confidencePct}<p class="err">{tl(errors.confidencePct)}</p>{/if}

		<div class="lbl-row">
			<span class="lbl">{tx('Режим', 'Mode')}</span>
			<HelpIcon topicKey="hypothesis.mode" label={tx('режим', 'mode')} />
		</div>
		<div class="seg" role="radiogroup" aria-label={tx('Режим', 'Mode')}>
			<button type="button" role="radio" aria-checked={mode === 'sim'} class:on={mode === 'sim'} onclick={() => (mode = 'sim')}>{tx('Симуляция', 'Simulation')}</button>
			<button type="button" role="radio" aria-checked={mode === 'real'} class:on={mode === 'real'} onclick={() => (mode = 'real')}>{tx('Реальные деньги', 'Real money')}</button>
		</div>

		{#if !more}
			<button type="button" class="link" onclick={() => (more = true)}>{tx('Ещё поля: целевая цена, ', 'More fields: target price, ')}{mode === 'real' ? tx('сумма, ', 'amount, ') : ''}{tx('теги', 'tags')}</button>
		{:else}
			<label class="lbl" for="tp">{tx('Целевая цена из статьи', 'Target price from the article')}{#if unit}, {unit}{/if}</label>
			<input id="tp" class="narrow" type="text" inputmode="decimal" placeholder="—" bind:value={targetPrice} />
			{#if errors.targetPrice}<p class="err">{tl(errors.targetPrice)}</p>{/if}
			{#if mode === 'real'}
				<label class="lbl" for="amt">{tx('Сумма', 'Amount')}{#if security}, {security.currency}{/if}</label>
				<input id="amt" class="narrow" type="text" inputmode="decimal" placeholder="—" bind:value={amount} />
				{#if errors.amount}<p class="err">{tl(errors.amount)}</p>{/if}
			{/if}
			<label class="lbl" for="tags">{tx('Теги', 'Tags')} <span class="hint">{tx('через запятую', 'comma-separated')}</span></label>
			<input id="tags" autocomplete="off" placeholder={tx('полупроводники, дивиденды', 'semiconductors, dividends')} bind:value={tags} />
		{/if}
	</section>

	{#if formError}<p class="err form" role="alert">{formError}</p>{/if}
	<div class="actions">
		<button type="submit" class="primary" disabled={saving}>{saving ? tx('Сохраняю…', 'Saving…') : tx('Сохранить', 'Save')}</button>
		<button type="button" class="secondary" disabled={saving} onclick={() => save(true)}>{tx('Сохранить и добавить ещё по этой статье', 'Save and add another from this article')}</button>
	</div>
	<p class="hint center">{tx('После сохранения тикер, направление, срок, уверенность и условие «я неправ» не меняются.', 'After saving, the ticker, direction, horizon, confidence and the «I was wrong» condition do not change.')} <HelpIcon topicKey="result.locked" label={tx('почему нельзя менять', 'why it cannot change')} /></p>
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
	.warn-box {
		margin: 0;
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: var(--fs-s);
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
