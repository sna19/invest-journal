<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import HelpIcon from '../HelpIcon.svelte';
	import { loc, tx } from '../i18n.js';
	import Entry, { type EntryData } from './Entry.svelte';
	import TagCloud, { type Tag } from './TagCloud.svelte';
	import { journalVersion, KIND_LABEL, openComposer, type ScreenLink } from './screen.svelte.js';

	/**
	 * A feed of the diary (Д-07, Д-08): newest first, by days, loading more on the way down. On a place (a security, a
	 * portfolio, a sector, a hypothesis, a source, a model run) — its entries and, upwards, its securities' ones; on the
	 * «Дневник» screen — all. The filters (Д-09) and the search (Д-10) live in the page's address.
	 */
	interface Props {
		/** «security:12»; null — every entry */
		scope?: string | null;
		/** what «Записать» links a new entry to */
		links?: ScreenLink[];
		/** a sector, an index or an ETF: the switch «включая записи бумаг» */
		inheritToggle?: boolean;
		/** the full set of filters (the «Дневник» screen) */
		full?: boolean;
	}
	let { scope = null, links = [], inheritToggle = false, full = false }: Props = $props();

	const P = (k: string) => page.url.searchParams.get(`j${k}`);
	let q = $state(untrack(() => P('q') ?? ''));
	let kind = $state(untrack(() => P('kind') ?? ''));
	let only = $state(untrack(() => P('only') ?? ''));
	let tags = $state<number[]>(untrack(() => (P('tags') ?? '').split(',').map(Number).filter((x) => x > 0)));
	let from = $state(untrack(() => P('from') ?? ''));
	let to = $state(untrack(() => P('to') ?? ''));
	let hyp = $state(untrack(() => P('hyp') ?? ''));
	let archived = $state(untrack(() => P('arch') === '1'));
	let remind = $state(untrack(() => P('rem') === '1'));
	let inherit = $state(untrack(() => P('inh') !== '0'));

	let items = $state<EntryData[]>([]);
	let next = $state<number | null>(null);
	let loading = $state(false);
	let cloud = $state<Tag[]>([]);
	let filtersOpen = $state(untrack(() => !!(P('kind') || P('only') || P('from') || P('to') || P('hyp') || P('arch') || P('rem'))));

	function params(before: number | null) {
		const s = new URLSearchParams();
		if (scope) s.set('scope', scope);
		if (!inherit) s.set('inherit', '0');
		if (q.trim()) s.set('q', q.trim());
		if (kind) s.set('kind', kind);
		if (only) s.set('only', only);
		if (tags.length) s.set('tags', tags.join(','));
		if (from) s.set('from', from);
		if (to) s.set('to', to);
		if (hyp) s.set('hyp', hyp);
		if (archived) s.set('archived', '1');
		if (remind) s.set('remind', '1');
		if (before) s.set('before', String(before));
		return s;
	}
	/** the filters into the address, so a reload or a shared link keeps them */
	function keepInUrl() {
		const u = new URL(page.url.href);
		const set = (k: string, v: string) => (v ? u.searchParams.set(`j${k}`, v) : u.searchParams.delete(`j${k}`));
		set('q', q.trim());
		set('kind', kind);
		set('only', only);
		set('tags', tags.join(','));
		set('from', from);
		set('to', to);
		set('hyp', hyp);
		set('arch', archived ? '1' : '');
		set('rem', remind ? '1' : '');
		set('inh', inherit ? '' : '0');
		if (u.href !== page.url.href) replaceState(u, page.state);
	}
	let seq = 0;
	async function load(more = false) {
		const my = ++seq;
		loading = true;
		const r = await fetch(`/api/journal?${params(more ? next : null)}`).then((x) => x.json()).catch(() => null);
		if (my !== seq) return;
		loading = false;
		if (!r) return;
		items = more ? [...items, ...r.items] : r.items;
		next = r.next;
	}
	async function loadCloud() {
		const s = new URLSearchParams();
		if (scope) s.set('scope', scope);
		if (!inherit) s.set('inherit', '0');
		cloud = (await fetch(`/api/journal/tags?${s}`).then((x) => x.json()).catch(() => ({ items: [] }))).items;
	}
	function changed() {
		keepInUrl();
		void load();
	}
	let typing: ReturnType<typeof setTimeout> | undefined;
	function onSearch() {
		clearTimeout(typing);
		typing = setTimeout(changed, 300);
	}

	let sentinel = $state<HTMLElement>();
	let io: IntersectionObserver | undefined;
	onMount(() => {
		void load();
		void loadCloud();
		io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && next && !loading && load(true), { rootMargin: '400px' });
	});
	$effect(() => {
		if (sentinel && io) {
			io.observe(sentinel);
			return () => io?.unobserve(sentinel!);
		}
	});
	onDestroy(() => (io?.disconnect(), clearTimeout(typing)));
	// a new entry anywhere: reload
	let seen = journalVersion.n;
	$effect(() => {
		if (journalVersion.n !== seen) {
			seen = journalVersion.n;
			untrack(() => (load(), loadCloud()));
		}
	});

	const dayOf = (s: string) => new Date(s).toLocaleDateString('sv-SE');
	const dayLabel = (d: string) => {
		const today = new Date().toLocaleDateString('sv-SE');
		const y = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE');
		if (d === today) return tx('Сегодня', 'Today');
		if (d === y) return tx('Вчера', 'Yesterday');
		return new Date(d + 'T12:00:00').toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'long', ...(d.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
	};
	const days = $derived.by(() => {
		const out: { day: string; items: EntryData[] }[] = [];
		for (const e of items) {
			const d = dayOf(e.createdAt);
			if (out.at(-1)?.day === d) out.at(-1)!.items.push(e);
			else out.push({ day: d, items: [e] });
		}
		return out;
	});
	const filtered = $derived(!!(q.trim() || kind || only || tags.length || from || to || hyp || archived || remind));
</script>

<div class="feed">
	<div class="bar">
		<input type="search" bind:value={q} oninput={onSearch} placeholder={tx('Поиск по дневнику', 'Search the diary')} aria-label={tx('Поиск по дневнику', 'Search the diary')} />
		<button class="write" onclick={() => openComposer({ links, kind: scope?.startsWith('hypothesis:') ? 'observation' : null })}>+ {tx('Записать', 'Write')}</button>
	</div>
	<div class="kinds" role="radiogroup" aria-label={tx('Тип записи', 'Kind of entry')}>
		<button role="radio" aria-checked={!kind && !only} class:on={!kind && !only} onclick={() => ((kind = ''), (only = ''), changed())}>{tx('Все', 'All')}</button>
		{#each Object.entries(KIND_LABEL) as [k, l] (k)}
			<button role="radio" aria-checked={kind === k} class:on={kind === k} onclick={() => ((kind = kind === k ? '' : k), (only = ''), changed())}>{tx(...l)}</button>
		{/each}
		<button role="radio" aria-checked={only === 'personal'} class:on={only === 'personal'} onclick={() => ((only = only === 'personal' ? '' : 'personal'), (kind = ''), changed())}>{tx('Личные', 'Personal')}</button>
		<button class="lnk" aria-expanded={filtersOpen} onclick={() => (filtersOpen = !filtersOpen)}>{filtersOpen ? tx('меньше', 'less') : tx('ещё фильтры', 'more filters')}</button>
	</div>
	{#if filtersOpen}
		<div class="more">
			<label>{tx('с', 'from')} <input type="date" bind:value={from} onchange={changed} /></label>
			<label>{tx('по', 'to')} <input type="date" bind:value={to} onchange={changed} /></label>
			{#if full}
				<label
					>{tx('Гипотезы', 'Hypotheses')}
					<select bind:value={hyp} onchange={changed}>
						<option value="">{tx('не важно', 'any')}</option>
						<option value="all">{tx('о любой гипотезе', 'about any hypothesis')}</option>
						{#if hyp && hyp !== 'all'}<option value={hyp}>№{hyp}</option>{/if}
					</select>
				</label>
			{/if}
			{#if inheritToggle}<label class="check"><input type="checkbox" bind:checked={inherit} onchange={() => (changed(), loadCloud())} /> {tx('включая записи бумаг', 'including the securities\' entries')}</label>{/if}
			<label class="check"><input type="checkbox" bind:checked={archived} onchange={changed} /> {tx('архив', 'archive')}</label>
			<label class="check"><input type="checkbox" bind:checked={remind} onchange={changed} /> {tx('с открытым напоминанием', 'with an open reminder')}</label>
		</div>
	{/if}
	<TagCloud tags={cloud} selected={tags} onchange={(ids) => ((tags = ids), changed())} />

	{#if !items.length && !loading}
		<p class="muted empty">
			{filtered ? tx('Ничего не нашлось.', 'Nothing found.') : tx('Записей пока нет. Мысль в момент решения ценнее объяснения задним числом.', 'No entries yet. A thought at the moment of a decision is worth more than an explanation in hindsight.')}
			<HelpIcon topicKey="journal.screen" label={tx('дневник', 'diary')} />
		</p>
	{/if}
	{#each days as d (d.day)}
		<h3 class="day">{dayLabel(d.day)}</h3>
		{#each d.items as e (e.id)}<Entry {e} onchange={() => (load(), loadCloud())} />{/each}
	{/each}
	<div bind:this={sentinel} class="sentinel">{#if loading}<span class="muted">…</span>{/if}</div>
</div>

<style>
	.feed {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.bar {
		display: flex;
		gap: var(--s2);
	}
	.bar input {
		flex: 1;
		min-width: 0;
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.write {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.kinds button[role='radio'] {
		min-height: 32px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.kinds button.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.lnk {
		border: none;
		background: none;
		color: var(--link);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.more {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2) var(--s3);
		align-items: center;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.more label {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.more input[type='date'],
	.more select {
		min-height: 34px;
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.day {
		margin: var(--s3) 0 0;
		font-size: var(--fs-s);
		color: var(--muted);
		font-weight: 600;
		text-transform: capitalize;
	}
	.empty {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.sentinel {
		min-height: 1px;
		text-align: center;
	}
	.muted {
		color: var(--muted);
	}
</style>
