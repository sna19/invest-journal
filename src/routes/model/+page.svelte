<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import TopBar from '#lib/TopBar.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { showToast } from '#lib/toast.svelte.js';
	import { tx } from '#lib/i18n.js';
	import { sectorName } from '#lib/allocation.js';

	/** Spec section 21, T-009 — the quarterly model: parameters with «?», a live preview, the candidates. */
	type Variant = 'A' | 'B';
	interface Params {
		years: number;
		k: number;
		count: number;
		perSector: number;
		perMarket: number;
		minTurnoverUsd: number;
		minPriceUsd: number;
		sort: 'mean' | 'median' | 'worst';
		compareWith: 'market' | 'sector';
	}
	interface Cand {
		id: number;
		symbol: string;
		name: string;
		market: 'US' | 'IL';
		sector: string | null;
		results: (number | null)[];
		up: number;
		mean: number;
		median: number;
		worst: number;
	}
	interface Data {
		variant: Variant;
		saved: Params;
		result: null | {
			quarter: number;
			forYear: number;
			years: number[];
			universe: number;
			noHistory: number;
			illiquid: number;
			passed: number;
			expected: number;
			p: number;
			candidates: Cand[];
			capped: number;
			bench: { US: (number | null)[]; IL: (number | null)[] };
			walk: { year: number; picked: number; pickedMean: number | null; allMean: number | null; pickedUp: number }[];
			dataMonth: string;
		};
		upcoming: { year: number; quarter: number; key: string; days: number; ready: boolean };
		recorded: { variant: string; quarter: string; hypotheses: number; at: string }[];
		data: { stocks: number; shares: number; sectors: number; loads: { n: number; ok: number | null; at: string | null } };
		ms: number;
	}

	const read = (k: string, d: string) => {
		try {
			return localStorage.getItem(k) ?? d;
		} catch {
			return d;
		}
	};
	let variant = $state<Variant>('A');
	let quarter = $state<number | null>(null);
	let params = $state<Params | null>(null);
	let data = $state<Data | null>(null);
	let problem = $state<string | null>(null);
	let busy = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	async function load(withParams: boolean) {
		const q = new URLSearchParams({ variant });
		if (quarter) q.set('quarter', String(quarter));
		if (withParams && params) for (const [k, v] of Object.entries(params)) q.set(k, String(v));
		const my = ++seq;
		busy = true;
		const r = await fetch(`/api/model?${q}`).catch(() => null);
		if (my !== seq) return;
		busy = false;
		if (!r?.ok) return void (problem = tx('Нет связи с сервером.', 'No connection to the server.'));
		problem = null;
		data = await r.json();
		if (!withParams) params = { ...data!.saved };
		if (!quarter && data!.result) quarter = data!.result.quarter;
	}
	onMount(() => {
		variant = read('model-variant', 'A') === 'B' ? 'B' : 'A';
		void load(false);
	});
	onDestroy(() => clearTimeout(timer));

	/** a parameter changed: the preview follows at once (a short pause while a stepper is tapped) */
	function set<K extends keyof Params>(k: K, v: Params[K]) {
		if (!params) return;
		params = { ...params, [k]: v };
		if (k === 'years' && params.k > params.years) params.k = params.years;
		clearTimeout(timer);
		timer = setTimeout(() => void load(true), 200);
	}
	function setVariant(v: Variant) {
		variant = v;
		try {
			localStorage.setItem('model-variant', v);
		} catch {
			/* private mode */
		}
		void load(false);
	}
	function setQuarter(q: number) {
		quarter = q;
		void load(true);
	}
	/** the parameters on screen, for the card: it shows the candidate as the preview found it */
	const previewQuery = () => new URLSearchParams(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])).toString();
	const changed = $derived(!!params && !!data && JSON.stringify(params) !== JSON.stringify(data.saved));
	async function save() {
		const r = await fetch('/api/model', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variant, ...params }) }).catch(() => null);
		if (!r?.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		data = { ...data!, saved: (await r.json()).saved };
		showToast(tx('Параметры сохранены — по ним модель запишет гипотезы квартала', 'Parameters saved — the model records the quarter by them'));
	}

	const res = $derived(data?.result ?? null);
	const verdict = $derived(
		!res ? null : res.passed === 0 ? 'none' : res.passed <= res.expected * 1.5 + 1 ? 'chance' : res.passed <= res.expected * 3 ? 'some' : 'more'
	);
	const pct = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}%`);
	const money = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1)} ${tx('млн $', 'M $')}` : `${Math.round(x / 1000)} ${tx('тыс. $', 'K $')}`);
	const label = $derived(tx('Q', 'Q'));

	const PARAMS: { key: keyof Params; help: string; ru: string; en: string; min: number; max: number; step: number }[] = [
		{ key: 'k', help: 'model.param.k', ru: 'Лет с ростом, не меньше (K)', en: 'Years with a rise, at least (K)', min: 1, max: 15, step: 1 },
		{ key: 'years', help: 'model.param.years', ru: 'Лет истории', en: 'Years of history', min: 5, max: 15, step: 1 },
		{ key: 'count', help: 'model.param.count', ru: 'Кандидатов', en: 'Candidates', min: 1, max: 30, step: 1 },
		{ key: 'perSector', help: 'model.param.per_sector', ru: 'Не больше из сектора', en: 'At most per sector', min: 1, max: 30, step: 1 },
		{ key: 'perMarket', help: 'model.param.per_market', ru: 'Не больше из рынка', en: 'At most per market', min: 1, max: 30, step: 1 },
		{ key: 'minPriceUsd', help: 'model.param.min_price', ru: 'Цена не ниже, $', en: 'Price at least, $', min: 0, max: 1000, step: 1 }
	];
	const TURNOVER = [0, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];
</script>

<svelte:head><title>{tx('Модель', 'Model')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Квартальная модель', 'Quarterly model')} help="model.guide" back={{ href: '/more', label: tx('Ещё', 'More') }} />

{#if data?.upcoming.ready}
	<p class="banner" role="status">
		{tx(`Кандидаты ${data.upcoming.key} готовы`, `Candidates for ${data.upcoming.key} are ready`)} — {tx(`до начала квартала ${data.upcoming.days} дн.`, `${data.upcoming.days} days to the quarter`)}
		{tx('В первый торговый день модель запишет гипотезы сама.', 'On the first trading day the model records the hypotheses itself.')}
	</p>
{/if}

{#if problem}<p class="err">{problem}</p>{/if}

{#if data && data.data.stocks < 500}
	<section class="card">
		<h2>{tx('Данные загружаются', 'Data are loading')}</h2>
		<p class="muted">
			{tx(`Месячные цены за 15 лет грузятся по ночам порциями: загружено ${data.data.stocks} из ${data.data.shares} акций. Модель заработает, когда их будет больше 500; полная загрузка — за одну-две ночи.`, `Monthly prices for 15 years load at night in portions: ${data.data.stocks} of ${data.data.shares} shares loaded. The model starts working at 500; the full load takes a night or two.`)}
		</p>
	</section>
{/if}

<div class="seg" role="radiogroup" aria-label={tx('Вариант', 'Variant')}>
	<button role="radio" aria-checked={variant === 'A'} class:on={variant === 'A'} onclick={() => setVariant('A')}>{tx('А. Рост цены', 'A. Price rise')}</button>
	<button role="radio" aria-checked={variant === 'B'} class:on={variant === 'B'} onclick={() => setVariant('B')}>{tx('Б. Против рынка', 'B. Against the market')}</button>
	<HelpIcon topicKey="model.variants" label={tx('варианты', 'variants')} />
</div>

<div class="quarters" role="radiogroup" aria-label={tx('Квартал', 'Quarter')}>
	{#each [1, 2, 3, 4] as q (q)}
		<button role="radio" aria-checked={quarter === q} class:on={quarter === q} onclick={() => setQuarter(q)}>{label}{q}</button>
	{/each}
</div>

{#if params}
	<section class="card params">
		<h2>{tx('Параметры', 'Parameters')} {#if busy}<span class="muted small">· {tx('считаю…', 'computing…')}</span>{/if}</h2>
		{#each PARAMS as f (f.key)}
			<div class="prow">
				<span class="pl">{tx(f.ru, f.en)} <HelpIcon topicKey={f.help} label={tx(f.ru, f.en)} /></span>
				<span class="stepper">
					<button aria-label="−" disabled={Number(params[f.key]) <= f.min} onclick={() => set(f.key, Math.max(f.min, Number(params![f.key]) - f.step) as never)}>−</button>
					<b>{params[f.key]}</b>
					<button aria-label="+" disabled={Number(params[f.key]) >= (f.key === 'k' ? params.years : f.max)} onclick={() => set(f.key, Math.min(f.key === 'k' ? params!.years : f.max, Number(params![f.key]) + f.step) as never)}>+</button>
				</span>
			</div>
		{/each}
		<div class="prow">
			<span class="pl">{tx('Оборот в день, не меньше', 'Daily turnover, at least')} <HelpIcon topicKey="model.param.min_turnover" label={tx('оборот', 'turnover')} /></span>
			<select value={params.minTurnoverUsd} onchange={(e) => set('minTurnoverUsd', Number(e.currentTarget.value))}>
				{#each TURNOVER as t (t)}<option value={t}>{t ? money(t) : tx('без порога', 'no threshold')}</option>{/each}
			</select>
		</div>
		<div class="prow">
			<span class="pl">{tx('Сортировка', 'Sort by')} <HelpIcon topicKey="model.param.sort" label={tx('сортировка', 'sort')} /></span>
			<select value={params.sort} onchange={(e) => set('sort', e.currentTarget.value as Params['sort'])}>
				<option value="mean">{tx('по среднему', 'mean')}</option>
				<option value="median">{tx('по медиане', 'median')}</option>
				<option value="worst">{tx('по худшему году', 'worst year')}</option>
			</select>
		</div>
		{#if variant === 'B'}
			<div class="prow">
				<span class="pl">{tx('Сравнивать', 'Compare with')} <HelpIcon topicKey="model.param.compare_with" label={tx('сравнение', 'comparison')} /></span>
				<select value={params.compareWith} onchange={(e) => set('compareWith', e.currentTarget.value as Params['compareWith'])}>
					<option value="market">{tx('с рынком', 'the market')}</option>
					<option value="sector">{tx('с сектором', 'the sector')}</option>
				</select>
			</div>
		{/if}
		{#if changed}
			<div class="save">
				<button class="primary" onclick={save}>{tx('Сохранить параметры', 'Save the parameters')}</button>
				<button class="ghost" onclick={() => ((params = { ...data!.saved }), load(false))}>{tx('Вернуть сохранённые', 'Back to the saved')}</button>
			</div>
			<p class="muted small">{tx('Меняйте параметры не чаще раза в квартал и до его начала: новая версия параметров — новая строка в статистике.', 'Change the parameters at most once a quarter and before it starts: a new version is a new row in the stats.')}</p>
		{/if}
	</section>
{/if}

{#if res}
	<section class="card">
		<h2>
			{tx('Кандидаты', 'Candidates')} Q{res.quarter} {res.forYear}
			<HelpIcon topicKey="model.quarterly" label={tx('как считается', 'how it is computed')} />
		</h2>
		<p class="sum">
			{tx('Выборка', 'Universe')} <b>{res.universe}</b> {tx('акций', 'shares')} · {tx('прошли фильтр', 'passed')} <b>{res.passed}</b> · {tx('случайно прошло бы', 'by chance')} ≈ <b>{res.expected}</b>
			<HelpIcon topicKey="model.chance" label={tx('случайность', 'chance')} />
		</p>
		<p class="muted small">
			{tx(`Годы ${res.years[0]}–${res.years.at(-1)}, данные по ${res.dataMonth}; без 10 лет истории — ${res.noHistory}, мало оборота или дешевле порога — ${res.illiquid}; доля растущих кварталов ${Math.round(res.p * 100)}%.`, `Years ${res.years[0]}–${res.years.at(-1)}, data to ${res.dataMonth}; without the full history — ${res.noHistory}, too little turnover or too cheap — ${res.illiquid}; share of rising quarters ${Math.round(res.p * 100)}%.`)}
			{#if data}· {data.ms} {tx('мс', 'ms')}{/if}
		</p>
		{#if verdict === 'chance'}
			<p class="warn">{tx('Прошло не сильно больше, чем прошло бы случайно: кандидаты этого варианта могут быть просто везением.', 'Not much more passed than would by chance: these candidates may be plain luck.')}</p>
		{:else if verdict === 'none'}
			<p class="warn">{tx('Фильтр не прошла ни одна бумага — ослабьте K или пороги.', 'No share passed — lower K or the thresholds.')}</p>
		{/if}
		{#if res.capped}<p class="muted small">{tx(`Ещё ${res.capped} прошли, но не вошли из-за ограничений по сектору и рынку.`, `${res.capped} more passed but were left out by the sector and market caps.`)}</p>{/if}
		<ul class="cands">
			{#each res.candidates as c, i (c.id)}
				<li>
					<button class="crow" onclick={() => goto(`/security/${c.id}?model=${variant}&q=${res.quarter}&${previewQuery()}`)}>
						<span class="n">{i + 1}</span>
						<span class="who"><b>{c.symbol}</b><span class="muted small block name">{c.name}</span><span class="muted small block">{c.market === 'US' ? tx('США', 'US') : tx('Израиль', 'Israel')} · {c.sector ? sectorName(c.sector, tx) : tx('сектор неизвестен', 'sector unknown')} · {c.up}/{res.years.length}</span></span>
						<span class="nums"><b class:up={c.mean > 0}>{pct(c.mean)}</b><span class="muted small block">{tx('мед.', 'med.')} {pct(c.median)}</span><span class="muted small block">{tx('худш.', 'worst')} {pct(c.worst)}</span></span>
					</button>
				</li>
			{/each}
		</ul>
	</section>

	{#if res.walk.length}
		<section class="card">
			<h2>{tx('Проверка без подглядывания', 'Check without peeking')} <HelpIcon topicKey="model.walk" label={tx('проверка', 'check')} /></h2>
			<table class="walk">
				<thead><tr><th>{tx('Год', 'Year')}</th><th>{tx('Выбрано', 'Picked')}</th><th>{tx('Они', 'They')}</th><th>{tx('Все', 'All')}</th></tr></thead>
				<tbody>
					{#each res.walk as w (w.year)}
						<tr><td>{w.year}</td><td>{w.picked} ({w.pickedUp}▲)</td><td class:up={(w.pickedMean ?? 0) > (w.allMean ?? 0)}>{pct(w.pickedMean)}</td><td>{pct(w.allMean)}</td></tr>
					{/each}
				</tbody>
			</table>
			<p class="muted small">{tx('Кандидаты выбраны по 7 годам до проверяемого и измерены в нём. Только для справки: в базе нет бумаг, исчезнувших за эти годы, поэтому прошлое выглядит лучше, чем было.', 'Candidates chosen on the 7 years before the tested one and measured in it. For reference only: shares that vanished in those years are not in the base, so the past looks better than it was.')}</p>
		</section>
	{/if}
{/if}

{#if data?.recorded.length}
	<section class="card">
		<h2>{tx('Записанные кварталы', 'Recorded quarters')}</h2>
		<ul class="plain">
			{#each data.recorded as r (r.variant + r.quarter)}
				<li>{r.quarter} · {r.variant === 'A' ? tx('А. Рост цены', 'A. Price rise') : tx('Б. Против рынка', 'B. Against the market')} · {tx('гипотез', 'hypotheses')} {r.hypotheses}</li>
			{/each}
		</ul>
		<p class="muted small"><a href="/sources">{tx('Статистика вариантов — в «Источниках»', 'Variant stats — in «Sources»')}</a></p>
	</section>
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
	h2 {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 0 var(--s2);
		font-size: var(--fs-l);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.block {
		display: block;
	}
	.seg,
	.quarters {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: var(--s3);
	}
	.seg button,
	.quarters button {
		flex: 1;
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg button.on,
	.quarters button.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
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
	select {
		min-height: 36px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: var(--fs-s);
	}
	.save {
		display: flex;
		gap: var(--s2);
		margin-top: var(--s3);
	}
	.save button {
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
	.ghost {
		border: 1px solid var(--line);
		background: none;
		color: var(--text);
	}
	.sum {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin: 0 0 4px;
		font-size: var(--fs-s);
	}
	.warn {
		margin: var(--s2) 0;
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
		font-size: var(--fs-s);
	}
	.err {
		color: var(--down);
	}
	.cands,
	.plain {
		list-style: none;
		margin: var(--s2) 0 0;
		padding: 0;
	}
	.cands li {
		border-top: 1px solid var(--line);
	}
	.crow {
		display: grid;
		grid-template-columns: 22px 1fr auto;
		align-items: center;
		gap: var(--s2);
		width: 100%;
		min-height: 56px;
		padding: 6px 0;
		border: none;
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.who {
		min-width: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.n {
		color: var(--muted);
		font-size: var(--fs-xs);
	}
	.nums {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.up {
		color: var(--up);
	}
	.walk {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-s);
		font-variant-numeric: tabular-nums;
	}
	.walk th,
	.walk td {
		padding: 6px 4px;
		border-bottom: 1px solid var(--line);
		text-align: right;
	}
	.walk th:first-child,
	.walk td:first-child {
		text-align: left;
	}
	.plain li {
		padding: 4px 0;
		font-size: var(--fs-s);
	}
</style>
