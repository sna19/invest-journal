<script lang="ts">
	import SortHead from '../SortHead.svelte';
	import { TableSort } from '../tablesort.svelte.js';
	const ddSort = new TableSort<'depth' | 'peak' | 'fall' | 'recovery'>();
	import Fold from '#lib/Fold.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import LineChart, { type Line } from '#lib/charts/LineChart.svelte';
	import { tx, loc } from '#lib/i18n.js';
	import { concentration, FLAG_NAME, ladder, monthAdd, monthlyReturns, rolling, type Flag, type MonthPt } from '#lib/path.js';
	import PeriodsRow, { type P } from './PeriodsRow.svelte';
	import Mosaic from './Mosaic.svelte';
	import FlagChips from './FlagChips.svelte';

	/**
	 * T-033 «Как набиралась прибыль» in the security's card: folded — the row of periods and the marks; unfolded — the
	 * mosaic, the rolling return, the drawdown, the concentration, the relative strength and the ladder, each with
	 * its «?» and its reminder line. Switching a window or a period is computed here, without a request.
	 */
	interface Props {
		securityId: number;
		positionId?: number | null;
		onmonth?: (month: string) => void;
	}
	let { securityId, positionId = null, onmonth }: Props = $props();
	type DD = { peak: string; trough: string; depth: number; fall: number; recovery: number | null };
	type V = {
		asOf: string;
		market: string;
		periods: P[];
		months: MonthPt[];
		held: { from: string; to: string | null }[];
		drawdown: { current: number; high: string; calendarDaysNoHigh: number; tradingDaysNoHigh: number; top: DD[]; water: { date: string; value: number }[] };
		relative: { date: string; value: number }[];
		flags: Flag[];
		params: { window: number };
	};
	let v = $state<V | null>(null);
	let more = $state(false);
	let win = $state(12);
	let concYears = $state(3);
	let ladYears = $state(3);
	let ladUnit = $state<'year' | 'quarter'>('year');

	$effect(() => {
		void securityId;
		void positionId;
		fetch(`/api/path?security=${securityId}${positionId ? `&position=${positionId}` : ''}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => {
				v = j;
				if (j) win = j.params.window;
			})
			.catch(() => (v = null));
		try {
			more = localStorage.getItem('path:more') === '1';
		} catch {
			/* private mode */
		}
	});
	function toggle() {
		more = !more;
		try {
			localStorage.setItem('path:more', more ? '1' : '0');
		} catch {
			/* private mode */
		}
	}

	const last = $derived(v?.months.at(-1)?.m ?? '');
	const roll = $derived<Line[]>(
		v
			? (() => {
					const r = rolling(v.months, win);
					return [
						{ key: 'r', label: tx(`за ${win} мес.`, `${win} months`), points: r.map((x) => ({ date: x.date, value: x.value })), main: true },
						{ key: 'm', label: tx('к рынку', 'vs market'), points: r.filter((x) => x.rel !== null).map((x) => ({ date: x.date, value: x.rel! })), dashed: true }
					];
				})()
			: []
	);
	const conc = $derived(v ? concentration(monthlyReturns(v.months.filter((x) => x.m >= monthAdd(last, -12 * concYears)))) : null);
	const lad = $derived(v ? ladder(v.months, monthAdd(last, -12 * ladYears + 1), ladUnit) : null);
	const ladMax = $derived(lad ? Math.max(0.0001, ...lad.steps.map((s) => Math.abs(s.contribution))) : 1);
	const pct = (x: number | null | undefined, sign = true) => (x === null || x === undefined ? '—' : `${sign && x > 0 ? '+' : ''}${(x * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
	const pp = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${tx('п.п.', 'pp')}`;
	const d = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: '2-digit' });
	const water = $derived<Line[]>(v ? [{ key: 'w', label: tx('ниже максимума', 'under the high'), points: v.drawdown.water, main: true }] : []);
	const rs = $derived<Line[]>(v ? [{ key: 'rs', label: tx(`цена / ${v.market}`, `price / ${v.market}`), points: v.relative, main: true }] : []);
	const summary = $derived(
		v
			? [
					...v.flags.map((f) => tx(...FLAG_NAME[f])),
					`1${tx('Г', 'Y')} ${pct(v.periods.find((p) => p.key === '1y')?.ret)}`,
					`3${tx('Г', 'Y')} ${pct(v.periods.find((p) => p.key === '3y')?.perYear)} ${tx('в год', '/yr')}`
				].join(' · ')
			: undefined
	);
</script>

{#if v}
	<Fold key="sec-path" title={tx('Как набиралась прибыль', 'How the profit was made')} {summary} remind="stock.periods">
		{#snippet aside()}<HelpIcon topicKey="stock.periods" label={tx('периоды', 'periods')} />{/snippet}
		<PeriodsRow periods={v.periods} market={v.market} />
		{#if v.flags.length}
			<div class="flags"><FlagChips flags={v.flags} /><HelpIcon topicKey="stock.flags" label={tx('метки пути', 'path marks')} /></div>
		{/if}
		<button class="more" onclick={toggle} aria-expanded={more}>{more ? tx('Свернуть', 'Fold') : tx('Мозаика, просадки, лесенка…', 'Mosaic, drawdowns, ladder…')}</button>

		{#if more}
			<p class="remind">{tx('Важно не сколько заработала, а сколько зарабатывает сейчас.', 'What matters is not what it made but what it makes now.')}</p>
			<section>
				<h3>{tx('Мозаика по месяцам и годам', 'Mosaic by month and year')} <HelpIcon topicKey="stock.monthly" label={tx('мозаика', 'mosaic')} /></h3>
				<Mosaic months={v.months} held={v.held} market={v.market} onpick={onmonth} />
				<p class="remind">{tx('Прибыль набиралась ровно или одним рывком?', 'Was the profit made evenly or in one jump?')}</p>
			</section>

			<section>
				<h3>{tx('Скользящая доходность', 'Rolling return')} <HelpIcon topicKey="stock.rolling" label={tx('скользящая доходность', 'rolling return')} /></h3>
				<div class="seg" role="radiogroup" aria-label={tx('Окно', 'Window')}>
					{#each [6, 12, 36] as w (w)}<button role="radio" aria-checked={win === w} class:on={win === w} onclick={() => (win = w)}>{tx(`${w} мес.`, `${w} mo`)}</button>{/each}
				</div>
				{#if roll[0].points.length > 1}<LineChart lines={roll} percent height={170} />{:else}<p class="muted">{tx('Мало истории для этого окна.', 'Not enough history for this window.')}</p>{/if}
				<p class="remind">{tx('Куда идёт линия сейчас — вверх или к нулю?', 'Where is the line going now — up or to zero?')}</p>
			</section>

			<section>
				<h3>{tx('Просадка от максимума', 'Drawdown from the high')} <HelpIcon topicKey="stock.drawdown" label={tx('просадка', 'drawdown')} /></h3>
				<p class="small">
					{tx('Сейчас', 'Now')} <b>{pct(v.drawdown.current)}</b> {tx('от максимума', 'from the high')} {d(v.drawdown.high)} ·
					{tx(`${v.drawdown.calendarDaysNoHigh} дн. без нового максимума (${v.drawdown.tradingDaysNoHigh} торговых)`, `${v.drawdown.calendarDaysNoHigh} days without a new high (${v.drawdown.tradingDaysNoHigh} trading)`)}
				</p>
				<LineChart lines={water} percent height={140} />
				<table class="dd">
					<thead><tr><th><SortHead s={ddSort} k="depth" desc={false}>{tx('Глубина', 'Depth')}</SortHead></th><th><SortHead s={ddSort} k="peak">{tx('С максимума', 'From the high')}</SortHead></th><th><SortHead s={ddSort} k="fall">{tx('Падение', 'Fall')}</SortHead></th><th><SortHead s={ddSort} k="recovery">{tx('Восстановление', 'Recovery')}</SortHead></th></tr></thead>
					<tbody>
						{#each ddSort.rows(v.drawdown.top, (x, k) => x[k]) as x (x.peak)}
							<tr><td>{pct(x.depth)}</td><td>{d(x.peak)}</td><td>{tx(`${x.fall} дн.`, `${x.fall} d`)}</td><td>{x.recovery === null ? tx('ещё нет', 'not yet') : tx(`${x.recovery} дн.`, `${x.recovery} d`)}</td></tr>
						{/each}
					</tbody>
				</table>
				<p class="remind">{tx('Сколько я готов ждать нового максимума?', 'How long am I ready to wait for a new high?')}</p>
			</section>

			<section>
				<h3>{tx('Концентрация прибыли', 'Concentration of the profit')} <HelpIcon topicKey="stock.concentration" label={tx('концентрация', 'concentration')} /></h3>
				<div class="seg" role="radiogroup" aria-label={tx('Период', 'Period')}>
					{#each [1, 3, 5, 10] as y (y)}<button role="radio" aria-checked={concYears === y} class:on={concYears === y} onclick={() => (concYears = y)}>{tx(`${y}Г`, `${y}Y`)}</button>{/each}
				</div>
				{#if conc && conc.months}
					<p class="small">
						{tx('Итог', 'Total')} <b>{pct(conc.total)}</b> {tx(`за ${conc.months} мес.`, `over ${conc.months} months`)}.
						{#if conc.best1 !== null}{tx('Доля прибыли лучших месяцев', 'The share of the best months')}: 1 — <b>{pct(conc.best1, false)}</b>, 3 — {pct(conc.best3, false)}, 5 — {pct(conc.best5, false)}.{:else}{tx('Прибыли за период нет.', 'No profit over the period.')}{/if}
						{tx('Без лучших 3 месяцев', 'Without the best 3 months')}: <b>{pct(conc.withoutBest3)}</b>.
					</p>
				{/if}
				<p class="remind">{tx('Без лучшего месяца это была бы хорошая бумага?', 'Without its best month, would it be a good share?')}</p>
			</section>

			<section>
				<h3>{tx('Относительная сила', 'Relative strength')} <HelpIcon topicKey="stock.relative" label={tx('относительная сила', 'relative strength')} /></h3>
				{#if rs[0].points.length > 1}<LineChart lines={rs} height={150} format={(x) => x.toFixed(0)} />{/if}
				<p class="muted small">{tx(`Цена с дивидендами, делённая на ${v.market}; 100 — три года назад.`, `The price with dividends over the ${v.market}; 100 three years ago.`)}</p>
				<p class="remind">{tx('Это бумага сильная или рынок растёт?', 'Is the share strong or is the market rising?')}</p>
			</section>

			<section>
				<h3>{tx('Где набрана прибыль', 'Where the profit was made')} <HelpIcon topicKey="stock.return_path" label={tx('где набрана прибыль', 'where the profit was made')} /></h3>
				<div class="bar">
					<div class="seg" role="radiogroup" aria-label={tx('Период', 'Period')}>
						{#each [3, 5, 10] as y (y)}<button role="radio" aria-checked={ladYears === y} class:on={ladYears === y} onclick={() => (ladYears = y)}>{tx(`${y}Г`, `${y}Y`)}</button>{/each}
					</div>
					<div class="seg" role="radiogroup" aria-label={tx('По годам или кварталам', 'By years or quarters')}>
						<button role="radio" aria-checked={ladUnit === 'year'} class:on={ladUnit === 'year'} onclick={() => (ladUnit = 'year')}>{tx('годы', 'years')}</button>
						<button role="radio" aria-checked={ladUnit === 'quarter'} class:on={ladUnit === 'quarter'} onclick={() => (ladUnit = 'quarter')}>{tx('кварталы', 'quarters')}</button>
					</div>
				</div>
				{#if lad}
					<ul class="lad">
						{#each lad.steps as s (s.label)}
							<li>
								<span class="lk">{s.label}</span>
								<span class="track"><i class:neg={s.contribution < 0} style:width={`${(Math.abs(s.contribution) / ladMax) * 100}%`}></i></span>
								<span class="lv">{pp(s.contribution)} <small>({pct(s.growth)})</small></span>
							</li>
						{/each}
					</ul>
					<p class="small">{tx('Итог', 'Total')} <b>{pct(lad.total)}</b> = {tx('сумма ступеней', 'the sum of the steps')}</p>
				{/if}
				<p class="remind">{tx('Эта прибыль сделана при мне или до меня?', 'Was this profit made while I held it, or before?')}</p>
			</section>
		{/if}
	</Fold>
{/if}

<style>
	section {
		margin-top: var(--s4);
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 0 var(--s2);
		font-size: var(--fs-m);
	}
	.flags {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 6px;
	}
	.remind {
		margin: 6px 0 0;
		font-size: var(--fs-xs);
		color: var(--muted);
		font-style: italic;
	}
	.more {
		width: 100%;
		min-height: 34px;
		margin-top: 6px;
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: none;
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.bar {
		display: flex;
		gap: 6px;
	}
	.seg {
		flex: 1;
		display: flex;
		gap: 2px;
		margin-bottom: 6px;
	}
	.seg button {
		flex: 1;
		min-height: 32px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.seg button.on {
		border-color: var(--text);
		background: var(--text);
		color: var(--bg);
	}
	.dd {
		width: 100%;
		margin-top: 6px;
		border-collapse: collapse;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.dd th {
		font-weight: 500;
		color: var(--muted);
		text-align: left;
	}
	.dd td {
		padding: 3px 2px;
		border-top: 1px solid var(--line);
	}
	.lad {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.lad li {
		display: grid;
		grid-template-columns: 4.2em 1fr auto;
		align-items: center;
		gap: 6px;
		min-height: 24px;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.track {
		height: 10px;
		border-radius: 3px;
		background: var(--bg);
		overflow: hidden;
	}
	.track i {
		display: block;
		height: 100%;
		background: var(--up);
	}
	.track i.neg {
		background: var(--down);
	}
	.lv small {
		color: var(--muted);
	}
</style>
