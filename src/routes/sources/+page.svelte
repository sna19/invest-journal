<script lang="ts">
	import { tl, tx } from '#lib/i18n.js';
	import { onMount } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import TopBar from '#lib/TopBar.svelte';
	import Empty from '#lib/Empty.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Rate from '#lib/Rate.svelte';
	import Pct from '#lib/Pct.svelte';
	import type { Score } from '#lib/stats.js';

	/** Spec sections 7, 9 and 17 — sources by the lower bound of their interval; news and early closes apart. */
	interface Row {
		id: number;
		name: string;
		kind: string;
		articles: number;
		open: number;
		score: Score;
		news: Score;
		early: Score;
	}
	const KEY = 'sources-no-default';
	let items = $state<Row[] | null>(null);
	let noDefault = $state(false);
	let problem = $state<string | undefined>();

	async function load() {
		try {
			const r = await fetch(`/api/sources/stats${noDefault ? '?noDefault=1' : ''}`);
			if (!r.ok) throw new Error();
			items = (await r.json()).items;
			problem = undefined;
		} catch {
			problem = tx('Нет связи с сервером.', 'No connection to the server.');
		}
	}
	onMount(() => {
		try {
			noDefault = localStorage.getItem(KEY) === '1';
		} catch {
			/* ignore */
		}
		load();
	});
	function toggle() {
		noDefault = !noDefault;
		try {
			localStorage.setItem(KEY, noDefault ? '1' : '0');
		} catch {
			/* ignore */
		}
		load();
	}

	const active = $derived(items?.filter((r) => r.score.n || r.open || r.news.n || r.early.n) ?? []);
	const idle = $derived(items?.filter((r) => !(r.score.n || r.open || r.news.n || r.early.n)) ?? []);
</script>

<svelte:head><title>{tx('Источники', 'Sources')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Источники', 'Sources')} help="source.usefulness" />

<div class="bar">
	<button class="chip" class:on={noDefault} aria-pressed={noDefault} onclick={toggle}>{tx('Без срока по умолчанию', 'Without the default term')}</button>
	<span class="grow"></span>
	<span class="muted small">{tx('Как читать', 'How to read')}</span>
	<HelpIcon topicKey="source.stats" label={tx('как читать таблицу источников', 'how to read the sources table')} />
</div>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if items === null}
	{#each [1, 2, 3] as i (i)}<div class="skeleton"></div>{/each}
{:else if !active.length}
	<Empty title={tx('Каким источникам можно верить', 'Which sources to trust')}>
		{tx('Здесь появится таблица изданий и авторов: сколько их утверждений сработало и с каким интервалом. Оценка появляется после 10 закрытых гипотез источника; до этого — только счётчик.', 'Here a table of outlets and authors will appear: how many of their claims came true and with what interval. A rating appears after 10 closed hypotheses of a source; before that — only a count.')}
		{#snippet action()}<a href="/new">{tx('Новая гипотеза', 'New hypothesis')}</a>{/snippet}
	</Empty>
{:else}
	<ul class="list">
		{#each active as r, i (r.id)}
			<li>
				<a href="/sources/{r.id}">
					<span class="top">
						<b class="name">{tl(r.name)}</b>
						<span class="grow"></span>
						<Rate score={r.score} help={i === active.findIndex((x) => x.score.level === 'few')} />
					</span>
					<span class="meta">
						{tx('закрыто', 'closed')} {r.score.n} · {tx('открыто', 'open')} {r.open} · {tx('статей', 'articles')} {r.articles}
						{#if r.score.n}
							· {tx('среднее', 'mean')} <Pct value={r.score.meanExcess} plain /> · {tx('медиана', 'median')} <Pct value={r.score.medianExcess} plain />
						{/if}
					</span>
					{#if r.news.n || r.early.n}
						<span class="meta apart">
							{#if r.news.n}{tx('Новости отдельно', 'News apart')}: {r.news.hits} {tx('из', 'of')} {r.news.n}{/if}{#if r.news.n && r.early.n}{' · '}{/if}{#if r.early.n}{tx('досрочно закрыто', 'closed early')}: {r.early.n}{/if}
						</span>
					{/if}
					<ChevronRight size={18} />
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if idle.length}
	<p class="muted small idle">{tx('Пока без гипотез', 'No hypotheses yet')}: {idle.map((r) => tl(r.name)).join(', ')}.</p>
{/if}

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin-bottom: var(--s3);
	}
	.grow {
		flex: 1;
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
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	a {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3) calc(var(--s4) + 20px) var(--s3) var(--s4);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
	}
	a > :global(svg) {
		position: absolute;
		right: var(--s2);
		top: 50%;
		transform: translateY(-50%);
		color: var(--muted);
	}
	.top {
		display: flex;
		align-items: center;
		gap: var(--s2);
	}
	.name {
		font-size: var(--fs-m);
	}
	.meta {
		color: var(--muted);
		font-size: var(--fs-s);
	}
	.apart {
		font-size: var(--fs-xs);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.idle {
		margin-top: var(--s4);
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 80px;
		margin-bottom: var(--s2);
		border-radius: var(--r2);
		background: var(--surface);
	}
</style>
