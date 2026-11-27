<script lang="ts">
	import SortHead from '#lib/SortHead.svelte';
	import { TableSort } from '#lib/tablesort.svelte.js';
	const momSort = new TableSort<'cagr' | 'maxDrawdown' | 'vol' | 'sharpe'>();
	import { onMount } from 'svelte';
	import TopBar from '#lib/TopBar.svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import LineChart, { colorOf, type Line } from '#lib/charts/LineChart.svelte';
	import { showToast } from '#lib/toast.svelte.js';
	import { tx } from '#lib/i18n.js';

	/**
	 * T-017 «Страновой моментум»: the N countries' funds with the best rise over L months, rebalanced each month (or
	 * quarter). Variant A always holds them; B gives a fund's part to BIL when the fund is not above it. Compared with
	 * three bases — SPY, all countries in equal parts, last year's leaders — over the window and its last 3 years,
	 * checked without peeking and against chance. Its choice is recorded monthly as hypotheses with virtual portfolios.
	 */
	type Metrics = { cagr: number | null; maxDrawdown: number | null; vol: number | null; sharpe: number | null };
	type Row = { name: string; full: Metrics; check: Metrics; safeShare: number | null; turnover: number | null };
	type Params = { universe: string[]; safe: string; lookback: number; skip: number; top: number; rebalance: 'month' | 'quarter'; years: number; commissionPct: number; taxPct: number };
	type View = {
		ready: boolean;
		params: Params;
		data: { missing: string[]; unknown: string[]; loading: boolean };
		lastMonth?: string;
		window?: { from: string; to: string; checkFrom: string };
		current?: { variant: 'A' | 'B'; month: string; picks: { symbol: string; signal: number | null; toSafe: boolean }[]; hold: string[]; in: string[]; out: string[] }[];
		ranking?: { symbol: string; signal: number | null }[];
		safeSignal?: number | null;
		table?: Row[];
		walk?: { variant: string; lookback: number; top: number; cagr: number | null; sharpe: number | null }[];
		placebo?: { variant: string; share: number | null; verdict: 'signal' | 'unclear' | 'chance' }[];
		costs?: { A: number; B: number };
		curves?: Record<string, { date: string; value: number }[]>;
		ms: number;
	};

	let v = $state<View | null>(null);
	let saved = $state<Params | null>(null);
	let params = $state<Params | null>(null);
	let busy = $state(false);
	let period = $state<'full' | 'check'>('full');
	let hidden = $state<string[]>(['EQUAL']);
	let add = $state('');
	let problem = $state('');

	const NAMES: Record<string, [string, string]> = {
		A: ['А. Относительный', 'A. Relative'],
		B: ['Б. Двойной', 'B. Dual'],
		SPY: ['SPY', 'SPY'],
		EQUAL: ['Все страны поровну', 'All countries equally'],
		LEADERS: ['Лидеры прошлого года', "Last year's leaders"]
	};
	const name = (k: string) => tx(...NAMES[k]);
	const SHORT: Record<string, [string, string]> = { A: ['А', 'A'], B: ['Б', 'B'], SPY: ['SPY', 'SPY'], EQUAL: ['Поровну', 'Equal'], LEADERS: ['Лидеры', 'Leaders'] };
	const pct = (x: number | null | undefined, sign = false) => (x === null || x === undefined ? '—' : `${sign && x > 0 ? '+' : ''}${x.toFixed(1).replace('.', tx(',', '.'))}%`);
	const changed = $derived(!!params && !!saved && JSON.stringify(params) !== JSON.stringify(saved));

	let timer: ReturnType<typeof setTimeout> | undefined;
	async function load(p?: Params) {
		busy = true;
		problem = '';
		try {
			const q = p ? '?' + new URLSearchParams({ lookback: String(p.lookback), skip: String(p.skip), top: String(p.top), rebalance: p.rebalance, years: String(p.years), commissionPct: String(p.commissionPct), taxPct: String(p.taxPct) }) : '';
			const r = await fetch(`/api/model/momentum${q}`);
			if (!r.ok) throw new Error(String(r.status));
			const next = (await r.json()) as View;
			v = next;
			if (!p) {
				saved = next.params;
				params = { ...next.params, universe: [...next.params.universe] };
			}
		} catch (e) {
			problem = tx(`Не удалось посчитать: ${e}`, `Could not compute: ${e}`);
		} finally {
			busy = false;
		}
	}
	function set<K extends keyof Params>(k: K, value: Params[K]) {
		if (!params) return;
		params[k] = value;
		clearTimeout(timer);
		timer = setTimeout(() => load($state.snapshot(params!) as Params), 250);
	}
	async function save(p = params) {
		if (!p) return;
		const r = await fetch('/api/model/momentum', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
		if (!r.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		await load();
		showToast(tx('Сохранено: следующая ребалансировка — с этими параметрами', 'Saved: the next rebalance uses these parameters'));
	}
	function addFund() {
		const s = add.trim().toUpperCase();
		add = '';
		if (!params || !/^[A-Z.]{1,8}$/.test(s) || params.universe.includes(s)) return;
		void save({ ...$state.snapshot(params), universe: [...params.universe, s] } as Params);
	}
	function dropFund(s: string) {
		if (!params || params.universe.length <= 2) return;
		void save({ ...$state.snapshot(params), universe: params.universe.filter((x) => x !== s) } as Params);
	}
	function reset() {
		if (saved) params = { ...saved, universe: [...saved.universe] };
		void load();
	}
	onMount(() => {
		void load();
		return () => clearTimeout(timer);
	});

	const KEYS = ['A', 'B', 'SPY', 'EQUAL', 'LEADERS'];
	const lines = $derived<Line[]>(
		v?.curves
			? KEYS.filter((k) => !hidden.includes(k)).map((k) => ({ key: k, label: name(k), points: v!.curves![k], color: colorOf(KEYS.indexOf(k)), main: k === 'A', dashed: k === 'SPY' }))
			: []
	);
	const VERDICT = { signal: ['похоже на сигнал', 'looks like a signal'], unclear: ['неясно', 'unclear'], chance: ['похоже на случай', 'looks like chance'] } as const;
	const STEPS = [
		{ key: 'lookback', ru: 'Рост за, мес. (L)', en: 'Rise over, months (L)', min: 3, max: 12, help: 'model.momentum.param.lookback' },
		{ key: 'top', ru: 'Сколько стран (N)', en: 'How many countries (N)', min: 1, max: 10, help: 'model.momentum.param.top' },
		{ key: 'years', ru: 'Лет истории', en: 'Years of history', min: 3, max: 20, help: 'model.momentum.param.years' }
	] as const;
</script>

<svelte:head><title>{tx('Страновой моментум', 'Country momentum')}</title></svelte:head>

<TopBar title={tx('Страновой моментум', 'Country momentum')} help="model.momentum.guide" back={{ href: '/more', label: tx('Ещё', 'More') }} />

{#if problem}<p class="err">{problem}</p>{/if}

{#if v && (v.data.missing.length || v.data.unknown.length)}
	<p class="banner" role="status">
		{#if v.data.missing.length}{tx(`Месячные цены загружаются: ${v.data.missing.join(', ')}. Обнови экран через минуту.`, `Monthly prices are loading: ${v.data.missing.join(', ')}. Refresh in a minute.`)}{/if}
		{#if v.data.unknown.length}{tx(`Нет в базе бумаг: ${v.data.unknown.join(', ')}.`, `Not in the database: ${v.data.unknown.join(', ')}.`)}{/if}
	</p>
{/if}

{#if !v}
	<p class="muted">{tx('Считаю…', 'Computing…')}</p>
{:else if !v.ready}
	<section class="card"><p class="muted">{tx('Пока нет месячных цен SPY и BIL — они грузятся сейчас.', 'No monthly prices of SPY and BIL yet — loading now.')}</p></section>
{:else}
	<Fold key="mom-now" title={tx('Сигнал сейчас', 'The signal now')} remind="model.momentum.variants">
		{#snippet aside()}<HelpIcon topicKey="model.momentum.variants" label={tx('варианты', 'variants')} />{/snippet}
		<p class="muted small">{tx(`По ценам на конец ${v.lastMonth}; на ${v.current?.[0]?.month}`, `By the closes of ${v.lastMonth}; for ${v.current?.[0]?.month}`)}</p>
		{#each v.current ?? [] as c (c.variant)}
			<div class="now">
				<b>{name(c.variant)}</b>
				<div class="chips">
					{#each c.picks as x (x.symbol)}
						<span class="chip" class:safe={x.toSafe}>{x.symbol} <small>{pct(x.signal, true)}</small>{#if x.toSafe}<small> → {v.params.safe}</small>{/if}</span>
					{/each}
				</div>
				<p class="small">
					{#if c.in.length || c.out.length}
						{#if c.in.length}<span class="up">{tx('купить', 'buy')} {c.in.join(', ')}</span>{/if}
						{#if c.out.length}<span class="down">{tx('продать', 'sell')} {c.out.join(', ')}</span>{/if}
					{:else}<span class="muted">{tx('без изменений с прошлого месяца', 'no change since last month')}</span>{/if}
				</p>
			</div>
		{/each}
		<details>
			<summary class="small">{tx('Все страны по сигналу', 'All countries by signal')}</summary>
			<ol class="rank">
				{#each v.ranking ?? [] as r (r.symbol)}
					<li class:below={v.safeSignal !== null && v.safeSignal !== undefined && r.signal !== null && r.signal <= v.safeSignal}><span>{r.symbol}</span><span class="num">{pct(r.signal, true)}</span></li>
				{/each}
			</ol>
			<p class="muted small">{tx(`${v.params.safe} (убежище): ${pct(v.safeSignal ?? null, true)} — серые ниже него, в Б не берутся`, `${v.params.safe} (refuge): ${pct(v.safeSignal ?? null, true)} — the grey ones are below it, B skips them`)}</p>
		</details>
	</Fold>

	<Fold key="mom-table" title={tx('Результат', 'Result')} remind="model.momentum.bases">
		{#snippet aside()}<HelpIcon topicKey="model.momentum.bases" label={tx('базы', 'bases')} />{/snippet}
		<p class="muted small">{tx('А — относительный, Б — двойной; Поровну — все страны равными долями; Лидеры — 4 лучшие прошлого года.', 'A — relative, B — dual; Equal — all countries in equal parts; Leaders — last year\'s 4 best.')}</p>
		<div class="seg" role="radiogroup" aria-label={tx('Период', 'Period')}>
			<button role="radio" aria-checked={period === 'full'} class:on={period === 'full'} onclick={() => (period = 'full')}>{tx(`${v.params.years} лет`, `${v.params.years} years`)}</button>
			<button role="radio" aria-checked={period === 'check'} class:on={period === 'check'} onclick={() => (period = 'check')}>{tx(`с ${v.window?.checkFrom}`, `from ${v.window?.checkFrom}`)}</button>
		</div>
		<div class="scroll">
			<table>
				<thead><tr><th></th><th><SortHead s={momSort} k="cagr">{tx('В год', 'Yearly')}<br /><small>CAGR</small></SortHead></th><th><SortHead s={momSort} k="maxDrawdown">{tx('Падение', 'Fall')}<br /><small>MDD</small></SortHead></th><th><SortHead s={momSort} k="vol" desc={false}>{tx('Колеб.', 'Swings')}<br /><small>HV</small></SortHead></th><th><SortHead s={momSort} k="sharpe">Sharpe</SortHead></th></tr></thead>
				<tbody>
					{#each momSort.rows(v.table ?? [], (r, k) => r[period][k]) as r (r.name)}
						{@const m = r[period]}
						<tr class:model={r.name === 'A' || r.name === 'B'}><td>{tx(...SHORT[r.name])}</td><td class="num">{pct(m.cagr, true)}</td><td class="num">{pct(m.maxDrawdown)}</td><td class="num">{pct(m.vol)}</td><td class="num">{m.sharpe ?? '—'}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small">
			{tx(`Окно ${v.window?.from} — ${v.window?.to}. После комиссии ${v.params.commissionPct}% и налога ${v.params.taxPct}% с прибыли при продаже: издержки за всё окно — А ${v.costs?.A}%, Б ${v.costs?.B}% капитала. Доля в ${v.params.safe} у Б — ${v.table?.[1]?.safeShare ?? 0}% месяцев. Оборот в год: А ${v.table?.[0]?.turnover}%, Б ${v.table?.[1]?.turnover}%.`, `Window ${v.window?.from} — ${v.window?.to}. After a ${v.params.commissionPct}% commission and a ${v.params.taxPct}% tax on gains when selling: costs over the window — A ${v.costs?.A}%, B ${v.costs?.B}% of the capital. B held ${v.params.safe} ${v.table?.[1]?.safeShare ?? 0}% of the months. Yearly turnover: A ${v.table?.[0]?.turnover}%, B ${v.table?.[1]?.turnover}%.`)}
		</p>
	</Fold>

	<Fold key="mom-chart" remind="model.momentum.bases" title={tx('Кривые', 'Curves')}>
		{#if lines.length}<LineChart {lines} percent height={240} />{/if}
		<div class="toggles">
			{#each KEYS as k (k)}
				<button class:on={!hidden.includes(k)} aria-pressed={!hidden.includes(k)} onclick={() => (hidden = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k])}><i style:background={colorOf(KEYS.indexOf(k))}></i>{name(k)}</button>
			{/each}
		</div>
	</Fold>

	<Fold key="mom-check" remind="model.momentum.walk" title={tx('Проверки', 'Checks')}>
		<h3>{tx('Без подглядывания', 'Without peeking')} <HelpIcon topicKey="model.momentum.walk" label={tx('без подглядывания', 'without peeking')} /></h3>
		{#each v.walk ?? [] as w (w.variant)}
			<p class="small">{name(w.variant)}: {tx(`лучшие на ранних годах L ${w.lookback}, N ${w.top} → на проверочных ${pct(w.cagr, true)} в год, Sharpe ${w.sharpe ?? '—'}`, `best on the early years L ${w.lookback}, N ${w.top} → on the check years ${pct(w.cagr, true)} a year, Sharpe ${w.sharpe ?? '—'}`)}</p>
		{/each}
		<h3>{tx('Плацебо: 100 случайных выборов', 'Placebo: 100 random choices')} <HelpIcon topicKey="model.placebo" label={tx('плацебо', 'placebo')} /></h3>
		{#each v.placebo ?? [] as p (p.variant)}
			<p class="placebo {p.verdict}"><b>{name(p.variant)}</b> <span class="badge">{tx(VERDICT[p.verdict][0], VERDICT[p.verdict][1])}</span> <span class="small">{tx(`случай не хуже в ${p.share ?? '—'}% прогонов`, `chance as good in ${p.share ?? '—'}% of runs`)}</span></p>
		{/each}
	</Fold>
{/if}

{#if params}
	<Fold key="mom-params" remind="model.momentum.guide" title={tx('Параметры', 'Parameters')} summary={`L ${params.lookback} · N ${params.top} · ${params.rebalance === 'month' ? tx('раз в месяц', 'monthly') : tx('раз в квартал', 'quarterly')}${changed ? tx(' · не сохранены', ' · not saved') : ''}`}>
		{#snippet aside()}{#if busy}<span class="muted small">{tx('считаю…', 'computing…')}</span>{:else if v}<span class="muted small">{v.ms} ms</span>{/if}{/snippet}
		{#each STEPS as f (f.key)}
			<div class="prow">
				<span class="pl">{tx(f.ru, f.en)} <HelpIcon topicKey={f.help} label={tx(f.ru, f.en)} /></span>
				<span class="stepper">
					<button aria-label="−" disabled={params[f.key] <= f.min} onclick={() => set(f.key, params![f.key] - 1)}>−</button>
					<b>{params[f.key]}</b>
					<button aria-label="+" disabled={params[f.key] >= f.max} onclick={() => set(f.key, params![f.key] + 1)}>+</button>
				</span>
			</div>
		{/each}
		<div class="prow">
			<span class="pl">{tx('Без последнего месяца', 'Skip the last month')} <HelpIcon topicKey="model.momentum.param.skip" label={tx('без последнего месяца', 'skip the last month')} /></span>
			<input type="checkbox" checked={params.skip === 1} onchange={(e) => set('skip', e.currentTarget.checked ? 1 : 0)} />
		</div>
		<div class="prow">
			<span class="pl">{tx('Пересборка', 'Rebalance')} <HelpIcon topicKey="model.momentum.param.rebalance" label={tx('пересборка', 'rebalance')} /></span>
			<select value={params.rebalance} onchange={(e) => set('rebalance', e.currentTarget.value as Params['rebalance'])}>
				<option value="month">{tx('раз в месяц', 'monthly')}</option>
				<option value="quarter">{tx('раз в квартал', 'quarterly')}</option>
			</select>
		</div>
		<div class="prow">
			<span class="pl">{tx('Комиссия, %', 'Commission, %')} <HelpIcon topicKey="model.costs" label={tx('издержки', 'costs')} /></span>
			<input class="numin" inputmode="decimal" value={params.commissionPct} onchange={(e) => set('commissionPct', Number(e.currentTarget.value.replace(',', '.')))} />
		</div>
		<div class="prow">
			<span class="pl">{tx('Налог с прибыли, %', 'Tax on gains, %')}</span>
			<input class="numin" inputmode="decimal" value={params.taxPct} onchange={(e) => set('taxPct', Number(e.currentTarget.value.replace(',', '.')))} />
		</div>
		<div class="save">
			<button class="primary" disabled={!changed} onclick={() => save()}>{tx('Сохранить', 'Save')}</button>
			{#if changed}<button class="ghost" onclick={reset}>{tx('Вернуть', 'Revert')}</button>{/if}
		</div>
		<p class="muted small">{tx('Без сохранения — только посмотреть. Сохранённые параметры записывают гипотезы и ведут виртуальные портфели А и Б.', 'Unsaved — a look only. The saved parameters record the hypotheses and run the virtual portfolios A and B.')}</p>
	</Fold>

	<Fold key="mom-universe" title={tx('Страны', 'Countries')} open={false} summary={tx(`${params.universe.length} фондов`, `${params.universe.length} funds`)} remind="model.momentum.param.universe">
		{#snippet aside()}<HelpIcon topicKey="model.momentum.param.universe" label={tx('страны', 'countries')} />{/snippet}
		<div class="chips">
			{#each params.universe as s (s)}
				<span class="chip">{s} <button class="x" aria-label={tx(`убрать ${s}`, `remove ${s}`)} onclick={() => dropFund(s)}>×</button></span>
			{/each}
		</div>
		<form class="addrow" onsubmit={(e) => (e.preventDefault(), addFund())}>
			<input bind:value={add} placeholder={tx('тикер фонда, напр. EWZ', 'fund ticker, e.g. EWZ')} autocapitalize="characters" />
			<button class="ghost" type="submit">{tx('Добавить', 'Add')}</button>
		</form>
		<p class="muted small">{tx(`Убежище — ${params.safe}. Цены нового фонда загрузятся сами.`, `The refuge is ${params.safe}. A new fund's prices load by themselves.`)}</p>
	</Fold>
{/if}

<style>
	.banner {
		margin: 0 0 var(--s3);
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: var(--fs-s);
	}
	.card {
		margin-bottom: var(--s4);
		padding: var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: var(--s3) 0 var(--s1);
		font-size: var(--fs-m);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.err,
	.down {
		color: var(--down);
	}
	.up {
		color: var(--up);
		margin-right: var(--s2);
	}
	.now {
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.now p {
		margin: 4px 0 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 6px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		font-size: var(--fs-s);
		font-variant-numeric: tabular-nums;
	}
	.chip small {
		color: var(--muted);
	}
	.chip.safe {
		border-style: dashed;
	}
	.chip .x {
		border: none;
		background: none;
		color: var(--muted);
		font-size: 16px;
		cursor: pointer;
		padding: 0 2px;
	}
	details summary {
		cursor: pointer;
		margin-top: var(--s2);
	}
	.rank {
		margin: var(--s2) 0;
		padding-left: 1.6em;
		font-size: var(--fs-s);
	}
	.rank li span {
		display: inline-block;
		min-width: 4em;
	}
	.rank li.below {
		color: var(--muted);
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.seg {
		display: flex;
		gap: 6px;
		margin-bottom: var(--s3);
	}
	.seg button,
	.toggles button {
		flex: 1;
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg button.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
	}
	.toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: var(--s2);
	}
	.toggles button {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0 12px;
		opacity: 0.5;
	}
	.toggles button.on {
		opacity: 1;
	}
	.toggles i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-s);
	}
	th {
		font-weight: 500;
		color: var(--muted);
		font-size: var(--fs-xs);
		text-align: right;
		padding: 4px;
	}
	td {
		padding: 6px 3px;
		white-space: nowrap;
		border-top: 1px solid var(--line);
	}
	tr.model td:first-child {
		font-weight: 600;
	}
	.placebo {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin: 6px 0;
		font-size: var(--fs-s);
	}
	.placebo .badge {
		padding: 2px 8px;
		border-radius: 999px;
		font-size: var(--fs-xs);
		font-weight: 700;
	}
	.placebo.signal .badge {
		background: color-mix(in srgb, var(--up) 18%, transparent);
		color: var(--up);
	}
	.placebo.unclear .badge {
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.placebo.chance .badge {
		background: color-mix(in srgb, var(--down) 15%, transparent);
		color: var(--down);
	}
	.prow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		min-height: 44px;
		border-top: 1px solid var(--line);
	}
	.pl {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: var(--fs-s);
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.stepper b {
		min-width: 2.2em;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.stepper button {
		width: 36px;
		height: 36px;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: none;
		color: var(--text);
		font-size: 18px;
		cursor: pointer;
	}
	select,
	input:not([type='checkbox']) {
		min-height: 36px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
	}
	input[type='checkbox'] {
		width: 22px;
		height: 22px;
	}
	.numin {
		width: 5em;
		text-align: right;
	}
	.addrow {
		display: flex;
		gap: var(--s2);
		margin-top: var(--s3);
	}
	.addrow input {
		flex: 1;
		min-width: 0;
	}
	.save {
		display: flex;
		gap: var(--s2);
		margin-top: var(--s3);
	}
	.save button,
	.addrow button {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border-radius: var(--r2);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.primary {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.primary:disabled {
		opacity: 0.4;
	}
	.ghost {
		border: 1px solid var(--line);
		background: none;
		color: var(--text);
	}
</style>
