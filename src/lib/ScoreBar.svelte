<script lang="ts">
	import HelpIcon from './HelpIcon.svelte';
	import Sheet from './Sheet.svelte';
	import { loc, tx } from './i18n.js';
	import { sectorName } from './allocation.js';
	import { scores, wantScore, type Factor } from './score.svelte.js';

	/**
	 * T-034: the quant score under a security's title — the colour, the total, the four grades and the trend; a tap
	 * shows what each grade is made of: every metric's value and its place among the sector's peers.
	 */
	let { id }: { id: number } = $props();
	$effect(() => wantScore(id));
	const s = $derived(scores[id]);
	let open = $state(false);
	const F: Record<Factor, [string, string]> = { quality: ['Качество', 'Quality'], growth: ['Рост', 'Growth'], valuation: ['Оценка', 'Valuation'], momentum: ['Моментум', 'Momentum'] };
	const M: Record<string, [string, string, 'pct' | 'x']> = {
		operatingMargin: ['Операционная маржа', 'Operating margin', 'pct'],
		grossMargin: ['Валовая маржа', 'Gross margin', 'pct'],
		roe: ['ROE', 'ROE', 'pct'],
		debtToEquity: ['Долг / капитал', 'Debt / equity', 'x'],
		revenueGrowth: ['Рост выручки', 'Revenue growth', 'pct'],
		earningsGrowth: ['Рост прибыли', 'Earnings growth', 'pct'],
		forwardPe: ['P/E прогноз', 'Forward P/E', 'x'],
		ps: ['P/S', 'P/S', 'x'],
		evEbitda: ['EV/EBITDA', 'EV/EBITDA', 'x'],
		peg: ['PEG', 'PEG', 'x'],
		mom12: ['Рост за 12 мес. без последнего', '12 months less the last', 'pct']
	};
	const NAME = { green: ['сильная', 'strong'], yellow: ['смешанная', 'mixed'], red: ['слабая', 'weak'], grey: ['мало данных', 'little data'] } as const;
	const val = (key: string, v: number) => (M[key][2] === 'pct' ? `${(v * 100).toLocaleString(loc(), { maximumFractionDigits: 1 })}%` : key === 'debtToEquity' ? `${Math.round(v)}%` : v.toLocaleString(loc(), { maximumFractionDigits: 1 }));
</script>

{#if s}
	<button class="bar" onclick={() => (open = true)} aria-label={tx('Квант-оценка: подробно', 'Quant score: details')}>
		<i class="dot {s.color}"></i>
		<b>{tx(NAME[s.color][0], NAME[s.color][1])}{#if s.total !== null && s.color !== 'grey'}&nbsp;{Math.round(s.total * 100)}{/if}</b>
		{#each Object.keys(F) as f (f)}<span class="g">{tx(F[f as Factor][0], F[f as Factor][1]).slice(0, 1)}<em class="gr {s.factors[f as Factor].grade ?? 'none'}">{s.factors[f as Factor].grade ?? '—'}</em></span>{/each}
		{#if s.trend}<span class="t" class:down={!s.trend.above}>{s.trend.above ? '↑' : '↓'}SMA200</span>{/if}
	</button>
{/if}

{#if open && s}
	<Sheet title={tx('Квант-оценка', 'Quant score')} onclose={() => (open = false)}>
		<p class="head"><i class="dot {s.color}"></i> <b>{tx(NAME[s.color][0], NAME[s.color][1])}</b>{#if s.total !== null && s.color !== 'grey'} · {Math.round(s.total * 100)} {tx('из 100', 'of 100')}{/if} <HelpIcon topicKey="security.score" label={tx('квант-оценка', 'quant score')} /></p>
		<p class="muted small">{tx('Каждая метрика — место среди бумаг сектора', 'Each metric — its place among the sector\'s shares')}{s.sector ? ` «${sectorName(s.sector, tx)}»` : ''}: {tx('100 — лучше всех, 50 — посередине', '100 — the best, 50 — the middle')}.</p>
		{#each Object.keys(F) as f (f)}
			{@const x = s.factors[f as Factor]}
			<section>
				<h3>{tx(F[f as Factor][0], F[f as Factor][1])} <em class="gr {x.grade ?? 'none'}">{x.grade ?? '—'}</em>{#if x.pct !== null}<span class="muted"> · {Math.round(x.pct * 100)}</span>{/if}</h3>
				{#if x.metrics.length}
					<ul>
						{#each x.metrics as mm (mm.key)}
							<li><span>{tx(M[mm.key][0], M[mm.key][1])}</span><b>{val(mm.key, mm.value)}</b><span class="pc"><i style:width={`${mm.pct * 100}%`}></i></span><span class="n">{Math.round(mm.pct * 100)}{#if mm.scope === 'market'}<sup title={tx('сравнение со всем рынком: в секторе мало данных', 'compared with the whole market: few data in the sector')}>*</sup>{/if}</span></li>
						{/each}
					</ul>
				{:else}<p class="muted small">{tx('Нет данных', 'No data')}{#if f === 'valuation' && s.market === 'IL'}{' '}— {tx('для TASE оценочные коэффициенты Yahoo некорректны', 'Yahoo\'s price ratios are wrong for TASE')}{/if}</p>{/if}
			</section>
		{/each}
		{#if s.trend}
			<p class="small">{tx('Тренд', 'Trend')}: {tx('цена', 'price')} {s.trend.price.toLocaleString(loc(), { maximumFractionDigits: 2 })} {s.trend.above ? tx('выше', 'above') : tx('ниже', 'below')} SMA200 {s.trend.sma200.toLocaleString(loc(), { maximumFractionDigits: 2 })}{#if !s.trend.above}{" "}— {tx('поэтому оценка не выше жёлтой', 'so the score is at most yellow')}{/if}.</p>
		{/if}
		<p class="muted small">{tx('Бета не входит в оценку: она задаёт размер позиции и стоп («Риск», «Защита»).', 'Beta is not in the score: it sets the position\'s size and stop («Risk», «Protection»).')}</p>
	</Sheet>
{/if}

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		width: 100%;
		margin: 0 0 var(--s3);
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
		text-align: left;
	}
	.dot {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		vertical-align: middle;
	}
	.green {
		background: var(--up);
	}
	.yellow {
		background: #d9a400;
	}
	.red {
		background: var(--down);
	}
	.grey {
		background: var(--line);
	}
	.g {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.gr {
		margin-left: 2px;
		font-style: normal;
		font-weight: 700;
		color: var(--text);
	}
	.gr.A,
	.gr.B {
		color: var(--up);
	}
	.gr.D,
	.gr.F {
		color: var(--down);
	}
	.t {
		font-size: var(--fs-xs);
		color: var(--up);
	}
	.t.down {
		color: var(--down);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
	}
	h3 {
		margin: var(--s3) 0 4px;
		font-size: var(--fs-m);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: grid;
		grid-template-columns: 1fr auto 60px 2.2em;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		border-top: 1px solid var(--line);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.pc {
		height: 6px;
		border-radius: 3px;
		background: var(--bg);
		overflow: hidden;
	}
	.pc i {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.n {
		text-align: right;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
</style>
