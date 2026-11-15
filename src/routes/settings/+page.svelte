<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TopBar from '#lib/TopBar.svelte';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { showToast } from '#lib/toast.svelte.js';

	/** Spec sections 9 and 14 — Settings: benchmarks, thresholds and the «Данные» block. */
	interface Job {
		job: string;
		startedAt: string;
		finishedAt: string | null;
		status: string;
		received: number;
		added: number;
		updated: number;
		error: string | null;
	}
	interface Data {
		ring: number;
		jobs: Job[];
		securities: number;
		ringSize: number;
		withPrices: number;
		priceRows: number;
		queue: { queued: number; failed: number };
		issues: { open: number; recent: { id: number; rule: string; detail: string | null; date: string | null; symbol: string | null; exchange: string | null }[] };
		noData: { id: number; symbol: string; exchange: string; lastDate: string | null; why: string }[];
		late: boolean;
		running: string[];
	}

	let data = $state<Data | null>(null);
	let problem = $state<string | undefined>();
	let poll: ReturnType<typeof setInterval> | undefined;

	async function load() {
		try {
			data = await fetch('/api/data').then((r) => {
				if (!r.ok) throw new Error();
				return r.json();
			});
			problem = undefined;
			if (!data!.running.length) {
				clearInterval(poll);
				poll = undefined;
			}
		} catch {
			problem = 'Нет связи с сервером.';
		}
	}
	async function run(job: string) {
		await fetch('/api/data/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job }) });
		if (data) data.running = [...data.running, job];
		clearInterval(poll);
		poll = setInterval(load, 3000);
	}
	onMount(async () => {
		await load();
		// a hypothesis card links here: #issue-<id>
		const hash = page.url.hash;
		if (hash.startsWith('#issue-')) {
			await tick();
			document.querySelector(hash)?.scrollIntoView({ block: 'center' });
		}
	});

	let deciding = $state<number | null>(null);
	/** stage 4: a person decides about a jump; a hypothesis waiting for it closes right away */
	async function decide(id: number, decision: 'valid' | 'invalid') {
		deciding = id;
		const r = await fetch(`/api/data/issues/${id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ decision })
		});
		const j = await r.json().catch(() => ({}));
		deciding = null;
		if (!r.ok) return showToast(j.message ?? 'Не получилось');
		showToast(
			(decision === 'valid' ? 'Цена принята' : 'День исключён из расчёта') + (j.closed ? ` · закрыто гипотез: ${j.closed}` : '')
		);
		load();
	}
	onDestroy(() => clearInterval(poll));

	const fmt = new Intl.NumberFormat('ru-RU');
	const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
	const JOB: Record<string, string> = {
		prices: 'Дневные цены',
		history: 'Историческая загрузка',
		hypotheses: 'Гипотезы: вход, результат, закрытие',
		listings: 'Списки бумаг',
		gaps: 'Контроль пропусков',
		'backup-app': 'Копия журнала (app.db)',
		'backup-market': 'Копия рыночных данных (market.db)'
	};
	const STATUS: Record<string, string> = { ok: 'ок', suspicious: 'подозрительно', error: 'ошибка', running: 'идёт' };
	const RULE: Record<string, string> = {
		'price.jump': 'скачок больше 50% без корпоративного действия, ждёт проверки',
		'price.unit_glitch': 'агороты и шекели перепутаны',
		'price.unit_mismatch': 'единица цены не совпадает',
		'price.ohlc': 'цены дня не сходятся',
		'price.not_trading_day': 'не торговый день',
		'price.not_positive': 'цена не больше нуля',
		'price.volume': 'отрицательный объём'
	};
</script>

<svelte:head><title>Настройки · Журнал гипотез</title></svelte:head>

<TopBar title="Настройки" back={{ href: '/more', label: 'Ещё' }} />

<section class="card">
	<h2>Бенчмарки и пороги</h2>
	<dl>
		<dt>Бумаги США</dt>
		<dd>S&P 500</dd>
		<dt>Бумаги TASE</dt>
		<dd>ТА-125</dd>
		<dt>Оценка источника</dt>
		<dd>от 10 закрытых гипотез — «предварительно», от 30 — без пометки</dd>
	</dl>
</section>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

<section class="card">
	<div class="head">
		<h2>Данные</h2>
		<button class="btn" onclick={() => run('prices')} disabled={data?.running.includes('prices')}>
			<span class:spin={data?.running.includes('prices')}><RefreshCw size={16} /></span>{data?.running.includes('prices') ? 'Обновляется…' : 'Обновить сейчас'}
		</button>
	</div>
	{#if !data}
		<div class="skeleton"></div>
	{:else}
		{#if data.late}<p class="warn">Дневное задание не отработало больше двух дней.</p>{/if}
		<div class="nums">
			<div><b>{fmt.format(data.ringSize)}</b><span>бумаг грузятся (круг {data.ring})</span></div>
			<div><b>{fmt.format(data.priceRows)}</b><span>строк цен</span></div>
			<div><b>{fmt.format(data.queue.queued)}</b><span>в очереди истории{data.queue.failed ? `, ${data.queue.failed} не удалось` : ''}</span></div>
			<div><b>{fmt.format(data.issues.open)}</b><span>проблем качества</span></div>
		</div>

		<h3>Последние запуски</h3>
		<ul class="runs">
			{#each data.jobs as j (j.job)}
				<li>
					<span class="name">{JOB[j.job] ?? j.job}</span>
					<span class="status {j.status}">{STATUS[j.status] ?? j.status}</span>
					<span class="muted">{when(j.finishedAt ?? j.startedAt)}{j.received || j.added ? ` · получено ${fmt.format(j.received)}, новых ${fmt.format(j.added)}` : ''}</span>
					{#if j.error}<span class="err">{j.error}</span>{/if}
				</li>
			{/each}
		</ul>

		<h3>Нет данных</h3>
		{#if data.noData.length}
			<ul class="plain">
				{#each data.noData as n (n.id)}
					<li><b>{n.symbol}</b> · {n.exchange} — {n.why}{n.lastDate ? `, последняя цена ${n.lastDate}` : ''}</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Все бумаги с ценами.</p>
		{/if}

		{#if data.issues.recent.length}
			<h3>Проблемы качества</h3>
			<p class="muted small-top">
				Скачок больше 50% за день без корпоративного действия не входит в расчёт, пока вы не решите: «Цена верна» — день
				возвращается в расчёт; «Цена ошибочна» — исключается навсегда. Сверить цену можно на сайте биржи.
			</p>
			<ul class="issues">
				{#each data.issues.recent as q (q.id)}
					<li id="issue-{q.id}">
						<div>
							<b>{q.symbol ?? '—'}</b>{q.date ? ` ${q.date.split('-').reverse().join('.')}` : ''} — {RULE[q.rule] ?? q.rule}{q.detail
								? `: ${q.detail}`
								: ''}
						</div>
						{#if q.rule === 'price.jump'}
							<div class="decide">
								<button disabled={deciding === q.id} onclick={() => decide(q.id, 'valid')}>Цена верна</button>
								<button disabled={deciding === q.id} onclick={() => decide(q.id, 'invalid')}>Цена ошибочна</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<p class="muted small">
			Цены обновляются каждое утро в 07:15 по Израилю, пропущенные дни догружаются; списки бумаг — по воскресеньям; пропуски проверяются по
			субботам. Копия журнала — каждую ночь (30 копий), рыночных данных — по воскресеньям (2 копии).
		</p>
	{/if}
</section>

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
	h2 {
		margin: 0 0 var(--s2);
		font-size: var(--fs-l);
	}
	h3 {
		margin: var(--s4) 0 var(--s2);
		font-size: var(--fs-m);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--s2) var(--s4);
		margin: 0;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--s2);
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		cursor: pointer;
	}
	.spin {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.nums {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s3);
		margin-top: var(--s2);
	}
	.nums div {
		display: flex;
		flex-direction: column;
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--bg);
	}
	.nums b {
		font-size: var(--fs-l);
		font-variant-numeric: tabular-nums;
	}
	.nums span,
	.muted {
		color: var(--muted);
		font-size: var(--fs-s);
	}
	.small {
		font-size: var(--fs-xs);
		margin-top: var(--s4);
	}
	.runs,
	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.runs li {
		display: flex;
		flex-wrap: wrap;
		gap: 2px var(--s2);
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.runs .muted {
		flex-basis: 100%;
	}
	.name {
		font-weight: 600;
	}
	.status {
		font-size: var(--fs-s);
	}
	.status.ok {
		color: var(--up);
	}
	.status.error,
	.status.suspicious,
	.err {
		color: var(--down);
		font-size: var(--fs-s);
		overflow-wrap: anywhere;
	}
	.small-top {
		margin: 0 0 var(--s2);
	}
	.issues {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.issues li {
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
		font-size: var(--fs-s);
	}
	.issues li:target {
		background: var(--warn-bg);
		border-radius: var(--r1);
		padding: var(--s2);
	}
	.decide {
		display: flex;
		gap: var(--s2);
		margin-top: var(--s2);
	}
	.decide button {
		flex: 1;
		min-height: var(--tap);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		cursor: pointer;
	}
	.plain li {
		padding: 4px 0;
		font-size: var(--fs-s);
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 160px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
</style>
