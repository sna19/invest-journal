<script lang="ts">
	import { onMount } from 'svelte';
	import LineChart, { type Mark } from '../charts/LineChart.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import { loc, tx } from '../i18n.js';
	import { journalVersion } from './screen.svelte.js';

	/**
	 * Д-20 «История»: a security's (or a hypothesis's) path on one timeline with its price — the hypothesis, the
	 * observations, the decision to buy, the observations, the decision to sell, the conclusion. Each step is a mark on the
	 * chart and a line under it; a tap on a mark shows its line.
	 */
	let { securityId = null, hypothesisId = null }: { securityId?: number | null; hypothesisId?: number | null } = $props();
	interface Item {
		date: string;
		at: string;
		kind: 'hypothesis' | 'hypothesis_closed' | 'entry' | 'decision';
		label: string;
		text: string | null;
		entryId: number | null;
		hypothesisId: number | null;
		decisionType: string | null;
		outcome: string | null;
		basis?: string | null;
		entryKind?: string | null;
		assessment?: string | null;
	}
	const TYPE: Record<string, [string, string]> = { buy: ['купить', 'buy'], add: ['докупить', 'add'], sell: ['продать', 'sell'], trim: ['сократить', 'trim'], hold: ['держать', 'hold'], skip: ['не покупать', 'not buying'], defer: ['отложить', 'defer'] };
	const BASIS: Record<string, [string, string]> = { intuition: ['интуиция', 'intuition'], hypothesis: ['гипотеза', 'hypothesis'], model: ['модель', 'model'], consensus: ['консенсус', 'consensus'], mixed: ['смешанное', 'mixed'] };
	const OUT: Record<string, [string, string]> = { yes: ['да', 'yes'], partly: ['частично', 'partly'], no: ['нет', 'no'], early: ['рано судить', 'too early'] };
	const KIND: Record<string, [string, string]> = { note: ['Заметка', 'Note'], observation: ['Наблюдение', 'Observation'], decision: ['Решение', 'Decision'], conclusion: ['Вывод', 'Conclusion'] };
	/** the line's name in the reader's language */
	function labelOf(x: Item) {
		if (x.kind === 'decision' && x.decisionType)
			return `${tx('Решение', 'Decision')}: ${tx(...TYPE[x.decisionType])}${x.basis ? ` · ${tx(...BASIS[x.basis])}` : ''}${x.outcome ? ` · ${tx('сбылось', 'came true')}: ${tx(...OUT[x.outcome])}` : ''}`;
		if (x.kind === 'hypothesis') return `${tx('Гипотеза', 'Hypothesis')} №${x.hypothesisId}`;
		if (x.kind === 'hypothesis_closed') return `${tx('Гипотеза', 'Hypothesis')} №${x.hypothesisId} ${tx('закрыта', 'closed')}${x.outcome ? ` — ${x.outcome === 'hit' ? tx('сбылась', 'came true') : tx('не сбылась', 'did not')}` : ''}`;
		const a = x.assessment === 'strengthening' ? tx(' · тезис усиливается', ' · thesis strengthening') : x.assessment === 'weakening' ? tx(' · тезис ослабевает', ' · thesis weakening') : x.assessment === 'unchanged' ? tx(' · без изменений', ' · unchanged') : '';
		return tx(...(KIND[x.entryKind ?? ''] ?? [x.label, x.label])) + a;
	}
	let items = $state<Item[]>([]);
	let points = $state<{ date: string; value: number }[]>([]);
	let unit = $state('USD');
	let symbol = $state('');
	let picked = $state<number | null>(null);
	// the chart is drawn once its place has a width: inside a folded block it has none yet
	let width = $state(0);

	async function load() {
		const h = await fetch(`/api/history?${securityId ? `security=${securityId}` : `hypothesis=${hypothesisId}`}`).then((r) => r.json()).catch(() => null);
		if (!h?.securityId) return;
		items = h.items;
		if (!items.length) return;
		const days = (Date.now() - Date.parse(items[0].date)) / 86_400_000;
		// at least three months: the move before the first step is part of the story
		const period = days < 85 ? '3M' : days < 175 ? '6M' : days < 360 ? '1Y' : '5Y';
		const c = await fetch(`/api/securities/${h.securityId}/chart?period=${period}`).then((r) => r.json()).catch(() => null);
		if (c) ((points = c.points), (unit = c.security.priceUnit), (symbol = c.security.symbol));
	}
	onMount(load);
	let seen = journalVersion.n;
	$effect(() => {
		if (journalVersion.n !== seen) ((seen = journalVersion.n), load());
	});

	const priceAt = (d: string) => {
		let v = points[0]?.value ?? 0;
		for (const p of points) {
			if (p.date > d) break;
			v = p.value;
		}
		return v;
	};
	const STYLE: Record<string, [Mark['kind'], string, string]> = {
		buy: ['buy', '#16a34a', tx('К', 'B')],
		add: ['buy', '#16a34a', tx('Д', 'A')],
		sell: ['sell', '#dc2626', tx('П', 'S')],
		trim: ['sell', '#ea580c', tx('С', 'T')],
		hold: ['entry', '#2563eb', tx('Ж', 'H')],
		skip: ['news', '#6b7280', '×'],
		defer: ['news', '#6b7280', '⏸']
	};
	const marks = $derived<Mark[]>(
		points.length
			? items
					.map((x, i) => {
						const [kind, color, text] =
							x.kind === 'decision' && x.decisionType ? STYLE[x.decisionType] : x.kind === 'hypothesis' ? (['entry', '#be185d', tx('Г', 'Hy')] as const) : x.kind === 'hypothesis_closed' ? (['exit', '#be185d', tx('Г', 'Hy')] as const) : (['news', '#475569', x.entryKind === 'conclusion' ? tx('В', 'C') : '•'] as const);
						return { id: String(i), date: x.date, price: priceAt(x.date), kind, color, text } as Mark;
					})
					.filter((m) => m.date >= points[0].date)
			: []
	);
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
</script>

{#if items.length}
	<div bind:clientWidth={width}></div>
	{#if points.length && width > 0}
		<LineChart lines={[{ key: 'h', label: symbol, points, main: true }]} {marks} height={200} onmarker={(id) => (picked = Number(id))} format={(v) => `${v.toLocaleString(loc(), { maximumFractionDigits: 2 })} ${unit === 'ILA' ? tx('аг.', 'ag.') : unit === 'USD' ? '$' : '₪'}`} />
	{/if}
	<ol class="tl">
		{#each items as x, i (i)}
			<li class:on={picked === i} class="k-{x.kind} t-{x.decisionType ?? ''}">
				<span class="when">{d(x.date)}</span>
				<span class="what">
					<b>{labelOf(x)}</b>
					{#if x.text}<span class="txt">{x.text}</span>{/if}
				</span>
			</li>
		{/each}
	</ol>
	<p class="muted small">{tx('К — купить, Д — докупить, С — сократить, П — продать, Ж — держать, Г — гипотеза, В — вывод.', 'B — buy, A — add, T — trim, S — sell, H — hold, Hy — hypothesis, C — conclusion.')}<HelpIcon topicKey="decision.history" label={tx('история', 'history')} /></p>
{:else}
	<p class="muted small">{tx('Пока пусто: здесь сложатся гипотеза, наблюдения, решения и выводы по этой бумаге.', 'Empty for now: the hypothesis, observations, decisions and conclusions on this security will line up here.')}<HelpIcon topicKey="decision.history" label={tx('история', 'history')} /></p>
{/if}

<style>
	.tl {
		list-style: none;
		margin: var(--s2) 0;
		padding: 0 0 0 var(--s3);
		border-left: 2px solid var(--line);
	}
	.tl li {
		position: relative;
		display: flex;
		gap: var(--s2);
		padding: var(--s1) 0 var(--s2);
	}
	.tl li::before {
		content: '';
		position: absolute;
		left: calc(-1 * var(--s3) - 6px);
		top: 9px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--muted);
	}
	.tl li.k-decision::before {
		background: #2563eb;
	}
	.tl li.t-buy::before,
	.tl li.t-add::before {
		background: #16a34a;
	}
	.tl li.t-sell::before,
	.tl li.t-trim::before {
		background: #dc2626;
	}
	.tl li.k-hypothesis::before,
	.tl li.k-hypothesis_closed::before {
		background: #be185d;
	}
	.tl li.on {
		background: var(--surface-2);
		border-radius: var(--r1);
	}
	.when {
		flex: none;
		width: 92px;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.txt {
		font-size: var(--fs-s);
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
		display: flex;
		align-items: center;
		gap: 4px;
	}
</style>
