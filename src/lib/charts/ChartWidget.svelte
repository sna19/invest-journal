<script lang="ts" module>
	export interface ChartConfig {
		period: string;
		sma: string[];
		shown: number[];
		peers: number[];
		highlight: number | null;
	}
	export interface ChartData {
		monthly: boolean;
		security: { id: number; symbol: string; name: string; exchange: string; currency: string; priceUnit: string; type?: string };
		benchmark: { id: number; label: string } | null;
		points: { date: string; value: number }[];
		sma: Record<'20' | '50' | '200', { date: string; value: number }[]> | null;
		bench: { date: string; value: number }[];
	}
	export interface CmpRef {
		role: 'sector' | 'industry' | 'index';
		label: string;
		id: number;
		symbol: string;
		name: string;
		exchange: string;
		returns: Record<string, number | null>;
		loaded: boolean;
		corr?: number | null;
		vol?: number | null;
	}
	export const PERIODS = [
		['1M', '1М', '1M'],
		['3M', '3М', '3M'],
		['6M', '6М', '6M'],
		['1Y', '1Г', '1Y'],
		['5Y', '5Л', '5Y'],
		['10Y', '10Л', '10Y']
	] as const;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount, untrack } from 'svelte';
	import { tl, tx } from '../i18n.js';
	import { priceText } from '../portfolio.js';
	import { sectorName } from '../allocation.js';
	import HelpIcon from '../HelpIcon.svelte';
	import Sheet from '../Sheet.svelte';
	import TickerSearch, { type Security } from '../TickerSearch.svelte';
	import LineChart, { type Line, type Mark } from './LineChart.svelte';
	import { showToast } from '../toast.svelte.js';

	/**
	 * Owner 27.11.2026: one chart widget everywhere — a security's card and «Сохранённые графики». The period, the SMAs,
	 * the security's references (sector, industry, indices) with their correlation, any shares added to compare (shown
	 * or not), the shaded quarter; the legend's names link to each security. All of it is saved as a chart, opened,
	 * changed and saved again (or as a new one).
	 *
	 * Two ways to feed it: `data` + `onperiod` — the card loads the chart itself (it needs the same data for its other
	 * blocks); without `data` — the widget loads it.
	 */
	interface Props {
		securityId: number;
		/** where to start; on the card also the remembered choices of this device */
		config?: Partial<ChartConfig>;
		/** the card's own data of the period, and how it asks for another period */
		data?: ChartData | null;
		onperiod?: (p: string) => void;
		/** the card's references (the table «С чем сравнить» uses them too) */
		refs?: CmpRef[] | null;
		marks?: Mark[];
		onmarker?: (id: string) => void;
		/** remember the choices on this device (the card) */
		persist?: boolean;
		/** the quarter «Подсветить квартал» shades (the model's one, or the current) */
		quarter?: number;
		/** a saved chart being shown: «Сохранить изменения» / «Сохранить как новый» */
		saved?: { id: number; name: string } | null;
		onsaved?: (chart: { id: number; name: string }) => void;
		below?: Snippet<[Line[]]>;
	}
	let { securityId, config = {}, data = undefined, onperiod, refs = undefined, marks = [], onmarker, persist = false, quarter, saved = null, onsaved, below }: Props = $props();

	// ── the state of the chart ────────────────────────────────────────────────────────────────────────────
	let period = $state(untrack(() => config.period ?? '1Y'));
	let smaOn = $state<string[]>(untrack(() => config.sma ?? []));
	let shown = $state<number[]>(untrack(() => config.shown ?? []));
	let mine = $state<number[]>(untrack(() => config.peers ?? []));
	let highlight = $state<number | null>(untrack(() => config.highlight ?? null));
	const current = (): ChartConfig => ({ period: data !== undefined ? (config.period ?? period) : period, sma: smaOn, shown, peers: mine, highlight });
	// the card's period is its own: follow it
	$effect(() => {
		if (data !== undefined && config.period) period = config.period;
	});

	const key = (k: string) => `${k}:${securityId}`;
	function remember() {
		if (!persist) return;
		try {
			localStorage.setItem('chart-sma', JSON.stringify(smaOn));
			localStorage.setItem(key('chart-shown'), JSON.stringify(shown));
			localStorage.setItem(key('cmp-peers'), JSON.stringify(mine));
		} catch {
			/* ignore */
		}
	}

	// ── the data ──────────────────────────────────────────────────────────────────────────────────────────
	let own = $state<ChartData | null>(null);
	const c = $derived(data !== undefined ? data : own);
	async function loadOwn() {
		const r = await fetch(`/api/securities/${securityId}/chart?period=${period}`).catch(() => null);
		if (r?.ok) own = await r.json();
	}
	let cmpOwn = $state<CmpRef[] | null>(null);
	const refList = $derived(refs !== undefined ? (refs ?? []) : (cmpOwn ?? []));
	let refLines = $state<Record<number, { date: string; value: number }[]>>({});
	async function loadRefLine(id: number) {
		const r = await fetch(`/api/securities/${id}/chart?period=${period}`).catch(() => null);
		if (!r?.ok) return;
		const j = await r.json();
		refLines = { ...refLines, [id]: j.points };
	}

	type Peer = { id: number; symbol: string; name: string; exchange: string; industry: string | null; same: 'industry' | 'sector' | 'asked'; corr: number | null; loaded: boolean };
	let peers = $state<{ industry: string | null; sector: string | null; peers: Peer[] } | null>(null);
	async function loadPeers() {
		const r = await fetch(`/api/securities/${securityId}/peers${mine.length ? `?with=${mine.join(',')}` : ''}`).catch(() => null);
		if (r?.ok) peers = await r.json();
	}
	const peerOf = (id: number) => peers?.peers.find((p) => p.id === id) ?? null;

	// owner 27.11.2026: the saved charts this security takes part in — links under its chart
	let withMe = $state<{ id: number; name: string }[]>([]);
	async function loadWithMe() {
		const r = await fetch(`/api/charts?security=${securityId}`).catch(() => null);
		if (r?.ok) withMe = ((await r.json()).items as { id: number; name: string }[]).filter((x) => x.id !== savedAs?.id);
	}
	onMount(() => {
		void loadWithMe();
		if (persist) {
			try {
				if (!config.sma) {
					const v = JSON.parse(localStorage.getItem('chart-sma') ?? '[]');
					if (Array.isArray(v)) smaOn = v.filter((x) => ['20', '50', '200'].includes(x));
				}
				if (!config.shown) {
					const v = JSON.parse(localStorage.getItem(key('chart-shown')) ?? '[]');
					if (Array.isArray(v)) shown = v.filter((x) => Number.isInteger(x) && x > 0).slice(0, 20);
				}
				if (!config.peers) {
					const v = JSON.parse(localStorage.getItem(key('cmp-peers')) ?? '[]');
					if (Array.isArray(v)) mine = v.filter((x) => Number.isInteger(x) && x > 0).slice(0, 12);
				}
			} catch {
				/* ignore */
			}
		}
		if (data === undefined) void loadOwn();
		if (refs === undefined)
			void fetch(`/api/securities/${securityId}/compare`)
				.then((r) => (r.ok ? r.json() : null))
				.then((j) => (cmpOwn = j?.refs ?? []))
				.catch(() => (cmpOwn = []));
		void loadPeers();
		for (const id of shown) void loadRefLine(id);
	});

	// ── the choices ───────────────────────────────────────────────────────────────────────────────────────
	function setPeriod(p: string) {
		period = p;
		refLines = {};
		for (const id of shown) void loadRefLine(id);
		if (onperiod) onperiod(p);
		else void loadOwn();
	}
	function toggleSma(n: string) {
		smaOn = smaOn.includes(n) ? smaOn.filter((x) => x !== n) : [...smaOn, n];
		remember();
	}
	function toggleRef(id: number) {
		shown = shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id];
		if (shown.includes(id)) void loadRefLine(id);
		remember();
	}
	let picking = $state(false);
	/** at most 8 shares added: beyond that the lines merge on a phone and the colours stop being told apart */
	const MAX_PEERS = 8;
	function addPeer(id: number) {
		if (id === securityId) return;
		if (!mine.includes(id) && mine.length >= MAX_PEERS) return void showToast(tx(`Не больше ${MAX_PEERS} акций на графике — убери одну`, `At most ${MAX_PEERS} shares on a chart — remove one`));
		if (!mine.includes(id)) mine = [...mine, id];
		if (!shown.includes(id)) toggleRef(id);
		remember();
		void loadPeers();
	}
	function removePeer(id: number) {
		mine = mine.filter((x) => x !== id);
		shown = shown.filter((x) => x !== id);
		remember();
	}
	function toggleHighlight() {
		const q = quarter ?? Math.floor(new Date().getMonth() / 3) + 1;
		highlight = highlight ? null : q;
		if (highlight && period !== '10Y') setPeriod('10Y');
	}

	// ── the lines ─────────────────────────────────────────────────────────────────────────────────────────
	const ROLE: Record<CmpRef['role'], [string, string]> = { sector: ['Сектор', 'Sector'], industry: ['Отрасль', 'Industry'], index: ['Индекс', 'Index'] };
	const refLabel = (r: CmpRef) => (r.role === 'sector' ? sectorName(r.label, tx) : r.label);
	const corrText = (x: number | null | undefined) => (x === null || x === undefined ? '' : x.toFixed(2).replace('.', tx(',', '.')));
	/** a compared line brought to the security's first close of the period: both start at one point */
	function scaled(points: { date: string; value: number }[]) {
		if (!c?.points.length || !points.length) return [];
		const start = c.points[0];
		const base = [...points].reverse().find((p) => p.date <= start.date) ?? points[0];
		return points.filter((p) => p.date >= start.date).map((p) => ({ date: p.date, value: Math.round((p.value / base.value) * start.value * 10000) / 10000 }));
	}
	const css = (n: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(n).trim());
	const lines = $derived<Line[]>(
		c
			? [
					{ key: 'sec', label: c.security.symbol, points: c.points, main: true },
					...(c.benchmark && c.bench.length ? [{ key: 'bench', label: tl(c.benchmark.label), points: c.bench, color: css('--muted'), dashed: true, href: `/security/${c.benchmark.id}` }] : []),
					...(['20', '50', '200'] as const)
						.filter((n) => smaOn.includes(n) && c!.sma?.[n]?.length)
						.map((n, i) => ({ key: `sma${n}`, label: `SMA${n}`, points: c!.sma![n], color: css(`--series-${i + 5}`) || css('--accent') })),
					...refList
						.filter((r) => shown.includes(r.id) && refLines[r.id]?.length && !c!.monthly)
						.map((r, i) => ({ key: `ref${r.id}`, label: r.symbol, points: scaled(refLines[r.id]), color: css(`--series-${(i % 6) + 2}`), dashed: true, href: `/security/${r.id}` })),
					...mine
						.filter((id) => shown.includes(id) && refLines[id]?.length && !c!.monthly)
						.map((id, i) => ({ key: `peer${id}`, label: peerOf(id)?.symbol ?? String(id), points: scaled(refLines[id]), color: css(`--series-${((i + refList.length) % 6) + 2}`), href: `/security/${id}` }))
				]
			: []
	);
	const bands = $derived(
		highlight
			? Array.from({ length: 16 }, (_, i) => new Date().getFullYear() - i).map((y) => ({
					from: `${y}-${String((highlight! - 1) * 3 + 1).padStart(2, '0')}-01`,
					to: new Date(Date.UTC(y, highlight! * 3, 0)).toISOString().slice(0, 10)
				}))
			: []
	);

	// ── saving ────────────────────────────────────────────────────────────────────────────────────────────
	let naming = $state(false);
	let name = $state('');
	let savedAs = $state<{ id: number; name: string; json: string } | null>(untrack(() => (saved ? { ...saved, json: JSON.stringify(current()) } : null)));
	const changed = $derived(!!savedAs && JSON.stringify(current()) !== savedAs.json);
	function startSave() {
		// by default the tickers with dashes: «AMAT — LRCX — KLAC»
		const others = mine.map((id) => peerOf(id)?.symbol).filter(Boolean);
		name = c ? [c.security.symbol, ...others].join(' — ') : '';
		naming = true;
	}
	async function saveNew() {
		const r = await fetch('/api/charts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, securityId, config: current() }) }).catch(() => null);
		const j = await r?.json().catch(() => null);
		if (!r?.ok) return showToast(Object.values(j?.errors ?? {}).join(', ') || tx('Не сохранилось', 'Not saved'));
		naming = false;
		savedAs = { id: j.id, name: j.name, json: JSON.stringify(current()) };
		showToast(tx('График сохранён — «Ещё → Сохранённые графики»', 'Chart saved — «More → Saved charts»'));
		void loadWithMe();
		onsaved?.({ id: j.id, name: j.name });
	}
	async function saveChanges() {
		if (!savedAs) return;
		const r = await fetch(`/api/charts/${savedAs.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: current() }) }).catch(() => null);
		if (!r?.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		savedAs = { ...savedAs, json: JSON.stringify(current()) };
		showToast(tx('Изменения сохранены', 'Changes saved'));
	}
</script>

<div class="periods" role="radiogroup" aria-label={tx('Период', 'Period')}>
	{#each PERIODS as [k, ru, en] (k)}
		<button role="radio" aria-checked={period === k} class:on={period === k} onclick={() => setPeriod(k)}>{tx(ru, en)}</button>
	{/each}
</div>

{#if !c}
	<div class="skeleton"></div>
{:else if c.points.length < 2}
	<p class="muted center">{tx('За этот период цен нет: бумага не в кругах загрузки или история ещё грузится.', 'No prices for this period: the security is not in the load rings or its history is still loading.')}</p>
{:else}
	{#if c.monthly}<p class="muted small center">{tx('Месячные закрытия: дневная история бумаги загружается, откройте позже.', 'Monthly closes: the daily history is loading, open it a little later.')}</p>{/if}
	<LineChart {lines} {marks} {onmarker} {bands} format={(v) => priceText(v, c!.security.priceUnit)} />
	{#if c.sma}
		<div class="smas" role="group" aria-label={tx('Скользящие средние', 'Moving averages')}>
			{#each ['20', '50', '200'] as n (n)}
				<button class:on={smaOn.includes(n)} aria-pressed={smaOn.includes(n)} onclick={() => toggleSma(n)}>SMA {n}</button>
			{/each}
			<HelpIcon topicKey="chart.sma" label={tx('скользящие средние', 'moving averages')} />
		</div>
	{/if}
	{#if refList.length && !c.monthly}
		<div class="smas refs" role="group" aria-label={tx('Сравнить на графике', 'Compare on the chart')}>
			{#each refList as r (r.id)}
				<button class:on={shown.includes(r.id)} aria-pressed={shown.includes(r.id)} disabled={!r.loaded} onclick={() => toggleRef(r.id)} title={`${tx(...ROLE[r.role])}: ${refLabel(r)}`}>
					{r.symbol}{#if r.corr !== null && r.corr !== undefined}<small> · Corr {corrText(r.corr)}</small>{/if}
				</button>
			{/each}
			<HelpIcon topicKey="security.compare" label={tx('сравнение', 'comparison')} />
		</div>
	{/if}
	{#if !c.monthly}
		<div class="smas refs" role="group" aria-label={tx('Сравнить с акциями', 'Compare with shares')}>
			{#each mine as id (id)}
				{@const p = peerOf(id)}
				<span class="peer">
					<button class:on={shown.includes(id)} aria-pressed={shown.includes(id)} onclick={() => toggleRef(id)} title={p?.name ?? ''}>
						{p?.symbol ?? '…'}{#if p?.corr !== null && p?.corr !== undefined}<small> · Corr {corrText(p.corr)}</small>{:else if p && !p.loaded}<small> · {tx('грузится', 'loading')}</small>{/if}
					</button>
					<button class="rm" aria-label={tx(`Убрать ${p?.symbol ?? ''}`, `Remove ${p?.symbol ?? ''}`)} onclick={() => removePeer(id)}>×</button>
				</span>
			{/each}
			<button class="add" onclick={() => ((picking = true), void loadPeers())}>+ {tx('Сравнить с акцией', 'Compare with a share')}</button>
		</div>
	{/if}
	{@render below?.(lines)}
	<div class="tools">
		<button class="hl" class:on={!!highlight} aria-pressed={!!highlight} onclick={toggleHighlight}>{highlight ? tx(`Подсвечен Q${highlight} — снять`, `Q${highlight} shaded — clear`) : tx('Подсветить квартал', 'Shade the quarter')}</button>
		{#if savedAs}
			<button class="hl save" disabled={!changed} onclick={saveChanges}>{changed ? tx('Сохранить изменения', 'Save the changes') : tx('Сохранён', 'Saved')}</button>
			<button class="hl" onclick={startSave}>{tx('Сохранить как новый', 'Save as new')}</button>
		{:else}
			<button class="hl save" onclick={startSave}>{tx('Сохранить график', 'Save the chart')}</button>
		{/if}
		<HelpIcon topicKey="charts.saved" label={tx('сохранённые графики', 'saved charts')} />
	</div>
	{#if withMe.length}
		<p class="withme">
			{tx('Сохранённые графики с', 'Saved charts with')} {c.security.symbol}:
			{#each withMe as w, i (w.id)}{i ? ' · ' : ' '}<a href="/charts/{w.id}">{w.name}</a>{/each}
		</p>
	{/if}
	{#if naming}
		<div class="naming">
			<input bind:value={name} placeholder={tx('Название графика', 'The chart\'s name')} aria-label={tx('Название графика', 'The chart\'s name')} />
			<button class="primary" disabled={!name.trim()} onclick={saveNew}>{tx('Сохранить', 'Save')}</button>
			<button class="ghost" onclick={() => (naming = false)}>{tx('Отмена', 'Cancel')}</button>
		</div>
	{/if}
{/if}

{#if picking && c}
	<Sheet title={tx(`Сравнить ${c.security.symbol} с акцией`, `Compare ${c.security.symbol} with a share`)} onclose={() => (picking = false)}>
		<div class="pick">
			<TickerSearch noIndex multi label={tx('Найти тикер — можно несколько подряд', 'Find a ticker — several in a row')} onselect={(s: Security) => addPeer(s.id)} />
			<!-- owner 27.11.2026: one after another without closing; the chosen ones here, × removes -->
			<div class="chosen">
				<span class="muted small">{tx(`Выбрано ${mine.length} из ${MAX_PEERS}`, `Chosen ${mine.length} of ${MAX_PEERS}`)}</span>
				{#each mine as id (id)}
					<button class="chip" onclick={() => removePeer(id)} aria-label={tx(`Убрать ${peerOf(id)?.symbol ?? ''}`, `Remove ${peerOf(id)?.symbol ?? ''}`)}>{peerOf(id)?.symbol ?? '…'} ×</button>
				{/each}
			</div>
			{#each [['industry', peers?.industry ? tx(`Та же отрасль «${peers.industry}»`, `The same industry «${peers.industry}»`) : ''], ['sector', peers?.sector ? tx(`Тот же сектор «${sectorName(peers.sector, tx)}»`, `The same sector «${sectorName(peers.sector, tx)}»`) : '']] as [grp, title] (grp)}
				{@const list = (peers?.peers ?? []).filter((p) => p.same === grp)}
				{#if list.length}
					<p class="pick-h">{title} <span class="muted small">— {tx('крупнейшие; Corr — связь с', 'the biggest; Corr — the link with')} {c.security.symbol}</span> <HelpIcon topicKey="security.compare" label={tx('связь', 'correlation')} /></p>
					<ul class="pick-list">
						{#each list as p (p.id)}
							<li>
								<button class:on={mine.includes(p.id)} aria-pressed={mine.includes(p.id)} onclick={() => (mine.includes(p.id) ? removePeer(p.id) : addPeer(p.id))}>
									<span class="ck" aria-hidden="true">{mine.includes(p.id) ? '✓' : '+'}</span>
									<b>{p.symbol}</b>
									<span class="muted nm">{p.name}{grp === 'sector' && p.industry ? ` · ${p.industry}` : ''}</span>
									<span class="cr">{p.corr !== null ? `Corr ${corrText(p.corr)}` : p.loaded ? '' : grp === 'sector' && !mine.includes(p.id) ? tx('цены — при выборе', 'prices on choosing') : tx('грузится', 'loading')}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if grp === 'industry' && peers?.industry}
					<p class="muted small">{tx(`Других компаний отрасли «${peers.industry}» на этой бирже в базе нет — ниже сектор.`, `No other companies of «${peers.industry}» on this market in the base — the sector below.`)}</p>
				{/if}
			{/each}
			<button class="primary" onclick={() => (picking = false)}>{tx('Готово', 'Done')}</button>
		</div>
	</Sheet>
{/if}

<style>
	.periods {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin-bottom: var(--s3);
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.periods button {
		flex: 1;
		min-height: 36px;
		border: none;
		border-radius: var(--r1);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.periods button.on {
		background: var(--surface);
		font-weight: 600;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
	}
	.skeleton {
		height: 260px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.center {
		text-align: center;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.smas {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin: var(--s2) 0;
	}
	.smas.refs {
		flex-wrap: wrap;
	}
	.smas button {
		min-height: 32px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.smas button:disabled {
		opacity: 0.4;
	}
	.smas button small {
		opacity: 0.8;
	}
	.smas button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.peer {
		display: inline-flex;
		align-items: center;
	}
	.smas .peer .rm {
		min-height: 32px;
		padding: 0 6px;
		margin-left: -2px;
		border: none;
		background: none;
		color: var(--muted);
	}
	.smas .add {
		border-style: dashed;
		color: var(--link);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
	}
	.hl {
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.hl.on {
		border-color: var(--text);
	}
	.hl.save {
		color: var(--link);
		border-color: var(--link);
	}
	.hl:disabled {
		color: var(--muted);
		border-color: var(--line);
	}
	.withme {
		margin: var(--s2) 0 0;
		font-size: var(--fs-xs);
		color: var(--muted);
		line-height: 1.6;
	}
	.withme a {
		color: var(--link);
	}
	.naming {
		display: flex;
		gap: 6px;
		margin-top: var(--s2);
	}
	.naming input {
		flex: 1;
		min-width: 0;
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
	}
	.naming button,
	.pick .primary {
		min-height: 38px;
		padding: 0 12px;
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
	.chosen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.chip {
		min-height: 30px;
		padding: 0 10px;
		border: 1px solid var(--text);
		border-radius: var(--r-pill);
		background: var(--text);
		color: var(--bg);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.pick {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.pick-h {
		margin: 0;
		font-weight: 600;
	}
	.pick-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.pick-list button {
		display: flex;
		align-items: center;
		gap: var(--s2);
		width: 100%;
		min-height: 44px;
		padding: 0 4px;
		border: none;
		border-bottom: 1px solid var(--line);
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.pick-list .ck {
		width: 1.2em;
		color: var(--link);
		font-weight: 700;
	}
	.pick-list button.on .ck {
		color: var(--up);
	}
	.pick-list .nm {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: var(--fs-xs);
	}
	.pick-list .cr {
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
</style>
