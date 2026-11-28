<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import TopBar from '#lib/TopBar.svelte';
	import ScreenSwitch from '#lib/ScreenSwitch.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import StarToggle from '#lib/StarToggle.svelte';
	import SortHead from '#lib/SortHead.svelte';
	import { TableSort } from '#lib/tablesort.svelte.js';
	import { countryName, REGION_LABEL } from '#lib/allocation.js';
	import { loc, tx } from '#lib/i18n.js';

	/**
	 * Owner 28.11.2026: «найти страны, в которые выгодно инвестировать на следующий год». The country and regional funds
	 * side by side: returns, the momentum 12−1 and its rank, the trend, the swings and the drawdown, the yield, the
	 * fund's P/E and fee; sorted by any column, filtered by region, picked with ☆, the chosen ones as a set.
	 */
	type Row = { id: number; symbol: string; country: string; region: string; loaded: boolean; m1: number | null; m3: number | null; m6: number | null; y1: number | null; mom: number | null; rank: number | null; trend: boolean | null; vol: number | null; dd: number | null; dy: number | null; pe: number | null; fee: number | null };
	let v = $state<{ rows: Row[]; ranked: number; missing: number[] } | null>(null);
	let region = $state('');
	let onlyTrend = $state(false);
	const sort = new TableSort<string>('mom');
	async function load() {
		const r = await fetch('/api/countries').catch(() => null);
		if (r?.ok) v = await r.json();
		// some funds are loading their history: ask again a little later
		if (v && v.missing.length) setTimeout(load, 30_000);
	}
	onMount(load);
	const REGIONS = ['', 'eu', 'asia', 'latam', 'na', 'me', 'il', 'af', 'oc', 'region'];
	const rows = $derived(
		v
			? sort.rows(
					v.rows.filter((r) => (!region || r.region === region) && (!onlyTrend || r.trend === true)),
					(r, k) => (k === 'symbol' ? countryName(r.country, tx) : k === 'trend' ? (r.trend === null ? null : r.trend ? 1 : 0) : (r[k as keyof Row] as number | null))
				)
			: []
	);
	const p = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`);
	const n1 = (x: number | null) => (x === null ? '—' : x.toLocaleString(loc(), { maximumFractionDigits: 1 }));
	async function asSet() {
		const ids = rows.filter((r) => r.loaded).slice(0, 13).map((r) => r.id);
		if (ids.length < 2) return;
		const name = tx(`Страны: ${rows.slice(0, 4).map((r) => r.symbol).join(' — ')}`, `Countries: ${rows.slice(0, 4).map((r) => r.symbol).join(' — ')}`);
		const r = await fetch('/api/charts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, securityId: ids[0], config: { period: '1Y', peers: ids.slice(1), shown: ids.slice(1, 9), sma: [], highlight: null } }) }).then((x) => x.json()).catch(() => null);
		if (r?.id) goto(`/charts/${r.id}?view=basket`);
	}
</script>

<svelte:head><title>{tx('Страны', 'Countries')}</title></svelte:head>
<TopBar title={tx('Страны', 'Countries')} help="countries.screen" back={{ href: '/more', label: tx('Ещё', 'More') }} />
<ScreenSwitch />

<div class="chips" role="radiogroup" aria-label={tx('Регион', 'Region')}>
	{#each REGIONS as r (r)}
		<button role="radio" aria-checked={region === r} class:on={region === r} onclick={() => (region = r)}>{r ? REGION_LABEL(r, tx) : tx('Все', 'All')}</button>
	{/each}
	<button class:on={onlyTrend} aria-pressed={onlyTrend} onclick={() => (onlyTrend = !onlyTrend)}>{tx('только выше SMA200', 'above SMA200 only')}</button>
</div>

{#if !v}
	<div class="skeleton"></div>
{:else}
	<p class="small muted">
		{tx(`Фондов: ${v.rows.length}. Порядок — по моментуму 12−1 (сила за год без последнего месяца): на нём стоит модель «Страновой моментум».`, `Funds: ${v.rows.length}. The order — by the momentum 12−1 (the year less its last month): the «Country momentum» model ranks by it.`)}
		{#if v.missing.length}{tx(` У ${v.missing.length} фондов история ещё загружается — строки дополнятся.`, ` ${v.missing.length} funds are still loading their history — the rows will fill in.`)}{/if}
		<a href="/model/momentum">{tx('Модель →', 'The model →')}</a>
		{#if rows.length > 1}· <button class="link" onclick={asSet}>{tx('Как набор: корзина, риск, карта →', 'As a set: basket, risk, map →')}</button>{/if}
	</p>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th><SortHead s={sort} k="symbol" desc={false}>{tx('Страна', 'Country')}</SortHead></th>
					<th><SortHead s={sort} k="mom" title={tx('доходность за 12 мес. без последнего', 'the 12 months less the last')}>{tx('Моментум', 'Momentum')}</SortHead></th>
					<th><SortHead s={sort} k="trend">{tx('Тренд', 'Trend')}</SortHead></th>
					<th><SortHead s={sort} k="m1">1{tx('М', 'M')}</SortHead></th>
					<th><SortHead s={sort} k="m3">3{tx('М', 'M')}</SortHead></th>
					<th><SortHead s={sort} k="m6">6{tx('М', 'M')}</SortHead></th>
					<th><SortHead s={sort} k="y1">1{tx('Г', 'Y')}</SortHead></th>
					<th><SortHead s={sort} k="pe" desc={false} title={tx('P/E фонда: насколько дорог рынок страны', 'the fund\'s P/E: how dear the country\'s market is')}>P/E</SortHead></th>
					<th><SortHead s={sort} k="dy">DY</SortHead></th>
					<th><SortHead s={sort} k="vol" desc={false} title={tx('колебания за год, % в год', 'swings over a year, % a year')}>HV</SortHead></th>
					<th><SortHead s={sort} k="dd" title={tx('худшая просадка за год', 'the year\'s worst drawdown')}>MDD</SortHead></th>
					<th><SortHead s={sort} k="fee" desc={false} title={tx('годовая комиссия фонда', 'the fund\'s yearly fee')}>{tx('Комиссия', 'Fee')}</SortHead></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.id)}
					<tr class:dim={!r.loaded}>
						<th><span class="who"><StarToggle id={r.id} symbol={r.symbol} origin="страны" /><span><a href="/security/{r.id}">{countryName(r.country, tx)}</a><span class="sub">{r.symbol}</span></span></span></th>
						<td>{#if r.mom !== null}<b class:up={r.mom > 0} class:down={r.mom < 0}>{p(r.mom)}</b><span class="sub">#{r.rank}</span>{:else}—{/if}</td>
						<td>{r.trend === null ? '—' : r.trend ? '↑' : '↓'}</td>
						<td class:up={(r.m1 ?? 0) > 0} class:down={(r.m1 ?? 0) < 0}>{p(r.m1)}</td>
						<td class:up={(r.m3 ?? 0) > 0} class:down={(r.m3 ?? 0) < 0}>{p(r.m3)}</td>
						<td class:up={(r.m6 ?? 0) > 0} class:down={(r.m6 ?? 0) < 0}>{p(r.m6)}</td>
						<td class:up={(r.y1 ?? 0) > 0} class:down={(r.y1 ?? 0) < 0}>{p(r.y1)}</td>
						<td>{n1(r.pe)}</td>
						<td>{r.dy === null ? '—' : `${n1(r.dy)}%`}</td>
						<td>{r.vol === null ? '—' : `${Math.round(r.vol)}%`}</td>
						<td class="down">{r.dd === null ? '—' : p(r.dd)}</td>
						<td>{r.fee === null ? '—' : `${(r.fee * 100).toLocaleString(loc(), { maximumFractionDigits: 2 })}%`}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="muted small">{tx('Как читать: моментум и тренд — куда идут деньги сейчас (сильные страны чаще остаются сильными ещё несколько месяцев); P/E — сколько за это просят (дешёвый рынок с разворотом тренда — кандидат на возврат к среднему); HV и MDD — что придётся пережить. Доходности — по ценам без дивидендов, DY — выплаты фонда за 12 мес.', 'How to read: the momentum and the trend — where the money goes now (strong countries tend to stay strong a few months more); the P/E — what is asked for it (a cheap market turning up — a candidate for a return to the mean); HV and MDD — what you would live through. Returns — by the price without dividends, DY — the fund\'s payments over 12 months.')} <HelpIcon topicKey="countries.screen" label={tx('страны', 'countries')} /></p>
{/if}

<style>
	.chips {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		margin-bottom: var(--s2);
		padding-bottom: 4px;
	}
	.chips button {
		flex: none;
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-xs);
		white-space: nowrap;
		cursor: pointer;
	}
	.chips button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 5px 6px;
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	thead th {
		color: var(--muted);
		font-weight: 600;
	}
	tbody th,
	thead th:first-child {
		text-align: left;
		position: sticky;
		left: 0;
		background: var(--surface);
		z-index: 1;
	}
	.who {
		display: flex;
		align-items: center;
	}
	.who a {
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
	}
	.sub {
		display: block;
		font-size: 10px;
		font-weight: 400;
		color: var(--muted);
	}
	tr.dim {
		opacity: 0.55;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		color: var(--link);
		font: inherit;
		cursor: pointer;
	}
	a {
		color: var(--link);
	}
	.skeleton {
		height: 300px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
</style>
