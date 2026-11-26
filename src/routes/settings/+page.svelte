<script lang="ts">
	import Fold from '#lib/Fold.svelte';
	import PushSettings from '#lib/PushSettings.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { loc, tl, tx } from '#lib/i18n.js';
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
		monthly?: { loaded: number; total: number };
		schedule: Schedule;
		next: { prices: string; quotes: string | null; open: { tase: boolean; us: boolean } };
	}
	interface Schedule {
		quotesEvery: number;
		quotesMarketHours: boolean;
		pricesAt: string;
	}

	/** owner 19.11.2026: how often the data are refreshed */
	let saving = $state(false);
	async function setSchedule(patch: Partial<Schedule>) {
		saving = true;
		const r = await fetch('/api/data/schedule', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
		const j = await r.json().catch(() => ({}));
		saving = false;
		if (!r.ok) return showToast(tl(j.message) || tx('Не сохранилось', 'Not saved'));
		showToast(tx('Расписание сохранено', 'Schedule saved'));
		load();
	}
	let quoting = $state(false);
	async function quotesNow() {
		quoting = true;
		const r = await fetch('/api/data/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job: 'quotes' }) });
		const j = await r.json().catch(() => ({}));
		quoting = false;
		showToast(j.error ? `${tx('Ошибка', 'Error')}: ${j.error}` : `${tx('Котировки: обновлено', 'Quotes: updated')} ${j.updated ?? 0} ${tx('из', 'of')} ${j.securities ?? 0}${j.fx ? tx(', курс доллара', ', dollar rate') : ''}`);
		load();
	}

	let data = $state<Data | null>(null);
	// T-016: the risk limits
	let limits = $state<{ industryPct: number; specPct: number; specLossPct: number; employer: string | null; industry: string | null } | null>(null);
	async function saveLimits() {
		if (!limits) return;
		const r = await fetch('/api/limits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ industryPct: limits.industryPct, specPct: limits.specPct, specLossPct: limits.specLossPct }) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) problem = tl(j.message) || tx('Не сохранилось', 'Not saved');
	}
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
			problem = tx('Нет связи с сервером.', 'No connection to the server.');
		}
	}
	async function run(job: string) {
		await fetch('/api/data/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job }) });
		if (data) data.running = [...data.running, job];
		clearInterval(poll);
		poll = setInterval(load, 3000);
	}
	onMount(async () => {
		void fetch('/api/limits').then((r) => r.json()).then((j) => (limits = j)).catch(() => {});
		await load();
		// a load still running (the monthly prices take an hour): follow it
		if (data?.running.length) poll = setInterval(load, 3000);
		// a hypothesis card links here: #issue-<id>
		const hash = page.url.hash;
		if (hash.startsWith('#issue-')) {
			highlight = Number(hash.slice(7));
			await tick();
			document.querySelector(hash)?.scrollIntoView({ block: 'center' });
		}
	});

	let deciding = $state<number | null>(null);
	/** the issue a hypothesis card linked to */
	let highlight = $state<number | null>(null);
	/** older issues were written before the details were in Russian and rounded */
	const clean = (d: string) =>
		d.replace(/\s*without a corporate action/, '').replace(/\d+\.\d{4,}/g, (x) => String(Number(Number(x).toPrecision(5)))).replace(/(\d)\.(\d)/g, '$1,$2');
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
		if (!r.ok) return showToast(tl(j.message) || tx('Не получилось', 'It did not work'));
		showToast(
			(decision === 'valid' ? tx('Цена принята', 'Price accepted') : tx('День исключён из расчёта', 'Day excluded from the calculation')) + (j.closed ? ` · ${tx('закрыто гипотез', 'hypotheses closed')}: ${j.closed}` : '')
		);
		load();
	}
	onDestroy(() => clearInterval(poll));

	const fmt = $derived(new Intl.NumberFormat(loc()));
	const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
	const JOB: Record<string, string> = $derived({
		quotes: tx('Котировки в течение дня', 'Intraday quotes'),
		fx: tx('Курс доллара (Банк Израиля)', 'Dollar rate (Bank of Israel)'),
		monthly: tx('Месячные цены для модели', 'Monthly prices for the model'),
		events: tx('Календарь отчётов и дивидендов для модели', 'Report and dividend calendar for the model'),
		profiles: tx('Профили бумаг: сектор, отрасль, страна', 'Security profiles: sector, industry, country'),
		prices: tx('Дневные цены', 'Daily prices'),
		history: tx('Историческая загрузка', 'History load'),
		hypotheses: tx('Гипотезы: вход, результат, закрытие', 'Hypotheses: entry, result, close'),
		listings: tx('Списки бумаг', 'Security lists'),
		gaps: tx('Контроль пропусков', 'Gap check'),
		'backup-app': tx('Копия журнала (app.db)', 'Journal backup (app.db)'),
		'backup-market': tx('Копия рыночных данных (market.db)', 'Market data backup (market.db)')
	});
	const STATUS: Record<string, string> = $derived({ ok: tx('ок', 'ok'), suspicious: tx('подозрительно', 'suspicious'), error: tx('ошибка', 'error'), running: tx('идёт', 'running') });
	const RULE: Record<string, string> = $derived({
		'price.jump': tx('скачок больше 50% без корпоративного действия, ждёт проверки', 'a jump over 50% without a corporate action, awaits a check'),
		'price.unit_glitch': tx('агороты и шекели перепутаны', 'agorot and shekels mixed up'),
		'price.unit_mismatch': tx('единица цены не совпадает', 'the price unit does not match'),
		'price.ohlc': tx('цены дня не сходятся', 'the day prices do not agree'),
		'price.not_trading_day': tx('не торговый день', 'not a trading day'),
		'price.not_positive': tx('цена не больше нуля', 'the price is not above zero'),
		'price.volume': tx('отрицательный объём', 'negative volume')
	});
</script>

<svelte:head><title>{tx('Настройки', 'Settings')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Настройки', 'Settings')} back={{ href: '/more', label: tx('Ещё', 'More') }} />

<Fold key="settings-push" title={tx('Уведомления', 'Notifications')} summary={tx('сигналы стопа, цели и пересмотра', 'stop, target and review signals')}>
	{#snippet aside()}<HelpIcon topicKey="trade.notify" label={tx('уведомления', 'notifications')} />{/snippet}
	<PushSettings />
</Fold>

<Fold key="settings-limits" title={tx('Лимиты риска', 'Risk limits')} summary={limits ? tx(`отрасль работы ${limits.industryPct}% · спекуляции ${limits.specPct}%`, `job industry ${limits.industryPct}% · speculation ${limits.specPct}%`) : undefined}>
	{#snippet aside()}<HelpIcon topicKey="portfolio.work_risk" label={tx('лимиты', 'limits')} />{/snippet}
	{#if limits}
		<p class="muted small">{limits.employer ? tx(`Работодатель — ${limits.employer}, отрасль — ${limits.industry ?? 'неизвестна'} (задаётся на экране «Риск»).`, `Employer — ${limits.employer}, industry — ${limits.industry ?? 'unknown'} (set on «Risk»).`) : tx('Работодатель не задан — экран «Риск», поле «Работодатель».', 'No employer set — the «Risk» screen, «Employer».')}</p>
		<div class="lims">
			<label>{tx('Доля отрасли работы, % портфеля', 'The job\'s industry, % of the portfolio')}<input inputmode="decimal" bind:value={limits.industryPct} onchange={saveLimits} /></label>
			<label>{tx('Бюджет спекуляций, % портфеля', 'Speculation budget, % of the portfolio')}<input inputmode="decimal" bind:value={limits.specPct} onchange={saveLimits} /></label>
			<label>{tx('Допустимый убыток по спекуляциям, % портфеля', 'Allowed speculation loss, % of the portfolio')}<input inputmode="decimal" bind:value={limits.specLossPct} onchange={saveLimits} /><HelpIcon topicKey="portfolio.speculation" label={tx('спекуляции', 'speculation')} /></label>
		</div>
	{/if}
</Fold>

<Fold key="settings-bench" title={tx('Бенчмарки и пороги', 'Benchmarks and thresholds')} summary={tx('S&P 500 · ТА-125', 'S&P 500 · TA-125')}>
	<dl>
		<dt>{tx('Бумаги США', 'US securities')}</dt>
		<dd>S&P 500</dd>
		<dt>{tx('Бумаги TASE', 'TASE securities')}</dt>
		<dd>{tx('ТА-125', 'TA-125')}</dd>
		<dt>{tx('Оценка источника', 'Source rating')}</dt>
		<dd>{tx('от 10 закрытых гипотез — «предварительно», от 30 — без пометки', 'from 10 closed hypotheses — «preliminary», from 30 — unmarked')}</dd>
	</dl>
</Fold>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

<Fold key="settings-updates" title={tx('Обновление данных', 'Data updates')}>
	{#if !data}
		<div class="skeleton"></div>
	{:else}
		{@const q = data.jobs.find((j) => j.job === 'quotes')}
		{@const pr = data.jobs.find((j) => j.job === 'prices')}
		<p class="muted small-top">
			{tx('Два вида цен.', 'Two kinds of prices.')} <b>{tx('Котировки', 'Quotes')}</b> — {tx('последняя цена бумаг ваших портфелей и курс доллара в течение дня (Yahoo, обычно с задержкой до 15–20 минут); ими считается экран портфеля.', 'the last price of the securities in your portfolios and the dollar rate during the day (Yahoo, usually delayed up to 15–20 minutes); the portfolio screen uses them.')} <b>{tx('Дневные закрытия', 'Daily closes')}</b> — {tx('проверенные цены закрытия раз в день; на них — статистика, гипотезы и модель.', 'checked closing prices once a day; stats, hypotheses and the model use them.')}
		</p>
		<div class="sched">
			<label
				>{tx('Котировки каждые', 'Quotes every')}
				<select value={data.schedule.quotesEvery} disabled={saving} onchange={(e) => setSchedule({ quotesEvery: Number(e.currentTarget.value) })}>
					{#each [0, 5, 10, 15, 30, 60] as n (n)}<option value={n}>{n ? `${n} ${tx('мин', 'min')}` : tx('выключено', 'off')}</option>{/each}
				</select>
			</label>
			<label class="check"
				><input type="checkbox" checked={data.schedule.quotesMarketHours} disabled={saving} onchange={(e) => setSchedule({ quotesMarketHours: e.currentTarget.checked })} /> {tx('только пока открыта биржа (TASE или США)', 'only while an exchange is open (TASE or US)')}</label
			>
			<label
				>{tx('Дневные закрытия — каждый день в', 'Daily closes — every day at')}
				<input type="time" value={data.schedule.pricesAt} disabled={saving} onchange={(e) => setSchedule({ pricesAt: e.currentTarget.value })} />
			</label>
		</div>
		<dl class="state">
			<dt>{tx('Сейчас', 'Now')}</dt>
			<dd>TASE {data.next.open.tase ? tx('открыта', 'open') : tx('закрыта', 'closed')} · {tx('США', 'US')} {data.next.open.us ? tx('открыты', 'open') : tx('закрыты', 'closed')}</dd>
			<dt>{tx('Котировки', 'Quotes')}</dt>
			<dd>
				{q ? `${when(q.finishedAt ?? q.startedAt)} · ${STATUS[q.status] ?? q.status}` : tx('ещё не загружались', 'not loaded yet')}{#if q?.updated} · {tx('обновлено', 'updated')} {q.updated}{/if}<br /><span class="muted"
					>{tx('следующие', 'next')}: {data.next.quotes === null ? tx('выключены', 'off') : data.next.quotes === 'market-closed' ? tx('когда откроется биржа', 'when an exchange opens') : when(data.next.quotes)}</span
				>
			</dd>
			<dt>{tx('Дневные закрытия', 'Daily closes')}</dt>
			<dd>{pr ? `${when(pr.finishedAt ?? pr.startedAt)} · ${STATUS[pr.status] ?? pr.status}` : '—'}<br /><span class="muted">{tx('следующие: в', 'next: at')} {data.next.prices}</span></dd>
		</dl>
		<div class="btns">
			<button class="btn" onclick={quotesNow} disabled={quoting}><span class:spin={quoting}><RefreshCw size={16} /></span>{quoting ? tx('Обновляю…', 'Refreshing…') : tx('Котировки сейчас', 'Quotes now')}</button>
			<button class="btn" onclick={() => run('prices')} disabled={data.running.includes('prices')}>
				<span class:spin={data.running.includes('prices')}><RefreshCw size={16} /></span>{data.running.includes('prices') ? tx('Загружается…', 'Loading…') : tx('Закрытия сейчас', 'Closes now')}
			</button>
		</div>
		{#if data.monthly}
			<dl class="state">
				<dt>{tx('Месячные цены для модели', 'Monthly prices for the model')}</dt>
				<dd>{tx(`загружено ${data.monthly.loaded} из ${data.monthly.total}`, `${data.monthly.loaded} of ${data.monthly.total} loaded`)}<br /><span class="muted">{tx('по ночам порциями; кнопка — всё сразу, около часа', 'at night in portions; the button — all at once, about an hour')}</span></dd>
			</dl>
			<div class="btns">
				<button class="btn" onclick={() => run('monthly')} disabled={data.running.includes('monthly')}>
					<span class:spin={data.running.includes('monthly')}><RefreshCw size={16} /></span>{data.running.includes('monthly') ? tx('Загружается…', 'Loading…') : tx('Месячные цены сейчас', 'Monthly prices now')}
				</button>
			</div>
		{/if}
	{/if}
</Fold>

<Fold key="settings-data" title={tx('Данные', 'Data')} summary={data ? tx(`${fmt.format(data.ringSize)} бумаг, проблем качества: ${data.issues.open}`, `${fmt.format(data.ringSize)} securities, quality issues: ${data.issues.open}`) : undefined}>
	{#snippet aside()}
		<button class="btn" onclick={() => run('prices')} disabled={data?.running.includes('prices')}>
			<span class:spin={data?.running.includes('prices')}><RefreshCw size={16} /></span>{data?.running.includes('prices') ? tx('Обновляется…', 'Refreshing…') : tx('Обновить сейчас', 'Refresh now')}
		</button>
	{/snippet}
	{#if !data}
		<div class="skeleton"></div>
	{:else}
		{#if data.late}<p class="warn">{tx('Дневное задание не отработало больше двух дней.', 'The daily job has not run for over two days.')}</p>{/if}
		<div class="nums">
			<div><b>{fmt.format(data.ringSize)}</b><span>{tx('бумаг грузятся', 'securities loading')} ({tx('круг', 'ring')} {data.ring})</span></div>
			<div><b>{fmt.format(data.priceRows)}</b><span>{tx('строк цен', 'price rows')}</span></div>
			<div><b>{fmt.format(data.queue.queued)}</b><span>{tx('в очереди истории', 'in the history queue')}{data.queue.failed ? `, ${data.queue.failed} ${tx('не удалось', 'failed')}` : ''}</span></div>
			<div><b>{fmt.format(data.issues.open)}</b><span>{tx('проблем качества', 'quality issues')}</span></div>
		</div>

		<h3>{tx('Последние запуски', 'Last runs')}</h3>
		<ul class="runs">
			{#each data.jobs as j (j.job)}
				<li>
					<span class="name">{JOB[j.job] ?? j.job}</span>
					<span class="status {j.status}">{STATUS[j.status] ?? j.status}</span>
					<span class="muted">{when(j.finishedAt ?? j.startedAt)}{j.received || j.added ? ` · ${tx('получено', 'received')} ${fmt.format(j.received)}, ${tx('новых', 'new')} ${fmt.format(j.added)}` : ''}</span>
					{#if j.error}<span class="err">{j.error}</span>{/if}
				</li>
			{/each}
		</ul>

		<h3>{tx('Нет данных', 'No data')}</h3>
		{#if data.noData.length}
			<ul class="plain">
				{#each data.noData as n (n.id)}
					<li><b>{n.symbol}</b> · {n.exchange} — {tl(n.why)}{n.lastDate ? `, ${tx('последняя цена', 'last price')} ${n.lastDate}` : ''}</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">{tx('Все бумаги с ценами.', 'All securities have prices.')}</p>
		{/if}

		{#if data.issues.recent.length}
			<h3>{tx('Проблемы качества', 'Quality issues')}</h3>
			<p class="muted small-top">
				{tx('Скачок больше 50% за день без корпоративного действия не входит в расчёт, пока вы не решите: «Цена верна» — день возвращается в расчёт; «Цена ошибочна» — исключается навсегда. Сверить цену можно на сайте биржи.', 'A one-day jump over 50% without a corporate action stays out of the calculation until you decide: «Price is right» — the day returns to the calculation; «Price is wrong» — it is excluded for good. You can check the price on the exchange site.')}
			</p>
			<ul class="issues">
				{#each data.issues.recent as q (q.id)}
					<li id="issue-{q.id}" class:hl={highlight === q.id}>
						<div>
							<b>{q.symbol ?? '—'}</b>{q.date ? ` ${q.date.split('-').reverse().join('.')}` : ''} — {RULE[q.rule] ?? q.rule}{q.detail
								? `: ${clean(q.detail)}`
								: ''}
						</div>
						{#if q.rule === 'price.jump'}
							<div class="decide">
								<button disabled={deciding === q.id} onclick={() => decide(q.id, 'valid')}>{tx('Цена верна', 'Price is right')}</button>
								<button disabled={deciding === q.id} onclick={() => decide(q.id, 'invalid')}>{tx('Цена ошибочна', 'Price is wrong')}</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<p class="muted small">
			{tx('Дневные цены загружаются каждое утро в', 'Daily prices load every morning at')} {data.schedule.pricesAt} {tx('по Израилю, пропущенные дни догружаются; списки бумаг — по воскресеньям; пропуски проверяются по субботам. Копия журнала — каждую ночь (30 копий), рыночных данных — по воскресеньям (2 копии).', 'Israel time, missed days are filled in; security lists — on Sundays; gaps are checked on Saturdays. A journal backup — every night (30 copies), market data — on Sundays (2 copies).')}
		</p>
	{/if}
</Fold>

<style>
	.sched {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
		margin: var(--s3) 0;
	}
	.sched label {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.sched label.check {
		flex-direction: row;
		align-items: center;
		gap: var(--s2);
		color: var(--text);
	}
	.sched select,
	.sched input[type='time'] {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		max-width: 220px;
	}
	.state {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--s1) var(--s3);
		margin: var(--s3) 0;
		font-size: var(--fs-s);
	}
	.state dt {
		color: var(--muted);
	}
	.state dd {
		margin: 0;
	}
	.btns {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
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
	.issues li.hl {
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
	.lims {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.lims label {
		display: flex;
		align-items: center;
		gap: var(--s2);
		justify-content: space-between;
		font-size: var(--fs-s);
	}
	.lims input {
		width: 72px;
		min-height: 36px;
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		text-align: right;
		font: inherit;
	}
</style>
