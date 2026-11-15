<script lang="ts">
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
		articles: { article: { id: number; url: string | null; title: string | null; author: string | null; readAt: string }; hypotheses: Hyp[] }[];
	}
	const SIGNAL: Record<string, string> = { recommendation: 'Рекомендация', target: 'Целевая цена', opinion: 'Мнение', news: 'Новость' };

	let card = $state<Card | null>(null);
	let noDefault = $state(false);
	let problem = $state<string | undefined>();

	async function load() {
		try {
			const r = await fetch(`/api/sources/${page.params.id}${noDefault ? '?noDefault=1' : ''}`);
			if (!r.ok) throw new Error(r.status === 404 ? 'Нет такого источника.' : 'Нет связи с сервером.');
			card = await r.json();
			problem = undefined;
		} catch (e) {
			problem = (e as Error).message;
		}
	}
	onMount(load);
	const date = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<svelte:head><title>{card?.source.name ?? 'Источник'} · Журнал гипотез</title></svelte:head>

<TopBar title={card?.source.name ?? 'Источник'} back={{ href: '/sources', label: 'Источники' }} subtitle={card?.source.domain ?? undefined} />

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if card}
	<section class="card summary">
		<div class="head">
			<span class="k">Доля сработавших <HelpIcon topicKey="source.stats" label="доля и интервал" /></span>
			<Rate score={card.score} help />
		</div>
		<p class="meta">
			Закрыто {card.score.n} · открыто {card.open}{#if card.score.n}
				{' · '}среднее превышение <Pct value={card.score.meanExcess} /> · медиана <Pct value={card.score.medianExcess} /> · лучшее <Pct value={card.score.best} plain /> · худшее <Pct value={card.score.worst} plain />{/if}
		</p>
		<p class="meta small">В оценку входят «Рекомендация», «Целевая цена» и «Мнение», закрытые в срок. Отдельно:</p>
		<div class="apart">
			<div><span>Новости</span><Rate score={card.news} /></div>
			<div><span>Закрыты досрочно</span><Rate score={card.early} /></div>
		</div>
		<button class="chip" class:on={noDefault} aria-pressed={noDefault} onclick={() => ((noDefault = !noDefault), load())}>Без срока по умолчанию</button>
	</section>

	{#snippet table(title: string, parts: Part[])}
		{#if parts.length}
			<section class="card">
				<h2>{title}</h2>
				<ul class="parts">
					{#each parts as p (p.key)}
						<li>
							<span class="label">{p.label}{#if p.rated === false}<span class="tag">не в оценке</span>{/if}</span>
							<span class="nums">закрыто {p.score.n}{p.open ? ` · открыто ${p.open}` : ''}</span>
							<span class="r"><Rate score={p.score} /></span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/snippet}
	{@render table('По типу сигнала', card.byType)}
	{@render table('По автору', card.byAuthor)}
	{@render table('По сроку', card.byHorizon)}
	{@render table('По режиму', card.byMode)}

	<section class="card">
		<h2>Статьи и гипотезы</h2>
		{#if !card.articles.length}
			<p class="meta">Гипотез по этому источнику пока нет.</p>
		{/if}
		{#each card.articles as a (a.article.id)}
			<div class="article">
				<p class="atitle">
					{#if a.article.url}<a href={a.article.url} target="_blank" rel="noopener noreferrer">{a.article.title || new URL(a.article.url).hostname}</a>{:else}{a.article.title || 'Без ссылки'}{/if}
				</p>
				<p class="meta small">{date(a.article.readAt)}{a.article.author ? ` · ${a.article.author}` : ''}</p>
				<ul class="hyps">
					{#each a.hypotheses as h (h.id)}
						<li>
							<a href="/?open={h.id}">
								<b>{h.symbol}</b>
								<span class="dir {h.direction}">{h.direction === 'long' ? '▲' : '▼'}</span>
								<span class="muted">{SIGNAL[h.signalType]}</span>
								<span class="grow"></span>
								{#if h.status === 'open'}
									{#if h.entryPrice === null}<span class="muted">ожидает цену</span>{:else}<Pct value={h.currentExcessPct} />{/if}
								{:else}
									<Pct value={h.excessPct} /><span
										class="mark {h.outcome}"
										title={h.status === 'closed_early' ? 'закрыта досрочно' : h.outcome === 'hit' ? 'сработала' : 'не сработала'}
										aria-label={h.status === 'closed_early' ? 'закрыта досрочно' : h.outcome === 'hit' ? 'сработала' : 'не сработала'}
										>{h.status === 'closed_early' ? '⏹' : h.outcome === 'hit' ? '✓' : '✗'}</span
									>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</section>
{:else if !problem}
	<div class="skeleton"></div>
{/if}

<style>
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
	h2 {
		margin: 0 0 var(--s2);
		font-size: var(--fs-m);
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
