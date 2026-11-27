<script lang="ts">
	import Fold from './Fold.svelte';
	import HelpIcon from './HelpIcon.svelte';
	import { showToast } from './toast.svelte.js';
	import { tx } from './i18n.js';

	/**
	 * T-031: the commodity funds of the model — the list with each one's group, its history and why it is out (leverage,
	 * not in the directory, no monthly prices yet, too short a history); funds are added and removed here.
	 */
	type Group = 'precious' | 'energy' | 'industrial' | 'agriculture' | 'broad';
	interface Row {
		symbol: string;
		name: string | null;
		group: Group;
		twin: string | null;
		years: number | null;
		firstMonth: string | null;
		excluded: 'levered' | 'unknown' | 'no_prices' | 'short' | null;
	}
	let { rows, minYears, onchange }: { rows: Row[]; minYears: number; onchange: () => void } = $props();
	let bench = $state('DBC');
	let add = $state('');
	let addGroup = $state<Group>('precious');
	let list = $state<{ symbol: string; group: Group; twin?: string }[]>([]);
	$effect(() => {
		fetch('/api/model/commodities')
			.then((r) => r.json())
			.then((j) => ((list = j.funds), (bench = j.bench)))
			.catch(() => {});
	});
	const GROUP: Record<Group, [string, string]> = {
		precious: ['драгоценные металлы', 'precious metals'],
		energy: ['энергия', 'energy'],
		industrial: ['промышленные металлы', 'industrial metals'],
		agriculture: ['сельское хозяйство', 'agriculture'],
		broad: ['широкие индексы', 'broad indices']
	};
	const WHY = $derived<Record<string, [string, string]>>({
		levered: ['исключён: плечо или на падение', 'out: leverage or short'],
		unknown: ['нет в справочнике', 'not in the directory'],
		no_prices: ['месячные цены загружаются', 'monthly prices are loading'],
		short: [`история меньше ${minYears} лет`, `history under ${minYears} years`]
	});
	async function save(next: typeof list, b = bench) {
		const r = await fetch('/api/model/commodities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ funds: next, bench: b }) });
		if (!r.ok) return showToast(tx('Не сохранилось', 'Not saved'));
		const j = await r.json();
		list = j.funds;
		bench = j.bench;
		onchange();
	}
	function addFund() {
		const s = add.trim().toUpperCase();
		add = '';
		if (!/^[A-Z.]{1,8}$/.test(s) || list.some((x) => x.symbol === s)) return;
		void save([...list, { symbol: s, group: addGroup }]);
	}
	const usable = $derived(rows.filter((r) => !r.excluded).length);
</script>

<Fold key="model-funds" title={tx('Сырьевые фонды', 'Commodity funds')} summary={tx(`${usable} из ${rows.length} в выборке · рынок ${bench}`, `${usable} of ${rows.length} in the universe · market ${bench}`)} open={false} remind="model.commodities">
	{#snippet aside()}<HelpIcon topicKey="model.commodities" label={tx('сырьё', 'commodities')} />{/snippet}
	{#each Object.keys(GROUP) as g (g)}
		{@const rs = rows.filter((r) => r.group === g)}
		{#if rs.length}
			<h3>{tx(...GROUP[g as Group])}</h3>
			<ul>
				{#each rs as r (r.symbol)}
					<li class:out={r.excluded}>
						<b>{r.symbol}</b>
						<span class="name">{r.name ?? ''}{#if r.twin} · {tx('одно с', 'same as')} {rows.filter((x) => x.twin === r.twin && x.symbol !== r.symbol).map((x) => x.symbol).join(', ')}{/if}</span>
						<span class="yrs">{r.years !== null ? tx(`${r.years} л. с ${r.firstMonth}`, `${r.years} y from ${r.firstMonth}`) : '—'}</span>
						<button class="x" aria-label={tx(`убрать ${r.symbol}`, `remove ${r.symbol}`)} onclick={() => save(list.filter((x) => x.symbol !== r.symbol))}>×</button>
						{#if r.excluded}<span class="why">{tx(...WHY[r.excluded])}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/each}
	<form class="add" onsubmit={(e) => (e.preventDefault(), addFund())}>
		<input bind:value={add} placeholder={tx('тикер фонда', 'fund ticker')} autocapitalize="characters" />
		<select bind:value={addGroup}>{#each Object.keys(GROUP) as g (g)}<option value={g}>{tx(...GROUP[g as Group])}</option>{/each}</select>
		<button type="submit">{tx('Добавить', 'Add')}</button>
	</form>
	<label class="bench">{tx('Рынок для варианта Б', 'The market of variant B')} <input value={bench} onchange={(e) => save(list, e.currentTarget.value.trim().toUpperCase())} /></label>
	<p class="muted">{tx('Фонды на фьючерсах (USO, UNG и другие) при переходе на следующий контракт теряют часть доходности, поэтому их сезонность может отличаться от сезонности самого сырья. Проверяется именно фонд, который можно купить.', 'Futures funds (USO, UNG and others) lose part of the return when rolling to the next contract, so their season may differ from the commodity\'s own. What is checked is the fund you can buy.')}</p>
</Fold>

<style>
	h3 {
		margin: var(--s3) 0 4px;
		font-size: var(--fs-s);
		color: var(--muted);
		font-weight: 600;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		padding: 6px 0;
		border-top: 1px solid var(--line);
		font-size: var(--fs-s);
	}
	li.out b,
	li.out .name {
		color: var(--muted);
	}
	.name {
		flex: 1;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.yrs {
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.why {
		flex-basis: 100%;
		font-size: var(--fs-xs);
		color: var(--warn-text);
	}
	.x {
		border: none;
		background: none;
		color: var(--muted);
		font-size: 18px;
		cursor: pointer;
	}
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: var(--s3);
	}
	.add input {
		flex: 1 1 7em;
		min-width: 0;
	}
	.add select {
		flex: 2 1 10em;
		min-width: 0;
	}
	input,
	select {
		min-height: 38px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		padding: 0 8px;
	}
	.add button {
		min-height: 38px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.bench {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: var(--s2);
		font-size: var(--fs-s);
	}
	.bench input {
		width: 6em;
	}
	.muted {
		margin: var(--s2) 0 0;
		color: var(--muted);
		font-size: var(--fs-xs);
	}
</style>
