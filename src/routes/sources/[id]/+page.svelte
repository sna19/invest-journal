<script lang="ts">
	import Fold from '#lib/Fold.svelte';
	import Feed from '#lib/journal/Feed.svelte';
	import { loc, tl, tx } from '#lib/i18n.js';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import TopBar from '#lib/TopBar.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Rate from '#lib/Rate.svelte';
	import Pct from '#lib/Pct.svelte';
	import type { Score } from '#lib/stats.js';

	/** Spec section 9 — the source card: its numbers, broken down by type, author, term and mode; the articles below. */
	interface Part {
		key: string;
		label: string;
		score: Score;
		news?: Score;
		early?: Score;
		open: number;
		rated?: boolean;
	}
	interface Hyp {
		id: number;
		symbol: string;
		direction: string;
		signalType: string;
		status: string;
		outcome: string | null;
		excessPct: number | null;
		currentExcessPct: number | null;
		horizonDate: string;
		horizonSource: string;
		entryPrice: number | null;
	}
	interface Card {
		source: { id: number; name: string; domain: string | null; kind: string };
		score: Score;
		news: Score;
		early: Score;
		open: number;
		byType: Part[];
		byAuthor: Part[];
		byHorizon: Part[];
		byMode: Part[];
		auto: { id: number; name: string; currency: string; archivedAt: string | null; amount: number }[];
		articles: { article: { id: number; url: string | null; title: string | null; author: string | null; readAt: string }; hypotheses: Hyp[] }[];
	}
	const SIGNAL: Record<string, string> = { recommendation: 'Рекомендация', target: 'Целевая цена', opinion: 'Мнение', news: 'Новость' }; // shown through tl()

	let card = $state<Card | null>(null);
	let noDefault = $state(false);
	let problem = $state<string | undefined>();

	async function load() {
		try {
			const r = await fetch(`/api/sources/${page.params.id}${noDefault ? '?noDefault=1' : ''}`);
			if (!r.ok) throw new Error(r.status === 404 ? tx('Нет такого источника.', 'No such source.') : tx('Нет связи с сервером.', 'No connection to the server.'));
			card = await r.json();
			problem = undefined;
		} catch (e) {
			problem = (e as Error).message;
		}
	}
	onMount(load);

	const autoOn = $derived(!!card?.auto.some((a) => !a.archivedAt));
	// section 18: the source's automatic virtual portfolio — each of its rise hypotheses bought for a fixed sum
	let autoBusy = $state(false);
	async function toggleAuto() {
		if (!card) return;
		autoBusy = true;
		const on = !autoOn;
		const r = await fetch(`/api/sources/${card.source.id}/auto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
		autoBusy = false;
		if (!r.ok) return (problem = (await r.json().catch(() => ({}))).message ?? tx('Не получилось', 'It did not work'));
		await load();
	}
	const date = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<svelte:head><title>{tl(card?.source.name) || tx('Источник', 'Source')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tl(card?.source.name) || tx('Источник', 'Source')} back={{ href: '/sources', label: tx('Источники', 'Sources') }} subtitle={card?.source.domain ?? undefined} />

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if card}
	<section class="card autoport">
		<label class="toggle">
			<input type="checkbox" checked={autoOn} disabled={autoBusy} onchange={toggleAuto} />
			<span>{tx('Автоматический портфель', 'Automatic portfolio')}</span>
			<HelpIcon topicKey="portfolio.source_auto" label={tx('автоматический портфель', 'automatic portfolio')} />
		</label>
		<p class="muted small">
			{#if autoOn}
				{tx('Каждая гипотеза на рост (рекомендация, целевая цена, мнение) покупается по цене входа — бумаги США на 3 000 $, TASE на 10 000 ₪ — и продаётся при закрытии.', 'Each hypothesis on a rise (recommendation, target price, opinion) is bought at the entry price — US securities for $3,000, TASE for ₪10,000 — and sold when it closes.')}
				{#each card.auto.filter((a) => !a.archivedAt) as a (a.id)}<a href="/portfolio?p={a.id}">«{a.name}»</a>{' '}{/each}
			{:else}
				{tx('Включите, чтобы сравнивать источник в деньгах — рядом с вашим реальным портфелем.', 'Turn it on to compare the source in money — next to your real portfolio.')}
			{/if}
		</p>
	</section>
	<section class="card summary">
		<div class="head">
			<span class="k">{tx('Доля сработавших', 'Share that came true')} <HelpIcon topicKey="source.stats" label={tx('доля и интервал', 'share and interval')} /></span>
			<Rate score={card.score} help />
		</div>
		<p class="meta">
			{tx('Закрыто', 'Closed')} {card.score.n} · {tx('открыто', 'open')} {card.open}{#if card.score.n}
				{' · '}{tx('среднее превышение', 'mean excess')} <Pct value={card.score.meanExcess} /> · {tx('медиана', 'median')} <Pct value={card.score.medianExcess} /> · {tx('лучшее', 'best')} <Pct value={card.score.best} plain /> · {tx('худшее', 'worst')} <Pct value={card.score.worst} plain />{/if}
		</p>
		<p class="meta small">{tx('В оценку входят «Рекомендация», «Целевая цена» и «Мнение», закрытые в срок. Отдельно:', 'The rating counts «Recommendation», «Target price» and «Opinion» closed on time. Apart:')}</p>
		<div class="apart">
			<div><span>{tx('Новости', 'News')}</span><Rate score={card.news} /></div>
			<div><span>{tx('Закрыты досрочно', 'Closed early')}</span><Rate score={card.early} /></div>
		</div>
		<button class="chip" class:on={noDefault} aria-pressed={noDefault} onclick={() => ((noDefault = !noDefault), load())}>{tx('Без срока по умолчанию', 'Without the default term')}</button>
	</section>

	{#snippet table(title: string, parts: Part[])}
		{#if parts.length}
			<Fold key="source-{title}" title={title} summary={parts.map((p) => tl(p.label)).join(' · ')}>
				<ul class="parts">
					{#each parts as p (p.key)}
						<li>
							<span class="label">{tl(p.label)}{#if p.rated === false}<span class="tag">{tx('не в оценке', 'not rated')}</span>{/if}</span>
							<span class="nums">{tx('закрыто', 'closed')} {p.score.n}{p.open ? ` · ${tx('открыто', 'open')} ${p.open}` : ''}</span>
							<span class="r"><Rate score={p.score} /></span>
						</li>
					{/each}
				</ul>
			</Fold>
		{/if}
	{/snippet}
	{@render table(tx('По типу сигнала', 'By signal type'), card.byType)}
	{@render table(tx('По автору', 'By author'), card.byAuthor)}
	{@render table(tx('По сроку', 'By term'), card.byHorizon)}
	{@render table(tx('По режиму', 'By mode'), card.byMode)}

	<!-- T-032 Д-08: the source's diary — with the entries about its hypotheses («через №12») -->
	<Fold key="source-journal" title={tx('Дневник', 'Diary')} open={false}>
		{#snippet aside()}<HelpIcon topicKey="journal.inherit" label={tx('дневник источника', 'the source\'s diary')} />{/snippet}
		<Feed scope={`source:${page.params.id}`} links={[{ type: 'source', id: String(page.params.id), label: '' }]} />
	</Fold>

	<Fold key="source-articles" title={tx('Статьи и гипотезы', 'Articles and hypotheses')} summary={tx(`статей: ${card.articles.length}`, `articles: ${card.articles.length}`)}>
		{#if !card.articles.length}
			<p class="meta">{tx('Гипотез по этому источнику пока нет.', 'No hypotheses from this source yet.')}</p>
		{/if}
		{#each card.articles as a (a.article.id)}
			<div class="article">
				<p class="atitle">
					{#if a.article.url}<a href={a.article.url} target="_blank" rel="noopener noreferrer">{a.article.title || new URL(a.article.url).hostname}</a>{:else}{a.article.title || tx('Без ссылки', 'No link')}{/if}
				</p>
				<p class="meta small">{date(a.article.readAt)}{a.article.author ? ` · ${a.article.author}` : ''}</p>
				<ul class="hyps">
					{#each a.hypotheses as h (h.id)}
						<li>
							<a href="/?open={h.id}">
								<b>{h.symbol}</b>
								<span class="dir {h.direction}">{h.direction === 'long' ? '▲' : '▼'}</span>
								<span class="muted">{tl(SIGNAL[h.signalType])}</span>
								<span class="grow"></span>
								{#if h.status === 'open'}
									{#if h.entryPrice === null}<span class="muted">{tx('ожидает цену', 'awaits a price')}</span>{:else}<Pct value={h.currentExcessPct} />{/if}
								{:else}
									<Pct value={h.excessPct} /><span
										class="mark {h.outcome}"
										title={h.status === 'closed_early' ? tx('закрыта досрочно', 'closed early') : h.outcome === 'hit' ? tx('сработала', 'came true') : tx('не сработала', 'failed')}
										aria-label={h.status === 'closed_early' ? tx('закрыта досрочно', 'closed early') : h.outcome === 'hit' ? tx('сработала', 'came true') : tx('не сработала', 'failed')}
										>{h.status === 'closed_early' ? '⏹' : h.outcome === 'hit' ? '✓' : '✗'}</span
									>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</Fold>
{:else if !problem}
	<div class="skeleton"></div>
{/if}

<style>
	.autoport .toggle {
		display: flex;
		align-items: center;
		gap: var(--s2);
		min-height: var(--tap);
		font-weight: 600;
	}
	.autoport .toggle input {
		width: 22px;
		height: 22px;
		margin: 0;
	}
	.autoport p {
		margin: 0;
	}
	.card {
		margin-bottom: var(--s4);
		padding: var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
	}
	.k {
		display: inline-flex;
		align-items: center;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.meta {
		margin: var(--s2) 0 0;
		color: var(--muted);
		font-size: var(--fs-s);
		line-height: 1.5;
	}
	.small {
		font-size: var(--fs-xs);
	}
	.apart {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s2);
		margin: var(--s2) 0 var(--s3);
	}
	.apart > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--bg);
		font-size: var(--fs-s);
	}
	.chip {
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.chip.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.parts,
	.hyps {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.parts li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px var(--s2);
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.label {
		font-weight: 600;
	}
	.tag {
		margin-left: var(--s2);
		font-size: var(--fs-xs);
		font-weight: 400;
		color: var(--muted);
	}
	.nums {
		grid-column: 1;
		color: var(--muted);
		font-size: var(--fs-s);
	}
	.r {
		grid-column: 2;
		grid-row: 1 / span 2;
		align-self: center;
	}
	.article {
		padding: var(--s3) 0;
		border-top: 1px solid var(--line);
	}
	.atitle {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.hyps a {
		display: flex;
		align-items: baseline;
		gap: var(--s2);
		min-height: var(--tap);
		align-items: center;
		color: var(--text);
		text-decoration: none;
	}
	.grow {
		flex: 1;
	}
	.muted {
		color: var(--muted);
		font-size: var(--fs-s);
	}
	.mark {
		width: 1.2em;
		text-align: center;
		font-weight: 700;
	}
	.mark.hit {
		color: var(--up);
	}
	.mark.miss {
		color: var(--down);
	}
	.dir.long {
		color: var(--up);
	}
	.dir.short {
		color: var(--down);
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 220px;
		border-radius: var(--r3);
		background: var(--surface);
	}
</style>
