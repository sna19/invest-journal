<script lang="ts">
	import { onMount } from 'svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { tx } from '#lib/i18n.js';

	/** T-021, «Статистика» → «Защита»: sales of positions with a stop at the broker against those without; fully protected days */
	type G = { n: number; avg: number | null; worst: number | null };
	let s = $state<{ withStop: G; withoutStop: G; days: number; fullDaysPct: number | null } | null>(null);
	onMount(async () => {
		const j = await fetch('/api/protection/settings').then((r) => r.json()).catch(() => null);
		s = j?.stats ?? null;
	});
	const pct = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : ''}${x.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
</script>

{#if s}
	<Fold key="stats-protection" title={tx('Защита', 'Protection')} summary={s.fullDaysPct !== null ? tx(`защищён полностью ${s.fullDaysPct}% дней`, `fully protected ${s.fullDaysPct}% of days`) : undefined} remind="portfolio.protection">
		{#snippet aside()}<HelpIcon topicKey="portfolio.protection" label={tx('защита', 'protection')} />{/snippet}
		<table>
			<thead><tr><th></th><th>{tx('Продаж', 'Sales')}</th><th>{tx('Средний итог', 'Average')}</th><th>{tx('Худший', 'Worst')}</th></tr></thead>
			<tbody>
				<tr><td>{tx('Со стопом у брокера', 'With a stop at the broker')}</td><td>{s.withStop.n}</td><td>{pct(s.withStop.avg)}</td><td>{pct(s.withStop.worst)}</td></tr>
				<tr><td>{tx('Без стопа', 'Without a stop')}</td><td>{s.withoutStop.n}</td><td>{pct(s.withoutStop.avg)}</td><td>{pct(s.withoutStop.worst)}</td></tr>
			</tbody>
		</table>
		<p class="muted">
			{s.days ? tx(`Портфель защищён полностью в ${s.fullDaysPct}% дней из ${s.days}.`, `The portfolio was fully protected on ${s.fullDaysPct}% of ${s.days} days.`) : tx('Доля защищённых дней появится после первого дня записи (каждое утро).', 'The share of protected days appears after the first recorded day (each morning).')}
			{tx('Итог продажи — цена продажи к средней цене покупки.', 'A sale\'s result is its price against the average purchase price.')}
		</p>
	</Fold>
{/if}

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-s);
	}
	th {
		font-weight: 500;
		font-size: var(--fs-xs);
		color: var(--muted);
		text-align: right;
	}
	td {
		padding: 6px 2px;
		border-top: 1px solid var(--line);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	td:first-child {
		text-align: left;
	}
	.muted {
		color: var(--muted);
		font-size: var(--fs-xs);
	}
</style>
