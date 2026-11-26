<script lang="ts">
	import { FLAG_NAME, type Flag } from '#lib/path.js';
	import { onMount } from 'svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import { loc, tl, tx } from '../i18n.js';
	import { priceText } from '../portfolio.js';
	import { showToast } from '../toast.svelte.js';
	import RichEditor from './RichEditor.svelte';
	import Snooze from './Snooze.svelte';
	import AlarmClock from '@lucide/svelte/icons/alarm-clock';
	import { hrefOf, journalVersion } from './screen.svelte.js';

	/**
	 * Д-29 «Сигналы» on top of the main screen: the diary's reminders that fired, and the trade discipline's signals
	 * (T-015: stop, target, review date, a model's quarter over). Each can be snoozed (Д-30); a reminder is closed with a
	 * conclusion — an entry «вывод» in its chain; a trade signal is answered with «Продал» or «Пересмотрел» in the card.
	 */
	interface Rem {
		id: number;
		title: string;
		what: string;
		snoozes: number;
		entry: { id: number; kind: string; at: string; text: string };
		link: { type: string; id: string } | null;
	}
	interface Trade {
		key: string;
		kind: 'stop' | 'target' | 'review' | 'model_end' | 'no_stop' | 'path';
		order?: boolean;
		flag?: Flag;
		stateId?: number;
		securityId: number;
		positionId: number;
		portfolio: string;
		symbol: string;
		priceUnit: string;
		price: number | null;
		stop: number | null;
		target: number | null;
		reviewDate: string | null;
		snoozes: number;
	}
	let rems = $state<Rem[]>([]);
	let trade = $state<Trade[]>([]);
	let closing = $state<number | null>(null);
	let conclusion = $state('');

	async function load() {
		const r = await fetch('/api/signals').then((x) => x.json()).catch(() => null);
		if (r) ((rems = r.reminders), (trade = r.trade));
	}
	onMount(load);
	let seen = journalVersion.n;
	$effect(() => {
		if (journalVersion.n !== seen) ((seen = journalVersion.n), load());
	});

	async function post(url: string, b: object) {
		const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).catch(() => null);
		const j = await r?.json().catch(() => ({}));
		if (!r?.ok) return showToast(tl(j?.message) || tx('Не получилось', 'It did not work')), null;
		return j;
	}
	const until = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
	async function snoozeRem(id: number, how: string) {
		const j = await post(`/api/reminders/${id}`, { action: 'snooze', how });
		if (j) (showToast(`${tx('Отложено до', 'Snoozed until')} ${until(j.until)}`), load());
	}
	/** T-033: the thesis is intact — the mark stays quiet for 90 days (or until it goes and comes back) */
	async function reviewed(id: number) {
		if (await post('/api/path', { review: id })) (showToast(tx('Пересмотрено: метка не будет напоминать 90 дней', 'Reviewed: the mark stays quiet for 90 days')), load());
	}
	async function snoozeTrade(key: string, how: string) {
		const j = await post('/api/signals/snooze', { key, how });
		if (j) (showToast(`${tx('Отложено до', 'Snoozed until')} ${until(j.until)}`), load());
	}
	async function close(id: number) {
		const j = await post(`/api/reminders/${id}`, { action: 'close', conclusion });
		if (j) ((closing = null), (conclusion = ''), journalVersion.n++, showToast(tx('Закрыто', 'Closed')));
	}
	function tradeText(s: Trade) {
		if (s.kind === 'path') return tx(`метка «${FLAG_NAME[s.flag!][0]}» — характер движения изменился`, `the mark «${FLAG_NAME[s.flag!][1]}» — the movement changed`);
		if (s.kind === 'no_stop') return tx('куплено без стопа — выставь стоп у брокера', 'bought without a stop — place one at the broker');
		if (s.kind === 'stop') return `${s.order ? tx('стоп у брокера должен был сработать', 'the stop at the broker should have worked') : tx('стоп пробит', 'stop broken')}: ${priceText(s.price, s.priceUnit)} ≤ ${priceText(s.stop, s.priceUnit)}`;
		if (s.kind === 'target') return `${tx('цель достигнута', 'target reached')}: ${priceText(s.price, s.priceUnit)} ≥ ${priceText(s.target, s.priceUnit)}`;
		if (s.kind === 'model_end') return tx('период модели закончился — правило 2: продать', 'the model\'s period is over — rule 2: sell');
		return `${tx('пора пересмотреть', 'time to review')} (${s.reviewDate ? until(s.reviewDate) : ''})`;
	}
</script>

{#if rems.length || trade.length}
	<section class="signals" aria-label={tx('Сигналы', 'Signals')}>
		<h2>{tx('Сигналы', 'Signals')} <span class="n">{rems.length + trade.length}</span><HelpIcon topicKey="reminder.signals" label={tx('сигналы', 'signals')} /></h2>
		{#each trade as s (s.key)}
			<div class="sig" class:hot={s.kind === 'stop' || s.kind === 'model_end' || s.kind === 'no_stop'}>
				{#if s.kind === 'path'}
					<a href="/security/{s.securityId}?position={s.positionId}"><b>{s.symbol}</b> {tradeText(s)} <span class="muted">· {tx('открой мозаику и лесенку, запиши вывод', 'open the mosaic and the ladder, write down the conclusion')} →</span></a>
					<div class="row">
						<Snooze snoozes={s.snoozes} onpick={(h) => snoozeTrade(s.key, h)} />
						<button class="ghost" onclick={() => reviewed(s.stateId!)}>{tx('Пересмотрел', 'Reviewed')}</button>
					</div>
				{:else}
					<a href="/position/{s.positionId}"><b>{s.symbol}</b> {tradeText(s)} <span class="muted">· {s.portfolio} · {tx('Продал или пересмотрел?', 'Sold or reviewed?')} →</span></a>
					<Snooze snoozes={s.snoozes} onpick={(h) => snoozeTrade(s.key, h)} />
				{/if}
			</div>
		{/each}
		{#each rems as r (r.id)}
			{@const h = r.link ? hrefOf(r.link.type, r.link.id) : null}
			<div class="sig rem">
				<div><AlarmClock size={15} class="ic" /> <b>{r.title}</b> <span class="muted">· {r.what}</span></div>
				<p class="muted small">{r.entry.text}{#if h}{' '}<a href={h}>{tx('открыть', 'open')} →</a>{/if}</p>
				{#if closing === r.id}
					<RichEditor bind:value={conclusion} autofocus minHeight="3em" placeholder={tx('Вывод: что решил, что увидел', 'Conclusion: what I decided, what I saw')} />
					<div class="row">
						<button class="main" onclick={() => close(r.id)}>{tx('Закрыть', 'Close')}</button>
						<button class="ghost" onclick={() => (closing = null)}>{tx('Отмена', 'Cancel')}</button>
					</div>
				{:else}
					<div class="row">
						<Snooze snoozes={r.snoozes} onpick={(how) => snoozeRem(r.id, how)} />
						<button class="ghost" onclick={() => ((closing = r.id), (conclusion = ''))}>{tx('Закрыть с выводом', 'Close with a conclusion')}</button>
					</div>
				{/if}
			</div>
		{/each}
	</section>
{/if}

<style>
	.signals {
		margin: 0 0 var(--s3);
		padding: var(--s3);
		border-radius: var(--r3);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: var(--fs-m);
	}
	.n {
		font-size: var(--fs-xs);
		padding: 0 var(--s2);
		border-radius: var(--r-pill);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.sig {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.sig.hot {
		border-left: 4px solid var(--down);
	}
	.sig.rem {
		background: var(--surface-2);
		color: var(--text);
	}
	.sig a {
		color: inherit;
		text-decoration: none;
	}
	.sig p a {
		color: var(--link);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
		align-items: center;
	}
	.main,
	.ghost {
		min-height: 32px;
		padding: 0 var(--s3);
		border-radius: var(--r-pill);
		font-size: var(--fs-s);
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
	.muted {
		opacity: 0.8;
	}
	.rem :global(.ic) {
		vertical-align: -2px;
	}
	.small {
		margin: 0;
		font-size: var(--fs-s);
	}
</style>
