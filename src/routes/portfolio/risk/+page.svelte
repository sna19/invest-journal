<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import TopBar from '#lib/TopBar.svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import RiskLabel from '#lib/RiskLabel.svelte';
	import TickerSearch, { type Security } from '#lib/TickerSearch.svelte';
	import { SECTORS, sectorName } from '#lib/allocation.js';
	import { loc, tx } from '#lib/i18n.js';
	import { whatIf, type WhatIf } from '#lib/risk.js';
	import ToJournal from '#lib/journal/ToJournal.svelte';

	/**
	 * T-023 «Риск» (Markowitz): how many independent bets the portfolio really has, how much it swings, how tied it is
	 * to the job; the map of ties; money against risk; and «Что если?» — the simulator recomputes on the phone.
	 */
	interface Sec {
		id: number;
		symbol: string;
		name: string;
		sector: string | null;
		exchange: string;
		role: 'held' | 'add' | 'job';
		weight: number;
		weeks: number;
		short: boolean;
		xy: [number, number];
	}
	interface View {
		currency: string;
		value: number;
		cash: number;
		years: number;
		weeks: number;
		delta: number;
		securities: Sec[];
		cov: number[][];
		corr: number[][];
		job: number | null;
		now: { vol: number; bets: number; job: number | null; held: number };
		rows: { id: number; money: number; risk: number }[];
		links: [number, number, number][];
		details: {
			rolling: { week: string; value: number }[];
			minRisk: { vol: number; bets: number; top: { id: number; w: number }[] };
			parity: { vol: number; bets: number; top: { id: number; w: number }[] };
		};
		loading: number[];
		employer: string | null;
	}
	interface Pick {
		id: number;
		symbol: string;
	}
	interface Scenario {
		id: number;
		name: string;
		data: { adds: Pick[]; amountPct: number; source: number | 'cash' };
	}

	// a portfolio, or «all» — all real portfolios together, in shekels (owner 26.11.2026)
	const pid = $derived(page.url.searchParams.get('p') === 'all' ? 'all' : Number(page.url.searchParams.get('p')));
	const isAll = $derived(pid === 'all');
	let ports = $state<{ id: number; name: string; kind: string; auto_source_id: number | null }[]>([]);
	let v = $state<View | null>(null);
	let problem = $state<string | null>(null);
	let years = $state(2);
	let selected = $state<number | null>(null);
	let adds = $state<Pick[]>([]);
	let amountPct = $state(5);
	let source = $state<number | 'cash'>('cash');
	let busy = $state(false);
	let quick = $state<{ group: string; items: Pick[] }[]>([]);
	let scenarios = $state<Scenario[]>([]);
	let employerEdit = $state<string | null>(null);

	async function load() {
		busy = true;
		const q = new URLSearchParams({ years: String(years) });
		if (adds.length) q.set('add', adds.map((a) => a.id).join(','));
		const r = await fetch(`/api/portfolios/${pid}/risk?${q}`).catch(() => null);
		busy = false;
		if (!r?.ok) return void (problem = tx('Нет связи с сервером.', 'No connection to the server.'));
		problem = null;
		v = await r.json();
		// a tried security without history: ask again when its days are loaded
		if (v!.loading.some((id) => adds.some((a) => a.id === id))) setTimeout(load, 20_000);
	}
	async function loadQuick() {
		const groups: { group: string; items: Pick[] }[] = [];
		const p = isAll ? null : await fetch(`/api/portfolios/${pid}`).then((r) => r.json()).catch(() => null);
		if (p?.positions) {
			const planned = (p.positions as { securityId: number; symbol: string; stage: string }[]).filter((x) => x.stage === 'watch' || x.stage === 'plan_buy');
			if (planned.length) groups.push({ group: tx('Наблюдаю и хочу купить', 'Watching and want to buy'), items: planned.map((x) => ({ id: x.securityId, symbol: x.symbol })) });
		}
		const m = await fetch('/api/model?variant=A').then((r) => r.json()).catch(() => null);
		if (m?.result?.candidates?.length) groups.push({ group: tx('Кандидаты модели А', 'Model A candidates'), items: (m.result.candidates as { id: number; symbol: string }[]).map((c) => ({ id: c.id, symbol: c.symbol })) });
		const h = await fetch('/api/hypotheses?status=open').then((r) => r.json()).catch(() => null);
		if (h?.items?.length) {
			const seen = new Set<number>();
			const items: Pick[] = [];
			for (const x of h.items as { h: { securityId: number; symbol: string; direction: string } }[])
				if (x.h.direction === 'long' && !seen.has(x.h.securityId)) (seen.add(x.h.securityId), items.push({ id: x.h.securityId, symbol: x.h.symbol }));
			if (items.length) groups.push({ group: tx('Открытые гипотезы', 'Open hypotheses'), items: items.slice(0, 20) });
		}
		quick = groups;
	}
	async function loadScenarios() {
		const r = await fetch(`/api/portfolios/${pid}/risk/scenarios`).then((r) => r.json()).catch(() => null);
		scenarios = r?.items ?? [];
	}
	onMount(async () => {
		void fetch('/api/portfolios').then((r) => r.json()).then((r) => (ports = (r.items ?? r ?? []).filter((x: { kind: string; auto_source_id: number | null }) => x.kind === 'real' && !x.auto_source_id))).catch(() => {});
		// from a security's card: that security is tried at once
		const pre = Number(page.url.searchParams.get('add'));
		if (pre) {
			const h = await fetch(`/api/securities?id=${pre}`).then((r) => r.json()).catch(() => null);
			if (h?.items?.[0]) adds = [{ id: pre, symbol: h.items[0].symbol }];
		}
		try {
			const y = Number(localStorage.getItem('risk-years'));
			if (y >= 1 && y <= 3) years = y;
		} catch {
			/* ignore */
		}
		void load();
		void loadQuick();
		if (!isAll) void loadScenarios();
	});
	function setYears(y: number) {
		years = y;
		try {
			localStorage.setItem('risk-years', String(y));
		} catch {
			/* ignore */
		}
		void load();
	}
	function addPick(p: Pick) {
		if (adds.some((a) => a.id === p.id) || adds.length >= 3) return;
		if (v?.securities.some((s) => s.id === p.id && s.role === 'held')) return;
		adds = [...adds, p];
		void load();
	}
	function removePick(id: number) {
		adds = adds.filter((a) => a.id !== id);
		void load();
	}
	async function saveScenario() {
		const name = prompt(tx('Название сценария', 'Scenario name'), adds.map((a) => a.symbol).join(' + '));
		if (!name) return;
		await fetch(`/api/portfolios/${pid}/risk/scenarios`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, data: { adds, amountPct, source } }) });
		void loadScenarios();
	}
	function openScenario(s: Scenario) {
		adds = s.data.adds.slice(0, 3);
		amountPct = s.data.amountPct;
		source = s.data.source;
		void load();
	}
	async function deleteScenario(id: number) {
		await fetch(`/api/portfolios/${pid}/risk/scenarios?id=${id}`, { method: 'DELETE' });
		void loadScenarios();
	}
	async function saveEmployer() {
		await fetch('/api/risk/employer', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: employerEdit ?? '' }) });
		employerEdit = null;
		void load();
	}

	// ── the numbers ────────────────────────────────────────────────────────────────
	const pctText = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d).replace('.', tx(',', '.'))}%`);
	const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : x.toFixed(d).replace('.', tx(',', '.')));
	const held = $derived(v ? v.securities.filter((s) => s.role === 'held') : []);
	const betsColor = (bets: number, n: number) => (n <= 1 ? 'warn' : bets / n >= 0.6 ? 'good' : bets / n >= 0.35 ? 'warn' : 'bad');
	const volColor = (vol: number) => (vol < 0.15 ? 'good' : vol < 0.25 ? 'warn' : 'bad');
	const jobColor = (j: number | null) => (j === null ? '' : j < 0.3 ? 'good' : j < 0.6 ? 'warn' : 'bad');

	// ── the simulator: recomputed here at every move of the slider ─────────────────────
	const sim = $derived.by<WhatIf | null>(() => (v && adds.length ? whatIf(v, adds.map((a) => a.id), amountPct / 100, source === 'cash' ? null : source) : null));
	const each = $derived.by(() =>
		v && adds.length
			? adds.map((a) => ({ ...a, w: whatIf(v!, [a.id], amountPct / 100, source === 'cash' ? null : source) })).sort((x, y) => y.w.after.bets - y.w.before.bets - (x.w.after.bets - x.w.before.bets) || x.w.after.vol - y.w.after.vol)
			: []
	);
	const gainMax = $derived(Math.max(...each.map((x) => x.w.after.bets - x.w.before.bets), 0));
	const gainMin = $derived(Math.min(...each.map((x) => x.w.after.bets - x.w.before.bets), 0) - 0.05);
	const moneyText = (x: number) => `${Math.round(x).toLocaleString(loc())} ${v?.currency === 'USD' ? '$' : '₪'}`;

	// ── the map ───────────────────────────────────────────────────────────────────
	const SECTOR_KEYS = Object.keys(SECTORS);
	const colorOf = (s: Sec) => (s.role === 'job' ? 'var(--text)' : s.sector && SECTOR_KEYS.includes(s.sector) ? `var(--series-${(SECTOR_KEYS.indexOf(s.sector) % 8) + 1})` : 'var(--series-muted)');
	const shown = $derived(v ? v.securities.filter((s) => s.role !== 'add' || adds.some((a) => a.id === s.id)) : []);
	const box = $derived.by(() => {
		const pts = shown.map((s) => s.xy);
		if (!pts.length) return { x0: -1, y0: -1, k: 1 };
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.2);
		return { x0: (Math.max(...xs) + Math.min(...xs)) / 2 - span / 2, y0: (Math.max(...ys) + Math.min(...ys)) / 2 - span / 2, k: 76 / span };
	});
	const px = (s: Sec): [number, number] => [12 + (s.xy[0] - box.x0) * box.k, 12 + (s.xy[1] - box.y0) * box.k];
	const radius = (s: Sec) => (s.role === 'job' ? 4 : s.role === 'add' ? 2.5 + Math.sqrt(amountPct / 100) * 14 : 2.5 + Math.sqrt(s.weight) * 14);
	const neighbours = $derived.by(() => {
		if (!v || selected === null) return [];
		const i = v.securities.findIndex((s) => s.id === selected);
		if (i < 0) return [];
		return v.securities
			.map((s, j) => ({ s, c: v!.corr[i][j] }))
			.filter((x, j) => j !== i && x.s.role !== 'add')
			.sort((a, b) => b.c - a.c)
			.slice(0, 3);
	});
	const bySym = (id: number) => v?.securities.find((s) => s.id === id)?.symbol ?? '';

	// ── details: the heat map colours ─────────────────────────────────────────────
	const heat = (c: number) => (c >= 0 ? `color-mix(in srgb, var(--down) ${Math.round(c * 85)}%, var(--surface))` : `color-mix(in srgb, var(--series-1) ${Math.round(-c * 85)}%, var(--surface))`);
	const roll = $derived.by(() => {
		const r = v?.details.rolling ?? [];
		if (r.length < 2) return '';
		return r.map((p, i) => `${(i / (r.length - 1)) * 100},${40 - ((p.value + 0.2) / 1.2) * 40}`).join(' ');
	});
</script>

<svelte:head><title>{tx('Риск', 'Risk')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Риск портфеля', 'Portfolio risk')} help="portfolio.risk_map" back={{ href: isAll ? '/portfolio' : `/portfolio?p=${pid}`, label: tx('Портфель', 'Portfolio') }} />

{#if ports.length > 1}
	<div class="pchips" role="radiogroup" aria-label={tx('Портфель', 'Portfolio')}>
		{#each ports as p (p.id)}
			<a role="radio" aria-checked={pid === p.id} class:on={pid === p.id} href="/portfolio/risk?p={p.id}{adds.length ? `&add=${adds[0].id}` : ''}" data-sveltekit-reload>{p.name}</a>
		{/each}
		<a role="radio" aria-checked={isAll} class:on={isAll} href="/portfolio/risk?p=all{adds.length ? `&add=${adds[0].id}` : ''}" data-sveltekit-reload>{tx('Все вместе', 'All together')}</a>
	</div>
{/if}

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if !v}
	<div class="skeleton tall"></div>
{:else if v.now.held === 0}
	<p class="muted">{tx('В портфеле нет позиций с ценами — риску не из чего считаться.', 'No positions with prices — nothing to count the risk from.')}</p>
{:else}
	<section class="nums" aria-label={tx('Три числа', 'Three numbers')}>
		<div class="n {betsColor(sim?.after.bets ?? v.now.bets, v.now.held)}">
			<b>{num(v.now.bets)}</b><span>{tx(`независимых ставок из ${v.now.held}`, `independent bets of ${v.now.held}`)}</span>
			{#if sim}<i>→ {num(sim.after.bets)}</i>{/if}
		</div>
		<div class="n {volColor(sim?.after.vol ?? v.now.vol)}">
			<b>±{pctText(v.now.vol, 0)}</b><span>{tx('колебания портфеля в год', 'the portfolio swings a year')}</span>
			{#if sim}<i>→ ±{pctText(sim.after.vol, 0)}</i>{/if}
		</div>
		<div class="n {jobColor(sim?.after.job ?? v.now.job)}">
			{#if v.job !== null}
				<b>{num(v.now.job, 2)}</b><span>{tx('связь с работой', 'tie to the job')} · {v.employer}</span>
				{#if sim}<i>→ {num(sim.after.job, 2)}</i>{/if}
			{:else}
				<b>—</b><span>{tx('связь с работой: бумага работодателя не задана', 'tie to the job: no employer share set')}</span>
			{/if}
		</div>
	</section>
	<p class="muted small">
		{tx(`По недельным ценам за ${v.years} г. в ${v.currency === 'USD' ? 'долларах' : 'шекелях'}; деньги на счёте — без риска.`, `Weekly prices over ${v.years} y in ${v.currency === 'USD' ? 'dollars' : 'shekels'}; cash counts as riskless.`)}
		{#each [1, 2, 3] as y (y)}<button class="textbtn" class:on={years === y} aria-pressed={years === y} onclick={() => setYears(y)}>{y} {tx('г.', 'y')}</button>{/each}
		{#if busy}· {tx('считаю…', 'computing…')}{/if}
	</p>
	<p class="muted small">
		{#if employerEdit === null}
			{tx('Бумага работодателя', 'Employer share')}: <b>{v.employer ?? tx('нет', 'none')}</b> <button class="textbtn" onclick={() => (employerEdit = v!.employer ?? '')}>{tx('изменить', 'change')}</button>
		{:else}
			<input class="emp" bind:value={employerEdit} placeholder="AMAT" aria-label={tx('Тикер работодателя', 'Employer ticker')} />
			<button class="textbtn" onclick={saveEmployer}>{tx('сохранить', 'save')}</button>
		{/if}
	</p>

	<Fold key="risk-map" title={tx('Карта связей', 'Map of ties')} summary={tx(`${v.links.length} сильных связей`, `${v.links.length} strong ties`)}>
		{#snippet aside()}<HelpIcon topicKey="portfolio.risk_map" label={tx('карта риска', 'risk map')} />{/snippet}
		<svg class="map" viewBox="0 0 100 100" role="img" aria-label={tx('Карта связей позиций', 'Map of the positions\' ties')}>
			{#each v.links as [a, b, c] (a + '-' + b)}
				{@const pa = px(v.securities[a])}
				{@const pb = px(v.securities[b])}
				<line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} class="link" style:stroke-width={0.2 + (c - 0.7) * 2} />
			{/each}
			{#each shown as s (s.id)}
				{@const p = px(s)}
				<g class="node" class:ghost={s.role === 'add'} class:job={s.role === 'job'} class:sel={selected === s.id} role="button" tabindex="0" aria-label={s.symbol} onclick={() => (selected = selected === s.id ? null : s.id)} onkeydown={(e) => e.key === 'Enter' && (selected = s.id)}>
					<circle cx={p[0]} cy={p[1]} r={radius(s)} fill={s.role === 'job' ? 'none' : colorOf(s)} />
					<text x={p[0]} y={p[1] + radius(s) + 3}>{s.role === 'job' ? tx('работа', 'job') + ' · ' + s.symbol : s.symbol}{s.short ? '*' : ''}</text>
				</g>
			{/each}
		</svg>
		{#if selected !== null && neighbours.length}
			<p class="small">{tx('Сильнее всего связана', 'Most tied')} <b>{bySym(selected)}</b>: {#each neighbours as x, i (x.s.id)}{i ? ' · ' : ''}{x.s.symbol} {num(x.c, 2)}{/each}</p>
		{:else}
			<p class="muted small">{tx('Близко — значит движутся вместе; линия — связь выше 0,7. Скопление кругов — одна ставка. Тап по кругу — его самые связанные соседи.', 'Close means they move together; a line — a tie above 0.7. A cluster of circles is one bet. Tap a circle — its most tied neighbours.')}{#if v.securities.some((s) => s.short)} {tx('* — меньше года истории.', '* — under a year of history.')}{/if}</p>
		{/if}
	</Fold>

	<Fold key="risk-rows" title={tx('Деньги против риска', 'Money against risk')} summary={tx('доля денег и доля риска каждой позиции', 'each position\'s share of money and of risk')}>
		<ul class="rows">
			{#each v.rows as r (r.id)}
				<li>
					<span class="sym">{bySym(r.id)}</span>
					<span class="bars">
						<span class="bar money" style:width="{Math.min(100, r.money * 100 * 2)}%"></span>
						<span class="bar risk" class:over={r.risk > r.money * 1.3} style:width="{Math.min(100, Math.max(0, r.risk) * 100 * 2)}%"></span>
					</span>
					<span class="vals small">{pctText(r.money, 0)} / <b class:over={r.risk > r.money * 1.3}>{pctText(r.risk, 0)}</b></span>
				</li>
			{/each}
		</ul>
		<p class="muted small"><span class="key money"></span> {tx('доля денег', 'share of money')} · <span class="key risk"></span> {tx('доля риска. Выше — позиции, где риска заметно больше, чем денег.', 'share of risk. On top — where the risk is clearly larger than the money.')}</p>
	</Fold>

	<Fold key="risk-whatif" title={tx('Что если?', 'What if?')} summary={adds.length ? adds.map((a) => a.symbol).join(' + ') : tx('выберите 1–3 бумаги', 'pick 1–3 securities')}>
		{#snippet aside()}<HelpIcon topicKey="portfolio.whatif" label={tx('что если', 'what if')} />{/snippet}
		{#key adds.length}<TickerSearch noIndex label={tx('Добавить бумагу', 'Add a security')} onselect={(s: Security) => addPick({ id: s.id, symbol: s.symbol })} />{/key}
		{#each quick as g (g.group)}
			<p class="muted small qg">{g.group}:</p>
			<div class="chips">
				{#each g.items as x (x.id)}<button class="chip" disabled={adds.length >= 3 || adds.some((a) => a.id === x.id)} onclick={() => addPick(x)}>{x.symbol}</button>{/each}
			</div>
		{/each}
		{#if adds.length}
			<div class="picked">
				{#each adds as a (a.id)}<span class="chip on">{a.symbol} <button aria-label={tx('Убрать', 'Remove')} onclick={() => removePick(a.id)}>×</button></span>{/each}
			</div>
			<label class="slider">
				<span>{tx('Сумма на каждую', 'Amount each')}: <b>{amountPct}%</b> · {moneyText((v.value * amountPct) / 100)}</span>
				<input type="range" min="1" max="20" step="1" bind:value={amountPct} />
			</label>
			<label class="src">
				{tx('Деньги', 'Money')}
				<select bind:value={source}>
					<option value="cash">{tx('из свободных денег', 'from cash')}</option>
					{#each held as h (h.id)}<option value={h.id}>{tx('вместо', 'instead of')} {h.symbol}</option>{/each}
				</select>
			</label>
			{#if v.loading.some((id) => adds.some((a) => a.id === id))}<p class="muted small">{tx('У части бумаг грузится дневная история — числа появятся через минуту.', 'Some securities\' daily history is loading — the numbers come in a minute.')}</p>{/if}
			{#if sim}
				<table class="was">
					<thead><tr><th></th><th>{tx('Было', 'Was')}</th><th>{tx('Стало', 'Becomes')}</th></tr></thead>
					<tbody>
						<tr><td>{tx('Независимых ставок', 'Independent bets')}</td><td>{num(sim.before.bets)}</td><td class:good={sim.after.bets > sim.before.bets + 0.05} class:bad={sim.after.bets < sim.before.bets - 0.05}><b>{num(sim.after.bets)}</b></td></tr>
						<tr><td>{tx('Колебания в год', 'Swings a year')}</td><td>±{pctText(sim.before.vol)}</td><td class:good={sim.after.vol < sim.before.vol} class:bad={sim.after.vol > sim.before.vol}><b>±{pctText(sim.after.vol)}</b></td></tr>
						{#if v.job !== null}<tr><td>{tx('Связь с работой', 'Tie to the job')}</td><td>{num(sim.before.job, 2)}</td><td class:good={(sim.after.job ?? 0) < (sim.before.job ?? 0)} class:bad={(sim.after.job ?? 0) > (sim.before.job ?? 0)}><b>{num(sim.after.job, 2)}</b></td></tr>{/if}
					</tbody>
				</table>
				<ToJournal
					links={adds.map((a) => ({ type: 'security', id: String(a.id), label: a.symbol }))}
					snapshot={() => ({
						type: 'scenario',
						params: { amountPct, source: source === 'cash' ? 'cash' : (held.find((h) => h.id === source)?.symbol ?? String(source)), adds: adds.map((a) => a.symbol) },
						data: { before: sim!.before, after: sim!.after, each: each.map((x) => ({ symbol: x.symbol, label: x.w.label, bets: x.w.after.bets, vol: x.w.after.vol })) }
					})}
				/>
				<ul class="each">
					{#each each as x (x.id)}
						<li>
							<b>{x.symbol}</b>
							<RiskLabel label={x.w.label} twin={x.w.twin?.symbol} />
							{#if adds.length > 1}<span class="bar2" style:width="{Math.max(3, ((x.w.after.bets - x.w.before.bets - gainMin) / Math.max(1e-6, gainMax - gainMin)) * 100)}%"></span>{/if}
							<span class="muted small">{tx('ставок', 'bets')} {num(x.w.after.bets)} · ±{pctText(x.w.after.vol)} · {tx('связь с портфелем', 'tie to the portfolio')} {num(x.w.portfolioCorr, 2)}{#if x.w.twin}{' · '}{tx('ближе всех', 'closest')} {x.w.twin.symbol} {num(x.w.twin.corr, 2)}{/if}</span>
							<span class="acts">
								<a href="/portfolio?{isAll ? '' : `p=${pid}&`}add={x.id}&kind=plan_buy&note={encodeURIComponent(tx('сценарий «Что если?»: ', 'scenario «What if?»: ') + adds.map((a) => a.symbol).join(' + ') + `, ${amountPct}%`)}">{tx('Хочу купить', 'Want to buy')}</a>
								<a href="/portfolio?{isAll ? '' : `p=${pid}&`}add={x.id}&kind=buy&note={encodeURIComponent(tx('сценарий «Что если?»: ', 'scenario «What if?»: ') + adds.map((a) => a.symbol).join(' + ') + `, ${amountPct}%`)}">{tx('Купил', 'Bought')}</a>
							</span>
						</li>
					{/each}
				</ul>
				{#if adds.length > 1}<p class="muted small">{tx('Порядок — по вкладу в независимые ставки: сверху та, что диверсифицирует больше.', 'Order — by the gain in independent bets: on top the one that diversifies more.')}</p>{/if}
				{#if !isAll}<button class="textbtn" onclick={saveScenario}>{tx('Сохранить сценарий', 'Save the scenario')}</button>{/if}
			{/if}
		{/if}
		{#if scenarios.length}
			<p class="muted small qg">{tx('Сохранённые сценарии', 'Saved scenarios')}:</p>
			<ul class="scen">
				{#each scenarios as s (s.id)}
					<li><button class="textbtn" onclick={() => openScenario(s)}>{s.name}</button> <button class="textbtn del" aria-label={tx('Удалить', 'Delete')} onclick={() => deleteScenario(s.id)}>×</button></li>
				{/each}
			</ul>
		{/if}
	</Fold>

	<Fold key="risk-details" title={tx('Подробнее', 'More')} open={false} summary={tx('корреляции, их рост в падения, минимальный риск', 'correlations, their rise in falls, minimal risk')}>
		<p class="small">{tx('Корреляции позиций', 'Correlations of the positions')}:</p>
		<div class="scroll">
			<table class="heat">
				<thead><tr><th></th>{#each held as h (h.id)}<th>{h.symbol}</th>{/each}</tr></thead>
				<tbody>
					{#each held as a (a.id)}
						{@const i = v.securities.indexOf(a)}
						<tr>
							<th>{a.symbol}</th>
							{#each held as b (b.id)}
								{@const j = v.securities.indexOf(b)}
								<td style:background={i === j ? 'var(--bg)' : heat(v.corr[i][j])}>{i === j ? '' : num(v.corr[i][j], 1)}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if roll}
			<p class="small">{tx('Средняя корреляция пар, скользящие полгода:', 'The pairs\' mean correlation, rolling half-year:')} {num(v.details.rolling[0].value, 2)} → <b>{num(v.details.rolling.at(-1)!.value, 2)}</b></p>
			<svg class="roll" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={tx('Скользящая средняя корреляция', 'Rolling mean correlation')}>
				<line x1="0" x2="100" y1={40 - (0.2 / 1.2) * 40} y2={40 - (0.2 / 1.2) * 40} class="zero" />
				<polyline points={roll} />
			</svg>
			<p class="muted small">{tx('Если линия растёт в падения рынка — диверсификация слабеет именно тогда, когда нужна.', 'If the line rises in market falls, diversification weakens exactly when it is needed.')}</p>
		{/if}
		<table class="was">
			<thead><tr><th></th><th>{tx('Колебания', 'Swings')}</th><th>{tx('Ставок', 'Bets')}</th></tr></thead>
			<tbody>
				<tr><td>{tx('Сейчас (вложенная часть)', 'Now (invested part)')}</td><td>±{pctText(Math.sqrt(held.reduce((s, a) => s + held.reduce((t, b) => t + (a.weight / held.reduce((n, x) => n + x.weight, 0)) * (b.weight / held.reduce((n, x) => n + x.weight, 0)) * v!.cov[v!.securities.indexOf(a)][v!.securities.indexOf(b)], 0), 0)))}</td><td>{num(v.now.bets)}</td></tr>
				<tr><td>{tx('Минимальный риск', 'Minimal risk')}</td><td>±{pctText(v.details.minRisk.vol)}</td><td>{num(v.details.minRisk.bets)}</td></tr>
				<tr><td>{tx('Паритет риска', 'Risk parity')}</td><td>±{pctText(v.details.parity.vol)}</td><td>{num(v.details.parity.bets)}</td></tr>
			</tbody>
		</table>
		<p class="muted small">{tx('Из тех же бумаг, не больше 15% на бумагу. Крупнейшие доли минимального риска', 'From the same securities, at most 15% each. The largest weights of minimal risk')}: {v.details.minRisk.top.slice(0, 5).map((x) => `${bySym(x.id)} ${pctText(x.w, 0)}`).join(' · ')}</p>
		<p class="muted small">{tx(`Ковариация: недельные доходности, сжатие Ледуа–Вольфа δ = ${num(v.delta, 2)}. Дивиденды в ценах не учтены.`, `Covariance: weekly returns, Ledoit–Wolf shrinkage δ = ${num(v.delta, 2)}. Dividends are not in the prices.`)}</p>
	</Fold>
{/if}

<style>
	.pchips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 var(--s3);
	}
	.pchips a {
		padding: 4px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
		font-size: var(--fs-xs);
	}
	.pchips a.on {
		background: var(--text);
		color: var(--bg);
		border-color: var(--text);
	}
	.nums {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--s2);
		margin: 0 0 var(--s2);
	}
	.n {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3) var(--s2);
		border-radius: var(--r3);
		background: var(--surface);
		border-top: 4px solid var(--line);
	}
	.n b {
		font-size: 1.6rem;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.n span {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.n i {
		font-style: normal;
		font-weight: 600;
		font-size: var(--fs-s, 0.9rem);
	}
	.n.good {
		border-top-color: var(--up);
	}
	.n.warn {
		border-top-color: var(--warn-text);
	}
	.n.bad {
		border-top-color: var(--down);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.textbtn {
		border: none;
		background: none;
		padding: 0 4px;
		color: var(--link);
		cursor: pointer;
		font: inherit;
	}
	.textbtn.on {
		color: var(--text);
		font-weight: 700;
	}
	.emp {
		width: 6em;
		min-height: 30px;
		padding: 0 var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
	}
	.map {
		width: 100%;
		max-width: 420px;
		display: block;
		margin: 0 auto;
		aspect-ratio: 1;
	}
	.map .link {
		stroke: var(--muted);
		opacity: 0.6;
	}
	.node {
		cursor: pointer;
	}
	.node circle {
		stroke: var(--surface);
		stroke-width: 0.5;
		opacity: 0.85;
	}
	.node.sel circle {
		stroke: var(--text);
		stroke-width: 0.8;
	}
	.node.job circle {
		stroke: var(--text);
		stroke-width: 0.6;
		stroke-dasharray: 1 0.8;
	}
	.node.ghost circle {
		opacity: 0.35;
		stroke: var(--text);
		stroke-dasharray: 1 0.8;
		stroke-width: 0.5;
	}
	.node text {
		font-size: 3px;
		text-anchor: middle;
		fill: var(--text);
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		display: grid;
		grid-template-columns: 4.5em 1fr 6.5em;
		align-items: center;
		gap: var(--s2);
		padding: 4px 0;
	}
	.sym {
		font-weight: 600;
		font-size: var(--fs-s, 0.9rem);
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bar {
		height: 6px;
		border-radius: 3px;
		min-width: 2px;
	}
	.bar.money,
	.key.money {
		background: var(--series-muted);
	}
	.bar.risk,
	.key.risk {
		background: var(--series-1);
	}
	.bar.risk.over {
		background: var(--down);
	}
	.key {
		display: inline-block;
		width: 10px;
		height: 6px;
		border-radius: 3px;
	}
	.vals {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	b.over {
		color: var(--down);
	}
	.qg {
		margin: var(--s2) 0 4px;
	}
	.chips,
	.picked {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		min-height: 32px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-xs);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.chip.on {
		background: var(--text);
		color: var(--bg);
		border-color: var(--text);
	}
	.chip.on button {
		border: none;
		background: none;
		color: inherit;
		font-size: 1rem;
		cursor: pointer;
	}
	.picked {
		margin: var(--s3) 0 var(--s2);
	}
	.slider {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: var(--s2) 0;
	}
	.slider input {
		width: 100%;
	}
	.src select {
		margin-left: var(--s2);
		min-height: 32px;
	}
	.was {
		width: 100%;
		border-collapse: collapse;
		margin: var(--s3) 0;
		font-variant-numeric: tabular-nums;
	}
	.was th,
	.was td {
		padding: 6px 4px;
		border-bottom: 1px solid var(--line);
		text-align: right;
	}
	.was th:first-child,
	.was td:first-child {
		text-align: left;
	}
	td.good {
		color: var(--up);
	}
	td.bad {
		color: var(--down);
	}
	.each {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.each li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		padding: var(--s2) 0;
		border-bottom: 1px solid var(--line);
	}
	.bar2 {
		height: 6px;
		border-radius: 3px;
		background: var(--series-3);
		flex-basis: 100%;
		max-width: 100%;
	}
	.acts {
		margin-left: auto;
		display: flex;
		gap: var(--s3);
		font-size: var(--fs-xs);
	}
	.scen {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.del {
		color: var(--muted);
	}
	.scroll {
		overflow-x: auto;
	}
	.heat {
		border-collapse: collapse;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.heat th,
	.heat td {
		padding: 3px 4px;
		text-align: center;
		white-space: nowrap;
	}
	.roll {
		width: 100%;
		height: 60px;
	}
	.roll polyline {
		fill: none;
		stroke: var(--series-1);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.roll .zero {
		stroke: var(--line);
		vector-effect: non-scaling-stroke;
	}
</style>
