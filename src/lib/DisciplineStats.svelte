<script lang="ts">
	import { onMount } from 'svelte';
	import Fold from './Fold.svelte';
	import HelpIcon from './HelpIcon.svelte';
	import { tx } from './i18n.js';

	/**
	 * T-015, «Статистика» → «Дисциплина»: the share of purchases with an exit condition, the share of exits by the rule,
	 * the result of sales by the rules against the others, by kind of trade, and the matrix «процесс × результат».
	 * A sale's result is its return in its own currency (and against the market over the same days).
	 */
	interface Group {
		n: number;
		avgPct: number | null;
		avgExcess: number | null;
		wins: number;
	}
	interface D {
		buys: { n: number; withPlan: number; withStop: number };
		exits: { n: number; reviewed: number; followed: number };
		byRule: { kept: Group; broken: Group };
		kinds: (Group & { kind: string })[];
		matrix: { goodWin: number; goodLoss: number; badWin: number; badLoss: number };
		reasons: { reason: string; n: number }[];
	}
	let d = $state<D | null>(null);
	onMount(async () => {
		const r = await fetch('/api/discipline/stats').catch(() => null);
		if (r?.ok) d = await r.json();
	});
	const KIND: Record<string, [string, string]> = {
		model: ['Модель', 'Model'],
		hypothesis: ['Гипотеза', 'Hypothesis'],
		own: ['Своя идея', 'Own idea'],
		spec: ['Спекуляция', 'Speculation'],
		transfer: ['Перенесённые', 'Carried over']
	};
	const REASON: Record<string, [string, string]> = {
		stop: ['стоп', 'stop'],
		target: ['цель', 'target'],
		model: ['по модели', 'by the model'],
		thesis_broken: ['тезис сломан', 'thesis broken'],
		changed_mind: ['передумал', 'changed my mind']
	};
	const share = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
	const pp = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
</script>

{#if d}
	<section class="card">
		<Fold bare key="stats-discipline" title={tx('Дисциплина', 'Discipline')} summary={d.buys.n ? `${tx('со стопом', 'with a stop')} ${share(d.buys.withStop, d.buys.n)}` : undefined}>
			{#snippet aside()}<HelpIcon topicKey="stats.discipline" label={tx('дисциплина', 'discipline')} />{/snippet}
			<div class="nums">
				<div>
					<span class="k">{tx('Покупки со стопом', 'Purchases with a stop')}</span><b>{share(d.buys.withStop, d.buys.n)}</b>
					<span class="sub">{d.buys.withStop} {tx('из', 'of')} {d.buys.n}{d.buys.withPlan > d.buys.withStop ? ` · ${tx('с условиями без стопа', 'with conditions, no stop')} ${d.buys.withPlan - d.buys.withStop}` : ''}</span>
				</div>
				<div>
					<span class="k">{tx('Выходы по правилу', 'Exits by the rule')}</span><b>{share(d.exits.followed, d.exits.reviewed)}</b>
					<span class="sub">{d.exits.followed} {tx('из', 'of')} {d.exits.reviewed} {tx('разобранных', 'reviewed')} · {tx('продаж всего', 'sales in all')} {d.exits.n}</span>
				</div>
			</div>

			{#if d.exits.reviewed}
				<table>
					<thead><tr><th></th><th>{tx('продаж', 'sales')}</th><th>{tx('средний итог', 'average')}</th><th>{tx('к рынку', 'vs market')}</th><th>{tx('в плюс', 'won')}</th></tr></thead>
					<tbody>
						<tr><td>{tx('По правилам', 'By the rules')}</td><td>{d.byRule.kept.n}</td><td>{pp(d.byRule.kept.avgPct)}</td><td>{pp(d.byRule.kept.avgExcess)}</td><td>{d.byRule.kept.wins}</td></tr>
						<tr><td>{tx('Вне правил', 'Outside the rules')}</td><td>{d.byRule.broken.n}</td><td>{pp(d.byRule.broken.avgPct)}</td><td>{pp(d.byRule.broken.avgExcess)}</td><td>{d.byRule.broken.wins}</td></tr>
					</tbody>
				</table>

				<p class="k">{tx('Процесс × результат', 'Process × result')}</p>
				<div class="matrix" role="table">
					<span></span><span class="h">{tx('прибыль', 'profit')}</span><span class="h">{tx('убыток', 'loss')}</span>
					<span class="h">{tx('по правилу', 'rule kept')}</span><span class="c good">{d.matrix.goodWin}</span><span class="c">{d.matrix.goodLoss}</span>
					<span class="h">{tx('правило нарушено', 'rule broken')}</span><span class="c danger">{d.matrix.badWin}</span><span class="c bad">{d.matrix.badLoss}</span>
				</div>
				<p class="sub">{tx('«Правило нарушено + прибыль» — самая опасная клетка: она учит плохому.', '«Rule broken + profit» is the most dangerous cell: it teaches the wrong thing.')}</p>
				{#if d.reasons.length}<p class="sub">{tx('Причины выхода', 'Exit reasons')}: {d.reasons.map((r) => `${tx(...REASON[r.reason])} ${r.n}`).join(' · ')}</p>{/if}
			{:else}
				<p class="sub">{tx('Сравнение «по правилам / вне правил» появится после первых продаж с разбором.', 'The comparison «by the rules / outside them» appears after the first sales with a review.')}</p>
			{/if}

			{#if d.kinds.length}
				<p class="k">{tx('По виду сделки', 'By kind of trade')}</p>
				<table>
					<thead><tr><th></th><th>{tx('продаж', 'sales')}</th><th>{tx('средний итог', 'average')}</th><th>{tx('к рынку', 'vs market')}</th><th>{tx('в плюс', 'won')}</th></tr></thead>
					<tbody>
						{#each d.kinds as k (k.kind)}
							<tr><td>{tx(...KIND[k.kind])}</td><td>{k.n}</td><td>{pp(k.avgPct)}</td><td>{pp(k.avgExcess)}</td><td>{k.wins}</td></tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<a class="review" href="/review">{tx('Честный разбор решений →', 'Honest review of the decisions →')}</a>
			{#if d.exits.reviewed < 10}<p class="sub">{tx('Меньше 10 разобранных продаж — выводы делать рано.', 'Fewer than 10 reviewed sales — too early for conclusions.')}</p>{/if}
		</Fold>
	</section>
{/if}

<style>
	.card {
		margin-top: var(--s3);
		padding: var(--s3) var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	.review {
		display: inline-block;
		margin: var(--s2) 0;
		color: var(--link);
		font-size: var(--fs-s);
	}
	.nums {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s3);
		margin-bottom: var(--s3);
	}
	.nums div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.nums b {
		font-size: var(--fs-l);
	}
	.k {
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin: var(--s3) 0 var(--s1);
	}
	.nums .k {
		margin: 0;
	}
	.sub {
		font-size: var(--fs-s);
		color: var(--muted);
		margin: var(--s1) 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-s);
		font-variant-numeric: tabular-nums;
	}
	th {
		font-weight: 400;
		color: var(--muted);
		text-align: right;
		font-size: var(--fs-xs);
	}
	td {
		text-align: right;
		padding: var(--s1) 0;
		border-top: 1px solid var(--line);
	}
	td:first-child,
	th:first-child {
		text-align: left;
	}
	.matrix {
		display: grid;
		grid-template-columns: auto 1fr 1fr;
		gap: 2px;
		font-size: var(--fs-s);
	}
	.matrix .h {
		color: var(--muted);
		padding: var(--s1) var(--s2);
	}
	.matrix .c {
		padding: var(--s2);
		text-align: center;
		border-radius: var(--r1);
		background: var(--surface-2);
		font-weight: 600;
	}
	.matrix .good {
		outline: 1px solid var(--up);
	}
	.matrix .danger {
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.matrix .bad {
		outline: 1px solid var(--down);
	}
</style>
