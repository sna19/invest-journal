<script lang="ts" module>
	export interface Row {
		h: {
			id: number;
			securityId: number;
			symbol: string;
			securityName: string;
			exchangeCode: string;
			currency: string;
			priceUnit: string;
			signalType: string;
			direction: string;
			directionSource: string;
			thesis: string;
			confidencePct: number | null;
			invalidation: string;
			mode: string;
			horizonDate: string;
			horizonSource: string;
			targetPrice: number | null;
			amount: number | null;
			tags: string | null;
			note: string | null;
			createdAt: string;
			entryDate: string;
			entryPrice: number | null;
			benchmarkSymbol: string;
			benchmarkEntry: number | null;
			entryPriceDate: string | null;
			lastDate: string | null;
			lastPrice: number | null;
			benchmarkLast: number | null;
			currentReturnPct: number | null;
			currentBenchmarkReturnPct: number | null;
			currentExcessPct: number | null;
			exitDate: string | null;
			exitPrice: number | null;
			benchmarkExit: number | null;
			returnPct: number | null;
			benchmarkReturnPct: number | null;
			excessPct: number | null;
			outcome: string | null;
			waitReason: string | null;
			waitIssueId: number | null;
			status: string;
			lesson: string | null;
			closeReason: string | null;
		};
		sourceName: string;
		sourceKind: string;
		author: string | null;
		url: string | null;
		title: string | null;
		spark?: [number, number][] | null;
	}

	/** The result to show: final when closed, current when open. */
	export const shown = (h: Row['h']) =>
		h.status === 'open'
			? { r: h.currentReturnPct, rb: h.currentBenchmarkReturnPct, x: h.currentExcessPct, date: h.lastDate, price: h.lastPrice, bench: h.benchmarkLast }
			: { r: h.returnPct, rb: h.benchmarkReturnPct, x: h.excessPct, date: h.exitDate, price: h.exitPrice, bench: h.benchmarkExit };
	export const num = (v: number | null, d = 2) => (v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: d }));
	export const short = (d: string | null, year = false) =>
		d ? new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }) : '';

	export const SIGNAL: Record<string, string> = { recommendation: 'Рекомендация', target: 'Целевая цена', opinion: 'Мнение', news: 'Новость' };
	export const unitOf = (h: Row['h']) => (h.priceUnit === 'ILA' ? 'агорот' : h.currency);
	export const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
	export const canCancel = (h: Row['h']) => h.status === 'open' && Date.now() - Date.parse(h.createdAt) < 24 * 3600 * 1000;
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import Lock from '@lucide/svelte/icons/lock';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import HelpIcon from './HelpIcon.svelte';
	import Pct from './Pct.svelte';
	import { showToast } from './toast.svelte.js';
	import { nextPricesRun, noResultYet } from './hypothesis.js';

	/** Spec section 9 — the hypothesis card: every field, the article, the benchmark; notes and tags stay editable. */
	interface Props {
		row: Row;
		onchange: (h: Row['h']) => void;
		onclose: () => void;
	}
	let { row, onchange, onclose }: Props = $props();
	const h = $derived(row.h);

	// the fields start from the saved values; the card is opened anew for another hypothesis
	let note = $state(untrack(() => row.h.note ?? ''));
	let tags = $state(untrack(() => row.h.tags ?? ''));
	let saved = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function patch(body: Record<string, unknown>) {
		error = null;
		const r = await fetch(`/api/hypotheses/${h.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (error = j.message ?? 'Не сохранилось');
		onchange(j);
		saved = 'Сохранено';
		setTimeout(() => (saved = null), 1500);
	}

	async function post(action: 'cancel' | 'restore') {
		const r = await fetch(`/api/hypotheses/${h.id}/${action}`, { method: 'POST' });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) {
			error = j.message ?? 'Не получилось';
			return null;
		}
		onchange(j);
		return j;
	}

	let reason = $state('');
	let closing = $state(false);
	async function closeNow() {
		closing = true;
		error = null;
		const r = await fetch(`/api/hypotheses/${h.id}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
		const j = await r.json().catch(() => ({}));
		closing = false;
		if (!r.ok) return (error = j.message ?? 'Не закрылась');
		const fresh = await fetch(`/api/hypotheses/${h.id}`).then((x) => x.json());
		onchange(fresh.h);
		showToast(`${h.symbol} закрыта досрочно: превышение ${j.excessPct > 0 ? '+' : ''}${j.excessPct.toFixed(1)}%`);
	}
	let lesson = $state(untrack(() => row.h.lesson ?? ''));

	async function cancel() {
		if (!(await post('cancel'))) return;
		onclose();
		showToast(`Запись ${h.symbol} отменена`, () => void post('restore'));
	}

	const res = $derived(shown(row.h));
	const days = $derived(Math.round((Date.parse(h.horizonDate + 'T12:00:00') - Date.now()) / 86400000));
</script>

<div class="card">
	<p class="name">
		{h.securityName} · {h.exchangeCode === 'TASE' ? 'TASE' : h.exchangeCode.replace('_', ' ')} ·
		<a href="/security/{h.securityId}">график</a>
	</p>

	{#if h.entryPrice === null}
		<div class="price">
			<div>
				<span class="k">Вход</span>
				<span class="wait">ожидает цену</span>
				<span class="sub">закрытие {fmtDate(h.entryDate)} или ближайшего торгового дня</span>
			</div>
			<div>
				<span class="k">Бенчмарк</span>
				<b>{h.benchmarkSymbol === 'SPX' ? 'S&P 500' : h.benchmarkSymbol}</b>
			</div>
		</div>
	{:else}
		<div class="result">
			<div class="excess">
				<span class="k">Превышение над бенчмарком <HelpIcon topicKey="result.excess" label="превышение" /></span>
				{#if noResultYet(h)}
					<span class="first">Первый результат — {nextPricesRun().startsWith('сегодня') ? 'сегодня' : 'завтра'}</span>
					<span class="sub">цена входа — закрытие {short(h.entryPriceDate)}; следующее обновление цен — {nextPricesRun()}</span>
				{:else}
					<span class="big"><Pct value={res.x} /></span>
					{#if h.status !== 'open'}
						<span class="outcome {h.outcome}">{h.outcome === 'hit' ? 'Сработала' : 'Не сработала'}{h.status === 'closed_early' ? ' · досрочно' : ''}</span>
					{:else if res.date}
						<span class="sub">цены на {short(res.date)} · следующее обновление — {nextPricesRun()} <HelpIcon topicKey="result.prices" label="когда обновляются цены" /></span>
					{/if}
				{/if}
			</div>
			<table>
				<thead><tr><th></th><th>Вход {short(h.entryPriceDate)}</th><th>{h.status === 'open' ? 'Сейчас' : 'Выход'} {short(res.date)}</th><th>Итог</th></tr></thead>
				<tbody>
					<tr><td>{h.symbol}, {unitOf(h)}</td><td>{num(h.entryPrice)}</td><td>{num(res.price)}</td><td><Pct value={noResultYet(h) ? null : res.r} plain /></td></tr>
					<tr><td>{h.benchmarkSymbol === 'SPX' ? 'S&P 500' : h.benchmarkSymbol}</td><td>{num(h.benchmarkEntry)}</td><td>{num(res.bench)}</td><td><Pct value={noResultYet(h) ? null : res.rb} plain /></td></tr>
				</tbody>
			</table>
			<p class="sub">Доходность — с поправкой на дивиденды{h.direction === 'short' ? '; для «падения» знак обеих доходностей изменён' : ''}.</p>
		</div>
	{/if}

	{#if h.status === 'open' && h.waitReason && (h.waitIssueId || h.horizonDate < new Date().toISOString().slice(0, 10))}
		<p class="waiting" role="status">
			<b>Не закрыта:</b> {h.waitReason}{#if h.waitIssueId}{' '}<a href="/settings#issue-{h.waitIssueId}">Открыть проблему</a>{/if}
		</p>
	{/if}

	<div class="locked-head">
		<Lock size={16} /> <span>Зафиксировано при записи</span>
		<HelpIcon topicKey="result.locked" label="почему нельзя менять" />
	</div>
	<dl>
		<dt>Источник</dt>
		<dd>{row.sourceName}{#if row.author}{' · '}{row.author}{/if}</dd>
		{#if row.url}
			<dt>Статья</dt>
			<dd><a href={row.url} target="_blank" rel="noopener noreferrer">{row.title || new URL(row.url).hostname}<ExternalLink size={14} /></a></dd>
		{/if}
		<dt>Сигнал</dt>
		<dd>{SIGNAL[h.signalType]}</dd>
		<dt>Направление</dt>
		<dd>{h.direction === 'long' ? '▲ Рост' : '▼ Падение'} · {h.directionSource === 'mine' ? 'моё толкование' : 'из статьи'}</dd>
		<dt>Тезис</dt>
		<dd>{h.thesis}</dd>
		<dt>Неправ, если</dt>
		<dd>{h.invalidation}</dd>
		<dt>Срок</dt>
		<dd>
			{fmtDate(h.horizonDate)}{#if h.status === 'open'}{' · '}{days > 0 ? `через ${days} дн.` : 'сегодня'}{/if}
			<span class="sub">{h.horizonSource === 'default' ? 'по умолчанию, 3 месяца' : 'из статьи'}</span>
		</dd>
		<dt>Уверенность</dt>
		<dd>{h.confidencePct === null ? '—' : `${h.confidencePct}%`}</dd>
		<dt>Режим</dt>
		<dd>{h.mode === 'real' ? 'Реальные деньги' : 'Симуляция'}{#if h.amount}{' · '}{h.amount} {h.currency}{/if}</dd>
		{#if h.targetPrice !== null}
			<dt>Цель</dt>
			<dd>{h.targetPrice} {unitOf(h)}</dd>
		{/if}
		<dt>Записано</dt>
		<dd>{new Date(h.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</dd>
	</dl>

	{#if h.status !== 'cancelled'}
		<!-- section 18: from the idea to the portfolio, linked to this hypothesis -->
		<div class="to-portfolio">
			<a href="/portfolio?add={h.securityId}&hyp={h.id}&kind=plan_buy">Хочу купить</a>
			<a href="/portfolio?add={h.securityId}&hyp={h.id}&kind=buy">Купил</a>
		</div>
	{/if}

	<label class="lbl" for="note-{h.id}">Заметка</label>
	<textarea id="note-{h.id}" rows="3" placeholder="Что заметили по ходу" bind:value={note} onblur={() => note !== (h.note ?? '') && patch({ note })}></textarea>
	<label class="lbl" for="tags-{h.id}">Теги</label>
	<input id="tags-{h.id}" placeholder="через запятую" bind:value={tags} onblur={() => tags !== (h.tags ?? '') && patch({ tags })} />
	<p class="status">{#if error}<span class="err">{error}</span>{:else if saved}{saved}{/if}</p>

	{#if h.status === 'open'}
		<div class="buttons">
			{#if h.entryPrice !== null}
				<label class="lbl" for="reason-{h.id}">Закрыть досрочно — причина</label>
				<input id="reason-{h.id}" placeholder="Например, тезис больше не актуален" bind:value={reason} />
				<button class="ghost" disabled={!reason.trim() || closing} onclick={closeNow}>{closing ? 'Закрываю…' : 'Закрыть досрочно на последнюю цену'}</button>
			{/if}
			{#if canCancel(h)}
				<button class="danger" onclick={cancel}>Отменить запись — ошибка ввода</button>
				<p class="sub">Отменить можно в первые 24 часа после записи; потом гипотеза остаётся в статистике.</p>
			{/if}
		</div>
	{:else}
		{#if h.closeReason}<p class="sub">Причина досрочного закрытия: {h.closeReason}</p>{/if}
		<label class="lbl" for="lesson-{h.id}">Вывод</label>
		<textarea id="lesson-{h.id}" rows="3" placeholder="Что показала эта гипотеза" bind:value={lesson} onblur={() => lesson !== (h.lesson ?? '') && patch({ lesson })}></textarea>
	{/if}
</div>

<style>
	.to-portfolio {
		display: flex;
		gap: var(--s2);
		margin-bottom: var(--s3);
	}
	.to-portfolio a {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	.name {
		margin: 0 0 var(--s3);
		color: var(--muted);
	}
	.price {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s3);
		margin-bottom: var(--s4);
	}
	.price > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.wait {
		font-weight: 700;
		color: var(--warn-text);
	}
	.sub {
		display: block;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.waiting {
		margin: 0 0 var(--s3);
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: var(--fs-s);
	}
	.waiting a {
		color: inherit;
		font-weight: 600;
	}
	.locked-head {
		display: flex;
		align-items: center;
		gap: var(--s2);
		color: var(--muted);
		font-size: var(--fs-s);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--s2) var(--s3);
		margin: var(--s2) 0 var(--s4);
	}
	dt {
		color: var(--muted);
		font-size: var(--fs-s);
		padding-top: 1px;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	dd a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.lbl {
		display: block;
		margin: var(--s2) 0 var(--s1);
		font-weight: 600;
	}
	textarea,
	input {
		box-sizing: border-box;
		width: 100%;
		min-height: var(--tap);
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.status {
		min-height: 1.2em;
		margin: var(--s1) 0;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.err {
		color: var(--down);
	}
	.buttons {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.buttons button {
		min-height: var(--tap);
		border-radius: var(--r2);
		font-weight: 600;
		cursor: pointer;
	}
	.ghost {
		border: 1px solid var(--line);
		background: var(--surface);
	}
	.ghost:disabled {
		color: var(--muted);
	}
	.result {
		margin-bottom: var(--s4);
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.excess {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: var(--s2);
	}
	.big {
		font-size: var(--fs-xl);
		font-weight: 700;
	}
	.first {
		font-size: var(--fs-l);
		font-weight: 600;
	}
	.outcome {
		font-weight: 600;
	}
	.outcome.hit {
		color: var(--up);
	}
	.outcome.miss {
		color: var(--down);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-s);
		font-variant-numeric: tabular-nums;
	}
	th {
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--muted);
		text-align: right;
		padding: 4px 0 4px var(--s2);
	}
	td {
		text-align: right;
		padding: 4px 0 4px var(--s2);
		border-top: 1px solid var(--line);
	}
	th:first-child,
	td:first-child {
		text-align: left;
		padding-left: 0;
	}
	.danger {
		border: 1px solid var(--down);
		background: none;
		color: var(--down);
	}
</style>
