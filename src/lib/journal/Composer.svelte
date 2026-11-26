<script lang="ts">
	import { onMount } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import Sheet from '../Sheet.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import TickerSearch, { type Security } from '../TickerSearch.svelte';
	import { tl, tx } from '../i18n.js';
	import { showToast } from '../toast.svelte.js';
	import { composer, journalVersion, KIND_LABEL, type ScreenLink } from './screen.svelte.js';
	import RichEditor from './RichEditor.svelte';

	/**
	 * Д-11: a new entry, linked to the screen it was opened from (the links can be removed and added); the kind, the
	 * text, personal tags. The draft is kept on this device per place until saved — leaving the screen loses nothing.
	 */
	let links = $state<ScreenLink[]>([]);
	let kind = $state('note');
	let body = $state('');
	let tags = $state<string[]>([]);
	let tagInput = $state('');
	let known = $state<string[]>([]);
	let portfolios = $state<{ id: number; name: string }[]>([]);
	let adding = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);

	const draftKey = () => `journal-draft:${composer.parentId ? `reply-${composer.parentId}` : composer.links.map((l) => `${l.type}-${l.id}`).join(',') || 'general'}`;
	onMount(async () => {
		links = [...composer.links];
		kind = composer.kind ?? 'note';
		try {
			const d = JSON.parse(localStorage.getItem(draftKey()) ?? 'null');
			if (d) ({ body, tags, kind } = { body: d.body ?? '', tags: d.tags ?? [], kind: d.kind ?? kind });
		} catch {
			/* private mode */
		}
		const [t, p] = await Promise.all([
			fetch('/api/journal/tags').then((r) => r.json()).catch(() => ({ items: [] })),
			fetch('/api/portfolios').then((r) => r.json()).catch(() => [])
		]);
		known = (t.items as { name: string; system: number }[]).filter((x) => !x.system).map((x) => x.name);
		portfolios = (Array.isArray(p) ? p : (p.items ?? [])).map((x: { id: number; name: string }) => ({ id: x.id, name: x.name }));
	});
	$effect(() => {
		const d = { body, tags, kind };
		try {
			if (body.trim() || tags.length) localStorage.setItem(draftKey(), JSON.stringify(d));
		} catch {
			/* private mode */
		}
	});

	function addTag(v = tagInput) {
		const t = v.trim().replace(/^#/, '');
		if (t && !tags.includes(t)) tags = [...tags, t];
		tagInput = '';
	}
	function addSecurity(s: Security) {
		if (!links.some((l) => l.type === 'security' && l.id === String(s.id))) links = [...links, { type: 'security', id: String(s.id), label: s.symbol }];
		adding = false;
	}
	function addPortfolio(id: number) {
		const p = portfolios.find((x) => x.id === id);
		if (p && !links.some((l) => l.type === 'portfolio' && l.id === String(id))) links = [...links, { type: 'portfolio', id: String(id), label: p.name }];
	}
	async function save() {
		if (tagInput.trim()) addTag();
		saving = true;
		error = null;
		const r = await fetch('/api/journal', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, body, format: 'html', tags, parentId: composer.parentId, links: links.map((l, i) => ({ type: l.type, id: l.id, primary: i === 0 })) })
		}).catch(() => null);
		saving = false;
		const j = await r?.json().catch(() => ({}));
		if (!r?.ok) return (error = tl(j?.message) || tx('Не сохранилось', 'Not saved'));
		try {
			localStorage.removeItem(draftKey());
		} catch {
			/* private mode */
		}
		journalVersion.n++;
		showToast(tx('Записано в дневник', 'Saved to the diary'));
		composer.open = false;
	}
</script>

<Sheet title={composer.parentId ? tx('Ответ', 'Reply') : tx('Запись в дневник', 'Diary entry')} onclose={() => (composer.open = false)}>
	<div class="form">
		<div class="seg" role="radiogroup" aria-label={tx('Тип записи', 'Kind of entry')}>
			{#each Object.entries(KIND_LABEL) as [k, l] (k)}
				<button type="button" role="radio" aria-checked={kind === k} class:on={kind === k} onclick={() => (kind = k)}>{tx(...l)}</button>
			{/each}
			<HelpIcon topicKey="journal.entry" label={tx('запись', 'entry')} />
		</div>
		<RichEditor bind:value={body} autofocus placeholder={tx('Что думаю — в момент, а не задним числом. Выдели слова — и сделай жирными, покрась или подсвети', 'What I think — now, not in hindsight. Select words to make them bold, paint or highlight them')} />

		<div class="links">
			<span class="lbl">{tx('О чём', 'About')} <HelpIcon topicKey="journal.inherit" label={tx('связи и наследование', 'links and inheritance')} /></span>
			{#each links as l, i (l.type + l.id)}
				<span class="link">{l.label}<button type="button" aria-label={tx('Убрать', 'Remove')} onclick={() => (links = links.filter((_, j) => j !== i))}><X size={14} /></button></span>
			{/each}
			<button type="button" class="add" onclick={() => (adding = !adding)}>+ {tx('бумага', 'security')}</button>
			{#if portfolios.length}
				<select aria-label={tx('Добавить портфель', 'Add a portfolio')} onchange={(e) => (addPortfolio(Number((e.target as HTMLSelectElement).value)), ((e.target as HTMLSelectElement).value = ''))}>
					<option value="">+ {tx('портфель', 'portfolio')}</option>
					{#each portfolios as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			{/if}
		</div>
		{#if adding}<TickerSearch onselect={addSecurity} label={tx('Бумага', 'Security')} autofocus />{/if}

		<div class="tags">
			<span class="lbl">{tx('Мои теги', 'My tags')} <HelpIcon topicKey="journal.tags" label={tx('теги', 'tags')} /></span>
			{#each tags as t (t)}<span class="link">#{t}<button type="button" aria-label={tx('Убрать', 'Remove')} onclick={() => (tags = tags.filter((x) => x !== t))}><X size={14} /></button></span>{/each}
			<input list="journal-tags" bind:value={tagInput} placeholder={tx('новый тег', 'new tag')} onkeydown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), addTag())} onchange={() => addTag()} />
			<datalist id="journal-tags">{#each known as t (t)}<option value={t}></option>{/each}</datalist>
		</div>
		<p class="muted small">{tx('Цены и цифры связанных бумаг и портфелей на этот момент сохранятся в записи и не изменятся.', 'The prices and numbers of the linked securities and portfolios at this moment are kept in the entry and never change.')}</p>

		{#if error}<p class="err">{error}</p>{/if}
		<div class="btns">
			<button class="primary" disabled={saving || !body.replace(/<[^>]*>|&nbsp;/g, '').trim()} onclick={save}>{saving ? tx('Сохраняю…', 'Saving…') : tx('Записать', 'Save')}</button>
			{#if !composer.parentId}<a class="ghost" href="/new" onclick={() => (composer.open = false)}>{tx('Новая гипотеза', 'New hypothesis')} →</a>{/if}
		</div>
	</div>
</Sheet>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s1);
		align-items: center;
	}
	.seg button {
		min-height: 34px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg button.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	input,
	select {
		box-sizing: border-box;
		min-height: var(--tap);
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.links,
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.lbl {
		display: inline-flex;
		align-items: center;
		font-size: var(--fs-s);
		color: var(--muted);
		width: 100%;
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px 4px 2px 10px;
		border-radius: var(--r-pill);
		background: var(--surface-2);
		font-size: var(--fs-s);
	}
	.link button {
		display: flex;
		border: none;
		background: none;
		color: var(--muted);
		min-width: 28px;
		min-height: 28px;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.add {
		min-height: 32px;
		border: 1px dashed var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--link);
		padding: 0 var(--s3);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.tags input,
	.links select {
		min-height: 32px;
		padding: 0 var(--s2);
		font-size: var(--fs-s);
	}
	.tags input {
		flex: 1;
		min-width: 120px;
	}
	.btns {
		display: flex;
		gap: var(--s2);
		align-items: center;
	}
	.primary {
		flex: 1;
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
	.ghost {
		font-size: var(--fs-s);
		color: var(--link);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
		margin: 0;
	}
	.err {
		color: var(--down);
		margin: 0;
	}
</style>
