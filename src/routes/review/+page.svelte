<script lang="ts">
	import { onMount } from 'svelte';
	import TopBar from '#lib/TopBar.svelte';
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import { loc, tx } from '#lib/i18n.js';

	/**
	 * T-032 Д-44 «Честный разбор»: the decisions of a month or a quarter — what came true, the result against the market
	 * and the holding time by basis (intuition against the model, the consensus and the sources) and by type; the
	 * refusals and what the security did after them (Д-42); the pause before deciding (Д-43); the weekly pick (Д-45).
	 */
	type Period = 'month' | 'quarter' | 'all';
	let period = $state<Period>('month');
	interface G {
		key: string;
		n: number;
		cameTrue: number;
		judged: number;
		avgExcess: number | null;
		avgHeld: number | null;
	}
	interface R {
		period: { label: string };
		decisions: number;
		byType: Record<string, number>;
		buys: { id: number; symbol: string; securityId: number; type: string; basis: string; outcome: string | null; ret: number | null; excess: number | null; held: number; closed: boolean; pauseDays: number | null; pausePct: number | null; createdAt: string }[];
		byBasis: G[];
		byKind: G[];
		outcomes: { outcome: string; n: number }[];
		skips: { id: number; type: string; symbol: string; securityId: number; basis: string; date: string; until: string; changePct: number | null; verdict: 'avoided' | 'missed' | null }[];
		pause: { n: number; avgDays: number | null; avgPct: number | null };
		weekly: { pct: number; moved: { entryId: number; securityId: number; symbol: string; at: string; text: string; changePct: number }[]; snoozed: { id: number; title: string; snoozes: number; nextDue: string | null }[] };
	}
	let r = $state<R | null>(null);
	async function load() {
		r = await fetch(`/api/review?period=${period}`).then((x) => x.json()).catch(() => null);
	}
	onMount(load);
	const TYPE: Record<string, [string, string]> = { buy: ['купить', 'buy'], add: ['докупить', 'add'], sell: ['продать', 'sell'], trim: ['сократить', 'trim'], hold: ['держать', 'hold'], skip: ['не покупать', 'not buying'], defer: ['отложить', 'defer'] };
	const BASIS: Record<string, [string, string]> = { intuition: ['Интуиция', 'Intuition'], hypothesis: ['Гипотеза', 'Hypothesis'], model: ['Модель', 'Model'], consensus: ['Консенсус', 'Consensus'], mixed: ['Смешанное', 'Mixed'] };
	const OUT: Record<string, [string, string]> = { yes: ['да', 'yes'], partly: ['частично', 'partly'], no: ['нет', 'no'], early: ['рано судить', 'too early'] };
	const pct = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`);
	const d = (s: string) => new Date(s.length > 10 ? s : s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
</script>

<svelte:head><title>{tx('Честный разбор', 'Honest review')}</title></svelte:head>

<TopBar title={tx('Честный разбор', 'Honest review')} help="intuition.review" back={{ href: '/stats', label: tx('Статистика', 'Stats') }} />

<div class="seg" role="radiogroup" aria-label={tx('Период', 'Period')}>
	{#each [['month', tx('Месяц', 'Month')], ['quarter', tx('Квартал', 'Quarter')], ['all', tx('Всё время', 'All time')]] as [k, l] (k)}
		<button role="radio" aria-checked={period === k} class:on={period === k} onclick={() => ((period = k as Period), load())}>{l}</button>
	{/each}
</div>

{#if !r}
	<div class="skeleton"></div>
{:else}
	<p class="lead">
		<b>{r.decisions}</b> {tx('решений', 'decisions')} · {r.period.label}{#if r.decisions}:
			{Object.entries(r.byType).map(([k, n]) => `${tx(...(TYPE[k] ?? [k, k]))} ${n}`).join(' · ')}{/if}
	</p>
	{#if r.outcomes.some((o) => o.n)}<p class="muted small">{tx('Сбылось', 'Came true')}: {r.outcomes.filter((o) => o.n).map((o) => `${tx(...OUT[o.outcome])} ${o.n}`).join(' · ')}</p>{/if}

	<Fold key="review-basis" title={tx('Интуиция против остальных', 'Intuition against the rest')}>
		{#snippet aside()}<HelpIcon topicKey="decision.basis" label={tx('основание', 'basis')} />{/snippet}
		{#if r.byBasis.length}
			<table>
				<thead><tr><th>{tx('Основание', 'Basis')}</th><th>{tx('покупок', 'buys')}</th><th>{tx('сбылось', 'came true')}</th><th>{tx('к рынку', 'vs market')}</th><th>{tx('держал, дн.', 'held, d')}</th></tr></thead>
				<tbody>
					{#each r.byBasis as g (g.key)}
						<tr class:me={g.key === 'intuition'}><td>{tx(...(BASIS[g.key] ?? [g.key, g.key]))}</td><td>{g.n}</td><td>{g.judged ? `${g.cameTrue}/${g.judged}` : '—'}</td><td class:up={(g.avgExcess ?? 0) > 0} class:down={(g.avgExcess ?? 0) < 0}>{pct(g.avgExcess)}</td><td>{g.avgHeld ?? '—'}</td></tr>
					{/each}
				</tbody>
			</table>
			<p class="muted small">{tx('«К рынку» — доходность покупки от цены входа до продажи (или до сегодня) минус S&P 500 / ТА-125 за те же дни. «Сбылось» — ответы «да» и «частично» из оценённых.', '«Vs market» — the purchase\'s return from the entry to the sale (or today) less the S&P 500 / TA-125 over the same days. «Came true» — the answers «yes» and «partly» of those judged.')}</p>
			{#if r.buys.length < 10}<p class="muted small">{tx('Меньше 10 покупок — выводы делать рано.', 'Fewer than 10 purchases — too early for conclusions.')}</p>{/if}
		{:else}
			<p class="muted">{tx('Покупок за период нет.', 'No purchases in the period.')}</p>
		{/if}
	</Fold>

	{#if r.byKind.length > 1}
		<Fold key="review-kind" title={tx('По типу решения', 'By type of decision')} open={false}>
			<table>
				<thead><tr><th></th><th>{tx('решений', 'decisions')}</th><th>{tx('сбылось', 'came true')}</th><th>{tx('к рынку', 'vs market')}</th><th>{tx('держал, дн.', 'held, d')}</th></tr></thead>
				<tbody>
					{#each r.byKind as g (g.key)}<tr><td>{tx(...(TYPE[g.key] ?? [g.key, g.key]))}</td><td>{g.n}</td><td>{g.judged ? `${g.cameTrue}/${g.judged}` : '—'}</td><td>{pct(g.avgExcess)}</td><td>{g.avgHeld ?? '—'}</td></tr>{/each}
				</tbody>
			</table>
		</Fold>
	{/if}

	{#if r.buys.length}
		<Fold key="review-buys" title={tx('Покупки', 'Purchases')} summary={String(r.buys.length)} open={false}>
			<ul class="rows">
				{#each r.buys as b (b.id)}
					<li>
						<a href="/security/{b.securityId}"><b>{b.symbol}</b></a> {tx(...(TYPE[b.type] ?? [b.type, b.type]))} {d(b.createdAt)} · {tx(...(BASIS[b.basis] ?? [b.basis, b.basis])).toLowerCase()}
						<span class="muted small block">{b.closed ? tx('продано', 'sold') : tx('держу', 'holding')} · {pct(b.ret)} · {tx('к рынку', 'vs market')} {pct(b.excess)} · {b.held} {tx('дн.', 'd')}{#if b.outcome} · {tx('сбылось', 'came true')}: {tx(...OUT[b.outcome])}{/if}{#if b.pauseDays !== null} · {tx('пауза', 'pause')} {b.pauseDays} {tx('дн.', 'd')} ({pct(b.pausePct)}){/if}</span>
					</li>
				{/each}
			</ul>
		</Fold>
	{/if}

	<Fold key="review-skips" title={tx('Отказы и отсрочки', 'Refusals and deferrals')} summary={String(r.skips.length)}>
		{#snippet aside()}<HelpIcon topicKey="decision.skip" label={tx('отказы', 'refusals')} />{/snippet}
		{#if r.skips.length}
			<ul class="rows">
				{#each r.skips as s (s.id)}
					<li>
						<a href="/security/{s.securityId}"><b>{s.symbol}</b></a> {tx(...(TYPE[s.type] ?? [s.type, s.type]))} {d(s.date)}
						<span class="block small">
							{#if s.verdict === 'avoided'}<span class="up">{tx('избежал убытка', 'avoided a loss')} {pct(s.changePct)}</span>{:else if s.verdict === 'missed'}<span class="down">{tx('упустил рост', 'missed a rise')} {pct(s.changePct)}</span>{:else}—{/if}
							<span class="muted">· {tx('до', 'to')} {d(s.until)}</span>
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted small">{tx('Отказов за период нет. «Не покупаю» и «Отложить» — в карточке бумаги.', 'No refusals in the period. «Not buying» and «Defer» are on a security\'s card.')}</p>
		{/if}
	</Fold>

	<Fold key="review-pause" title={tx('Пауза перед решением', 'The pause before deciding')} summary={r.pause.avgDays !== null ? tx(`в среднем ${r.pause.avgDays} дн.`, `${r.pause.avgDays} d on average`) : undefined} open={false}>
		{#if r.pause.n}
			<p>{tx('От первой записи о бумаге до покупки', 'From the first entry about a security to the purchase')}: <b>{r.pause.avgDays} {tx('дн.', 'd')}</b>, {tx('цена за это время', 'the price over it')} <b>{pct(r.pause.avgPct)}</b> <span class="muted small">({r.pause.n})</span></p>
			<p class="muted small">{tx('Плюс — пока ждал, цена росла: ожидание стоило денег. Минус — ожидание помогло купить дешевле.', 'Plus — the price rose while you waited: the wait cost money. Minus — the wait helped to buy cheaper.')}</p>
		{:else}
			<p class="muted small">{tx('Пока нет покупок, о бумаге которых что-то было записано раньше.', 'No purchases yet of securities written about before.')}</p>
		{/if}
	</Fold>

	<Fold key="review-weekly" title={tx('Подборка недели', 'Weekly pick')} summary={String(r.weekly.moved.length + r.weekly.snoozed.length)}>
		{#snippet aside()}<HelpIcon topicKey="intuition.weekly" label={tx('подборка недели', 'weekly pick')} />{/snippet}
		{#if r.weekly.moved.length}
			<p class="k">{tx(`Сдвинулись больше чем на ${r.weekly.pct}% с момента записи`, `Moved more than ${r.weekly.pct}% since the entry`)}</p>
			<ul class="rows">
				{#each r.weekly.moved as m (m.entryId + '-' + m.securityId)}
					<li><a href="/security/{m.securityId}"><b>{m.symbol}</b></a> <span class:up={m.changePct > 0} class:down={m.changePct < 0}>{pct(m.changePct)}</span> <span class="muted small">{tx('с', 'since')} {d(m.at)}</span><span class="block small">{m.text}</span></li>
				{/each}
			</ul>
		{/if}
		{#if r.weekly.snoozed.length}
			<p class="k">{tx('Отложены 3 раза и больше', 'Snoozed 3 times or more')}</p>
			<ul class="rows">{#each r.weekly.snoozed as s (s.id)}<li>{s.title} <span class="down small">{tx(`отложено ${s.snoozes} раз`, `snoozed ${s.snoozes}×`)}</span></li>{/each}</ul>
		{/if}
		{#if !r.weekly.moved.length && !r.weekly.snoozed.length}<p class="muted small">{tx('На этой неделе — ничего.', 'Nothing this week.')}</p>{/if}
	</Fold>
{/if}

<style>
	.seg {
		display: flex;
		gap: var(--s1);
		margin: 0 0 var(--s3);
	}
	.seg button {
		min-height: 34px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
	}
	.seg button.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.lead {
		margin: 0 0 var(--s1);
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
	tr.me td {
		font-weight: 600;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		padding: var(--s2) 0;
		border-top: 1px solid var(--line);
	}
	.rows a {
		color: var(--text);
	}
	.block {
		display: block;
	}
	.k {
		margin: var(--s2) 0 0;
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.skeleton {
		height: 200px;
		border-radius: var(--r3);
		background: var(--surface-2);
	}
</style>
