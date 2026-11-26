<script lang="ts" module>
	export interface Moment {
		symbol?: string;
		name?: string;
		unit?: string;
		price?: number | null;
		priceDate?: string | null;
		dayPct?: number | null;
		monthPct?: number | null;
		vsBenchMonth?: number | null;
		benchPrice?: number | null;
		weights?: { portfolio: string; pct: number | null }[] | null;
		currency?: string;
		value?: number | null;
		twrPct?: number | null;
	}
	export interface EntryData {
		id: number;
		createdAt: string;
		updatedAt: string;
		kind: string;
		body: string;
		html: string;
		status: string;
		via: string | null;
		links: { type: string; id: string; label: string }[];
		tags: { id: number; name: string; color: string; system: number }[];
		context: { type: string; id: string; restored: boolean; then: Moment; now: Moment | null }[];
		revisions: number;
		assessment?: string | null;
		snapshots: (SnapshotDraft & { id: number; photo: string | null; createdAt: string })[];
		reminders: { id: number; title: string; what: string; state: string; nextDue: string | null; snoozes: number }[];
		decision: { id: number; type: string; basis: string; expectation: string | null; reviewDate: string | null; outcome: string | null; noReason: number; cancelledAt: string | null; canCancel: boolean } | null;
		answers: EntryData[];
	}
</script>

<script lang="ts">
	import Self from './Entry.svelte';
	import RichEditor from './RichEditor.svelte';
	import ReminderForm from './ReminderForm.svelte';
	import Snapshot from './Snapshot.svelte';
	import type { SnapshotDraft } from './screen.svelte.js';
	import AlarmClock from '@lucide/svelte/icons/alarm-clock';
	import HelpIcon from '../HelpIcon.svelte';
	import { loc, tl, tx } from '../i18n.js';
	import { priceText, money } from '../portfolio.js';
	import { showToast } from '../toast.svelte.js';
	import { hrefOf, journalVersion, kindText, openComposer } from './screen.svelte.js';

	/**
	 * One entry of a feed: its kind, time, links and tags, the text, «тогда → сейчас» for each linked security and
	 * portfolio (Д-05), its answers folded (Д-06), an edit as a new revision with the history (Д-33), the archive (Д-35).
	 */
	let { e, onchange }: { e: EntryData; onchange: () => void } = $props();
	let editing = $state(false);
	let text = $state('');
	let showRevs = $state(false);
	let revs = $state<{ id: number; html: string; createdAt: string }[]>([]);
	let showAnswers = $state(false);
	let showCtx = $state(false);
	let deleting = $state(false);
	let reminding = $state(false);
	let remHist = $state<{ id: number; items: { kind: string; at: string; note: string | null }[] } | null>(null);
	async function showRemHist(id: number) {
		if (remHist?.id === id) return (remHist = null);
		remHist = { id, items: (await fetch(`/api/reminders/${id}`).then((r) => r.json())).items };
	}
	const REM_STATE: Record<string, [string, string]> = { waiting: ['ждёт', 'waiting'], fired: ['сработало', 'fired'], snoozed: ['отложено', 'snoozed'], closed: ['закрыто', 'closed'] };
	const REM_EVENT: Record<string, [string, string]> = { created: ['поставлено', 'set'], fired: ['сработало', 'fired'], snoozed: ['отложено до', 'snoozed until'], closed: ['закрыто', 'closed'] };
	let word = $state('');

	const time = (s: string) => new Date(s).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
	const day = (s: string) => new Date(s.length > 10 ? s : s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
	const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`);
	const since = (a: number | null | undefined, b: number | null | undefined) => (a && b ? ((b / a - 1) * 100) : null);

	async function call(method: string, url: string, b: object) {
		const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).catch(() => null);
		const j = await r?.json().catch(() => ({}));
		if (!r?.ok) {
			showToast(tl(j?.message) || tx('Не получилось', 'It did not work'));
			return false;
		}
		return true;
	}
	async function saveEdit() {
		if (await call('PATCH', `/api/journal/${e.id}`, { body: text, format: 'html' })) {
			editing = false;
			onchange();
		}
	}
	async function loadRevs() {
		showRevs = !showRevs;
		if (showRevs) revs = (await fetch(`/api/journal/${e.id}/revisions`).then((r) => r.json())).items;
	}
	async function archive(on: boolean) {
		if (await call('POST', `/api/journal/${e.id}`, { action: on ? 'archive' : 'restore' })) (showToast(on ? tx('В архиве', 'Archived') : tx('Возвращено', 'Restored')), onchange());
	}
	const TYPE: Record<string, [string, string]> = { buy: ['купить', 'buy'], add: ['докупить', 'add'], sell: ['продать', 'sell'], trim: ['сократить', 'trim'], hold: ['держать', 'hold'], skip: ['не покупать', 'not buying'], defer: ['отложить', 'defer'] };
	const BASIS: Record<string, [string, string]> = { intuition: ['интуиция', 'intuition'], hypothesis: ['гипотеза', 'hypothesis'], model: ['модель', 'model'], consensus: ['консенсус', 'consensus'], mixed: ['смешанное', 'mixed'] };
	const OUT: Record<string, [string, string]> = { yes: ['да', 'yes'], partly: ['частично', 'partly'], no: ['нет', 'no'], early: ['рано судить', 'too early'] };
	async function cancelDecision() {
		if (await call('POST', `/api/decisions/${e.decision!.id}/cancel`, {})) (showToast(tx('Решение отменено', 'Decision cancelled')), onchange());
	}
	async function remove() {
		if (await call('DELETE', `/api/journal/${e.id}`, { word })) (showToast(tx('Удалено навсегда', 'Deleted for good')), journalVersion.n++, onchange());
	}
</script>

<article class="entry" class:archived={e.status === 'archived'}>
	<header>
		<span class="kind k-{e.kind}">{kindText(e.kind)}</span>
		<span class="muted small">{time(e.createdAt)}</span>
		{#if e.assessment}<span class="assess a-{e.assessment}">{e.assessment === 'strengthening' ? tx('тезис усиливается', 'thesis strengthening') : e.assessment === 'weakening' ? tx('тезис ослабевает', 'thesis weakening') : tx('без изменений', 'unchanged')}</span>{/if}
		{#if e.via}<span class="via">{tx('через', 'via')} {e.via}</span>{/if}
		{#if e.revisions > 1}<button class="lnk small" onclick={loadRevs}>{tx('правок', 'edits')}: {e.revisions - 1}</button>{/if}
	</header>
	{#if e.decision}
		{@const dd = e.decision}
		<p class="dec" class:off={!!dd.cancelledAt}>
			<b>{tx(...(TYPE[dd.type] ?? [dd.type, dd.type]))}</b> · {tx('основание', 'basis')}: {tx(...(BASIS[dd.basis] ?? [dd.basis, dd.basis]))}{#if dd.expectation} · {dd.expectation}{/if}{#if dd.reviewDate} · {tx('пересмотр', 'review')} {day(dd.reviewDate)}{/if}{#if dd.outcome} · {tx('сбылось', 'came true')}: <b>{tx(...OUT[dd.outcome])}</b>{/if}
			{#if dd.noReason}<span class="flag">{tx('без обоснования', 'no reason')}</span>{/if}
			{#if dd.cancelledAt}<span class="flag">{tx('отменено', 'cancelled')}</span>{:else if dd.canCancel}<button class="lnk small" onclick={cancelDecision}>{tx('отменить решение', 'cancel the decision')}</button>{/if}
		</p>
	{/if}
	{#if editing}
		<RichEditor bind:value={text} autofocus minHeight="6em" />
		<div class="row">
			<button class="main" onclick={saveEdit}>{tx('Сохранить правку', 'Save the edit')}</button>
			<button class="ghost" onclick={() => (editing = false)}>{tx('Отмена', 'Cancel')}</button>
		</div>
	{:else}
		<div class="body">{@html e.html}</div>
	{/if}
	{#each e.snapshots ?? [] as s (s.id)}<Snapshot {s} at={s.createdAt} />{/each}
	{#if showRevs}
		<ol class="revs">
			{#each revs as r, i (r.id)}<li><span class="muted small">{i === 0 ? tx('исходный', 'original') : `${tx('правка', 'edit')} ${i}`} · {day(r.createdAt)} {time(r.createdAt)}</span><div class="body">{@html r.html}</div></li>{/each}
		</ol>
	{/if}

	{#if e.links.length || e.tags.length}
		<div class="chips">
			{#each e.links.filter((l) => l.type !== 'event') as l (l.type + l.id)}
				{@const h = hrefOf(l.type, l.id)}
				{#if h}<a class="link" href={h}>{l.label}</a>{:else}<span class="link">{l.label}</span>{/if}
			{/each}
			{#each e.tags.filter((t) => !t.system) as t (t.id)}<span class="tag" style="--c: {t.color}">#{t.name}</span>{/each}
		</div>
	{/if}

	{#if e.context.length}
		<button class="lnk small ctxbtn" onclick={() => (showCtx = !showCtx)}>{showCtx ? '▾' : '▸'} {tx('тогда → сейчас', 'then → now')}</button>
		{#if showCtx}
			<div class="ctx">
				{#each e.context as c (c.type + c.id)}
					{#if c.type === 'security'}
						{@const ch = since(c.then.price, c.now?.price)}
						<div class="crow">
							<b>{c.then.symbol}</b>
							<span>{priceText(c.then.price ?? null, c.then.unit ?? 'USD')} <span class="muted small">{c.then.priceDate ? day(c.then.priceDate) : ''}</span> → {priceText(c.now?.price ?? null, c.then.unit ?? 'USD')}</span>
							<b class:up={(ch ?? 0) > 0} class:down={(ch ?? 0) < 0}>{pct(ch)}</b>
							<span class="muted small">
								{tx('тогда', 'then')}: {tx('день', 'day')} {pct(c.then.dayPct)} · {tx('месяц', 'month')} {pct(c.then.monthPct)} · {tx('к рынку за месяц', 'vs market, month')} {pct(c.then.vsBenchMonth)}{#if c.then.weights?.length} · {c.then.weights.map((w) => `${w.portfolio} ${w.pct ?? '—'}%`).join(', ')}{/if}{#if c.restored} · {tx('восстановлено по ценам той даты', 'restored from the prices of that date')}{/if}
							</span>
						</div>
					{:else if c.type === 'portfolio'}
						<div class="crow">
							<b>{c.then.name}</b>
							{#if c.then.value !== undefined}
								<span>{money(c.then.value ?? 0, c.then.currency ?? 'USD')} → {money(c.now?.value ?? 0, c.then.currency ?? 'USD')}</span>
								<b>{pct(since(c.then.value, c.now?.value))}</b>
								<span class="muted small">{tx('тогда с начала', 'then since start')} {pct(c.then.twrPct)} · {tx('сейчас', 'now')} {pct(c.now?.twrPct)}{tx(' (с учётом взносов — смотри доходность)', ' (deposits move the value — see the return)')}</span>
							{:else}
								<span class="muted small">{tx('восстановлено: цифры портфеля на ту дату не сохранились', 'restored: the portfolio\'s numbers of that date were not kept')}</span>
							{/if}
						</div>
					{/if}
				{/each}
				<HelpIcon topicKey="journal.context" label={tx('тогда → сейчас', 'then → now')} />
			</div>
		{/if}
	{/if}

	{#if e.reminders?.length}
		<ul class="rems">
			{#each e.reminders as r (r.id)}
				<li class:done={r.state === 'closed'}>
					<AlarmClock size={14} class="ic" /> {r.title} <span class="muted small">· {r.what} · {tx(...REM_STATE[r.state])}{#if r.state === 'snoozed' && r.nextDue}{' '}{tx('до', 'until')} {day(r.nextDue)}{/if}{#if r.snoozes}{' · '}{tx(`отложено ${r.snoozes} раз`, `snoozed ${r.snoozes}×`)}{/if}</span>
					<button class="lnk small" onclick={() => showRemHist(r.id)}>{tx('история', 'history')}</button>
					{#if remHist?.id === r.id}
						<ol class="remh">{#each remHist.items as h, i (i)}<li>{day(h.at)} — {tx(...(REM_EVENT[h.kind] ?? [h.kind, h.kind]))}{#if h.note} {h.kind === 'snoozed' ? day(h.note) : h.note}{/if}</li>{/each}</ol>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if reminding}<ReminderForm entryId={e.id} links={e.links} onclose={() => ((reminding = false), onchange())} />{/if}
	<footer>
		{#if e.status === 'archived'}
			<button class="lnk small" onclick={() => archive(false)}>{tx('Вернуть из архива', 'Restore')}</button>
			<button class="lnk small danger" onclick={() => (deleting = !deleting)}>{tx('Удалить навсегда', 'Delete for good')}</button>
		{:else}
			<button class="lnk small" onclick={() => openComposer({ parentId: e.id, links: e.links.filter((l) => l.type !== 'event'), kind: 'observation' })}>{tx('Ответить', 'Reply')}</button>
			<button class="lnk small" onclick={() => ((text = e.html), (editing = true))}>{tx('Править', 'Edit')}</button>
			<button class="lnk small" onclick={() => (reminding = true)}>{tx('Напомнить', 'Remind')}</button>
			{#if !e.links.some((l) => l.type === 'hypothesis')}<a class="lnk small" href="/new?entry={e.id}">→ {tx('Гипотеза', 'Hypothesis')}</a>{/if}
			<button class="lnk small" onclick={() => archive(true)}>{tx('В архив', 'Archive')}</button>
		{/if}
		{#if e.answers.length}<button class="lnk small" onclick={() => (showAnswers = !showAnswers)}>{showAnswers ? '▾' : '▸'} {tx('ответов', 'replies')}: {e.answers.length}</button>{/if}
	</footer>
	{#if deleting}
		<div class="del">
			<p class="small">{tx('Запись, её ревизии, связи и контекст исчезнут. Перед удалением приложение сохранит копию журнала. Наберите УДАЛИТЬ:', 'The entry, its revisions, links and moment will be gone. A copy of the journal is saved first. Type УДАЛИТЬ:')}</p>
			<input bind:value={word} />
			<button class="danger-btn" disabled={word.trim().toUpperCase() !== 'УДАЛИТЬ'} onclick={remove}>{tx('Удалить', 'Delete')}</button>
		</div>
	{/if}
	{#if showAnswers}
		<div class="answers">
			{#each e.answers as a (a.id)}<Self e={a} {onchange} />{/each}
		</div>
	{/if}
</article>

<style>
	.entry {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.entry.archived {
		opacity: 0.7;
	}
	header,
	footer,
	.chips,
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s2);
	}
	.kind {
		font-size: var(--fs-xs);
		font-weight: 600;
		padding: 1px var(--s2);
		border-radius: var(--r-pill);
		background: var(--surface-2);
	}
	.k-observation {
		background: color-mix(in srgb, #0e9488 15%, var(--surface));
	}
	.k-decision {
		background: color-mix(in srgb, #1d4ed8 15%, var(--surface));
	}
	.k-conclusion {
		background: color-mix(in srgb, #b45309 18%, var(--surface));
	}
	.dec {
		margin: 0;
		font-size: var(--fs-s);
		padding: var(--s1) var(--s2);
		border-radius: var(--r1);
		background: color-mix(in srgb, #1d4ed8 10%, var(--surface));
		line-height: 1.5;
	}
	.dec .flag,
	.dec .lnk {
		margin-left: 4px;
	}
	.dec.off {
		opacity: 0.6;
		text-decoration: line-through;
	}
	.flag {
		font-size: var(--fs-xs);
		padding: 0 var(--s2);
		border-radius: var(--r-pill);
		background: var(--down);
		color: #fff;
		text-decoration: none;
	}
	.rems {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: var(--fs-s);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.rems :global(.ic) {
		vertical-align: -2px;
	}
	.rems li.done {
		opacity: 0.6;
	}
	.remh {
		margin: 2px 0 0;
		padding-left: 1.4em;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.assess {
		font-size: var(--fs-xs);
		padding: 0 var(--s2);
		border-radius: var(--r-pill);
		background: var(--surface-2);
	}
	.a-strengthening {
		color: var(--up);
	}
	.a-weakening {
		color: var(--down);
	}
	.via {
		font-size: var(--fs-xs);
		color: var(--muted);
		font-style: italic;
	}
	/* a highlight stays readable in the dark theme */
	.body :global(span[style*='background-color']) {
		color: #1a1a1a;
		border-radius: 3px;
		padding: 0 2px;
	}
	.body :global(blockquote) {
		margin: 0 0 var(--s1);
		padding-left: var(--s2);
		border-left: 3px solid var(--line);
	}
	.body :global(p) {
		margin: 0 0 var(--s1);
	}
	.body :global(ul),
	.body :global(ol) {
		margin: 0 0 var(--s1);
		padding-left: 1.2em;
	}
	.link {
		font-size: var(--fs-s);
		padding: 0 var(--s2);
		border-radius: var(--r-pill);
		background: var(--surface-2);
		color: var(--text);
		text-decoration: none;
	}
	.tag {
		font-size: var(--fs-s);
		color: var(--c);
	}
	.lnk {
		border: none;
		background: none;
		padding: 0;
		color: var(--link);
		cursor: pointer;
		min-height: 28px;
		text-decoration: none;
	}
	.lnk.danger {
		color: var(--down);
	}
	.ctxbtn {
		align-self: flex-start;
	}
	.ctx {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		padding: var(--s2);
		border-radius: var(--r1);
		background: var(--surface-2);
	}
	.crow {
		display: flex;
		flex-wrap: wrap;
		gap: 4px var(--s2);
		align-items: baseline;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.del input {
		box-sizing: border-box;
		width: 100%;
		padding: var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.main,
	.ghost,
	.danger-btn {
		min-height: 36px;
		padding: 0 var(--s3);
		border-radius: var(--r2);
		cursor: pointer;
	}
	.main {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
	}
	.ghost {
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--text);
	}
	.danger-btn {
		border: none;
		background: var(--down);
		color: #fff;
	}
	.danger-btn:disabled {
		opacity: 0.4;
	}
	.del {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.revs {
		margin: 0;
		padding-left: 1.2em;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.answers {
		padding-left: var(--s3);
		border-left: 2px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
		margin: 0;
	}
</style>
