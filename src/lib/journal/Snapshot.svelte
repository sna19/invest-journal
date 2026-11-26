<script lang="ts">
	import LineChart, { type Line, type Mark } from '../charts/LineChart.svelte';
	import HelpIcon from '../HelpIcon.svelte';
	import { loc, tx } from '../i18n.js';
	import { money } from '../portfolio.js';
	import type { SnapshotDraft } from './screen.svelte.js';

	/**
	 * Д-21, Д-22: a snapshot drawn by the same components as the screen it was taken from — a chart that can be touched,
	 * a table — but with the numbers of its day, never updated; signed «снимок от …».
	 */
	let { s, at = null }: { s: SnapshotDraft & { photo?: string | null }; at?: string | null } = $props();
	const d = (x: string) => new Date(x).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
	const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`);
	const P = $derived(s.params as Record<string, never>);
	const D = $derived(s.data as Record<string, never>);
	let width = $state(0);
</script>

<figure class="snap">
	{#if s.type === 'photo'}
		<a href="/api/media/{s.photo ?? s.photoPath}" target="_blank" rel="noopener"><img src="/api/media/{s.photo ?? s.photoPath}" alt={tx('Фото', 'Photo')} loading="lazy" /></a>
	{:else if s.type === 'chart'}
		<div bind:clientWidth={width}></div>
		{#if width > 0}<LineChart lines={(D.lines ?? []) as Line[]} marks={(D.marks ?? []) as Mark[]} height={180} />{/if}
	{:else if s.type === 'compare'}
		<table>
			<thead><tr><th></th>{#each (D.periods ?? []) as string[] as p (p)}<th>{p}</th>{/each}</tr></thead>
			<tbody>
				{#each (D.rows ?? []) as { label: string; returns: Record<string, number | null> }[] as r (r.label)}
					<tr><td>{r.label}</td>{#each (D.periods ?? []) as string[] as p (p)}<td>{pct(r.returns[p])}</td>{/each}</tr>
				{/each}
			</tbody>
		</table>
	{:else if s.type === 'candidates'}
		<table>
			<thead><tr><th></th><th>{tx('среднее', 'mean')}</th><th>{tx('мед.', 'med.')}</th><th>{tx('худш.', 'worst')}</th><th>{tx('лет', 'yrs')}</th></tr></thead>
			<tbody>
				{#each (D.candidates ?? []) as { id: number; symbol: string; mean: number; median: number; worst: number; up: number; score: number | null }[] as c (c.id)}
					<tr><td><a href="/security/{c.id}">{c.symbol}</a>{#if c.score !== null && c.score !== undefined} <span class="muted">{c.score.toFixed(1)}</span>{/if}</td><td>{pct(c.mean)}</td><td>{pct(c.median)}</td><td>{pct(c.worst)}</td><td>{c.up}/{P.years ?? ''}</td></tr>
				{/each}
			</tbody>
		</table>
	{:else if s.type === 'scenario'}
		{@const b = D.before as { bets: number; vol: number; job: number | null }}
		{@const a = D.after as { bets: number; vol: number; job: number | null }}
		<p class="muted small">{tx('Добавить', 'Add')} {((P.adds ?? []) as string[]).join(', ')} · {P.amountPct}% {tx('портфеля', 'of the portfolio')} · {tx('из', 'from')} {P.source === 'cash' ? tx('денег', 'cash') : P.source}</p>
		<table>
			<thead><tr><th></th><th>{tx('Было', 'Was')}</th><th>{tx('Стало', 'Becomes')}</th></tr></thead>
			<tbody>
				<tr><td>{tx('Независимых ставок', 'Independent bets')}</td><td>{b.bets.toFixed(1)}</td><td><b>{a.bets.toFixed(1)}</b></td></tr>
				<tr><td>{tx('Колебания в год', 'Swings a year')}</td><td>±{Math.round(b.vol * 100)}%</td><td><b>±{Math.round(a.vol * 100)}%</b></td></tr>
				{#if b.job !== null && a.job !== null}<tr><td>{tx('Связь с работой', 'Tie to the job')}</td><td>{b.job.toFixed(2)}</td><td><b>{a.job.toFixed(2)}</b></td></tr>{/if}
			</tbody>
		</table>
	{:else if s.type === 'portfolio'}
		<p class="muted small">{money(D.value ?? 0, D.currency ?? 'USD')}{#if D.twrPct !== undefined} · {tx('с начала', 'since start')} {pct(D.twrPct)}{/if}</p>
		<table>
			<thead><tr><th></th><th>{tx('доля', 'weight')}</th><th>{tx('стоимость', 'value')}</th><th>{tx('итог', 'result')}</th></tr></thead>
			<tbody>
				{#each (D.positions ?? []) as { symbol: string; weight: number; valuePc: number; unrealizedPct: number | null }[] as p (p.symbol)}
					<tr><td>{p.symbol}</td><td>{Math.round(p.weight)}%</td><td>{money(p.valuePc, D.currency ?? 'USD')}</td><td>{pct(p.unrealizedPct)}</td></tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<figcaption class="muted small">
		{s.type === 'photo' ? tx('Фото', 'Photo') : s.type === 'chart' ? `${tx('График', 'Chart')} ${P.symbol ?? ''} ${P.period ?? ''}` : s.type === 'compare' ? `${tx('Сравнение', 'Comparison')} ${P.symbol ?? ''}` : s.type === 'candidates' ? `${tx('Кандидаты модели', 'Model candidates')} ${P.variant ?? ''} ${String(P.quarter ?? '').replace('-', ' ')}${P.versionId ? ` · ${tx('версия параметров', 'parameters version')} ${P.versionId}` : ''}` : s.type === 'portfolio' ? `${tx('Портфель', 'Portfolio')} ${P.name ?? ''}` : s.type === 'scenario' ? tx('«Что если?»', '«What if?»') : tx('Снимок', 'Snapshot')}
		· {tx('снимок от', 'snapshot of')} {d(at ?? new Date().toISOString())}
		<HelpIcon topicKey="snapshot.screen" label={tx('снимки', 'snapshots')} />
	</figcaption>
</figure>

<style>
	.snap {
		margin: 0;
		padding: var(--s2);
		border: 1px dashed var(--line);
		border-radius: var(--r2);
		display: flex;
		flex-direction: column;
		gap: var(--s1);
	}
	img {
		display: block;
		max-width: 100%;
		max-height: 360px;
		object-fit: contain;
		border-radius: var(--r1);
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
	}
	td {
		text-align: right;
		padding: 2px 0;
		border-top: 1px solid var(--line);
	}
	td:first-child,
	th:first-child {
		text-align: left;
	}
	figcaption {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
		margin: 0;
	}
</style>
