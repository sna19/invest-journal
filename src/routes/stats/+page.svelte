<script lang="ts">
	import Fold from '#lib/Fold.svelte';
	import DisciplineStats from '#lib/DisciplineStats.svelte';
	import { tl, tx } from '#lib/i18n.js';
	import { onMount } from 'svelte';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import TopBar from '#lib/TopBar.svelte';
	import Empty from '#lib/Empty.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Rate from '#lib/Rate.svelte';
	import Pct from '#lib/Pct.svelte';
	import { orderOf, sortable } from '#lib/sortable.js';
	import type { CalBucket, Score } from '#lib/stats.js';

	/**
	 * Spec sections 7, 9 and 13 — «Статистика»: calibration, own ideas against outside sources, simulation
	 * against real money, tags (from 10 closed). Blocks change places by long press and drag; the order is
	 * remembered on the device. Every block says plainly what it waits for while data is short.
	 */
	interface Side {
		key: string;
		label: string;
		score: Score;
		open: number;
		news: Score;
	}
	interface Stats {
		total: { closed: number; open: number };
		calibration: { buckets: CalBucket[]; n: number; hits: number; meanConf: number | null; rate: number | null; brier: number | null; without: number };
		own: Side[];
		mode: Side[];
		tags: { shown: Side[]; gathering: { label: string; closed: number; open: number }[] };
	}

	const BLOCKS = ['calibration', 'own', 'mode', 'tags'] as const;
	const ORDER_KEY = 'stats-order';
	const FILTER_KEY = 'stats-no-default';

	let data = $state<Stats | null>(null);
	let problem = $state<string | undefined>();
	let noDefault = $state(false);
	let order = $state<string[]>([...BLOCKS]);
	let preview = $state<string[] | null>(null);

	async function load() {
		try {
			const r = await fetch(`/api/stats${noDefault ? '?noDefault=1' : ''}`);
			if (!r.ok) throw new Error();
			data = await r.json();
			problem = undefined;
		} catch {
			problem = tx('Нет связи с сервером.', 'No connection to the server.');
		}
	}
	onMount(() => {
		try {
			noDefault = localStorage.getItem(FILTER_KEY) === '1';
			order = orderOf(JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null'), BLOCKS);
		} catch {
			/* ignore */
		}
		load();
	});
	function toggle() {
		noDefault = !noDefault;
		try {
			localStorage.setItem(FILTER_KEY, noDefault ? '1' : '0');
		} catch {
			/* ignore */
		}
		load();
	}
	function saveOrder(keys: string[]) {
		order = keys;
		try {
			localStorage.setItem(ORDER_KEY, JSON.stringify(keys));
		} catch {
			/* ignore */
		}
	}

	const shown = $derived(preview ?? order);
	const pct = (x: number) => Math.round(x * 100);

	// the calibration chart: stated confidence across, actual share up; the diagonal is perfect calibration
	const W = 320;
	const H = 220;
	const PAD = { l: 40, r: 20, t: 10, b: 28 };
	const x = (v: number) => PAD.l + (v / 100) * (W - PAD.l - PAD.r);
	const y = (v: number) => H - PAD.b - (v / 100) * (H - PAD.t - PAD.b);
	const radius = (n: number) => Math.min(11, 4 + Math.sqrt(n) * 1.3);
	const TICKS = [0, 25, 50, 75, 100];

	function gap(b: CalBucket) {
		const d = pct(b.rate!) - Math.round(b.meanConf);
		if (b.level === 'few') return '';
		if (Math.abs(d) < 5) return tx('сходится', 'matches');
		return d < 0 ? tx(`сбывается на ${-d} п.п. реже`, `comes true ${-d} pp less often`) : tx(`сбывается на ${d} п.п. чаще`, `comes true ${d} pp more often`);
	}
</script>

<svelte:head><title>{tx('Статистика', 'Stats')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Статистика', 'Stats')} help="stats.screen" />

<div class="bar">
	<button class="chip" class:on={noDefault} aria-pressed={noDefault} onclick={toggle}>{tx('Без срока по умолчанию', 'Without the default term')}</button>
	<span class="grow"></span>
	{#if data && (data.total.closed || data.total.open)}<span class="muted small">{tx('закрыто', 'closed')} {data.total.closed} · {tx('открыто', 'open')} {data.total.open}</span>{/if}
</div>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if data === null}
	{#each [1, 2, 3] as i (i)}<div class="skeleton"></div>{/each}
{:else if !data.total.closed && !data.total.open}
	<Empty title={tx('Калибровка и сравнения', 'Calibration and comparisons')}>
		{tx('Здесь будет видно, сбывается ли ваша уверенность («ставлю 70% — сбывается ли 70%»), как ваши идеи выглядят рядом с внешними источниками и чем симуляция отличается от реальных денег. Всё считается по закрытым гипотезам.', 'Here you will see whether your confidence comes true («I put 70% — does 70% come true?»), how your ideas look next to outside sources and how simulation differs from real money. Everything is counted on closed hypotheses.')}
		{#snippet action()}<a href="/new">{tx('Новая гипотеза', 'New hypothesis')}</a>{/snippet}
	</Empty>
{:else}
	<p class="muted small hint">{tx('Блоки можно поменять местами: удерживайте блок или тяните за ≡.', 'Blocks can swap places: hold a block or drag by ≡.')}</p>
	<ul class="blocks" use:sortable={{ preview: (k) => (preview = k), drop: saveOrder }}>
		{#each shown as key (key)}
			<li class="card" data-key={key}>
				{#if key === 'calibration'}
					{@const c = data.calibration}
					<Fold bare key="stats-calibration" title={tx('Калибровка', 'Calibration')} summary={c.n ? tx(`закрыто с уверенностью: ${c.n}`, `closed with a confidence: ${c.n}`) : undefined}>
						{#snippet aside()}
							<HelpIcon topicKey="stats.calibration" label={tx('калибровка', 'calibration')} />
							<button class="handle" data-handle aria-label={tx('Калибровка: перетащить', 'Calibration: drag')}><GripVertical size={18} /></button>
						{/snippet}
					{#if !c.n}
						<p class="muted">
							{tx('Появится, когда закроются гипотезы с заполненной уверенностью.', 'Appears when hypotheses with a confidence filled in close.')}{#if c.without}
								{tx(`Сейчас закрыто ${c.without} без уверенности — они в калибровку не входят.`, `${c.without} closed without a confidence — they are not in the calibration.`)}{/if}
						</p>
					{:else}
						<p class="lead">
							{tx('В среднем ставите', 'On average you put')} <b>{Math.round(c.meanConf!)}%</b>, {tx('сбывается', 'comes true')} <b>{pct(c.rate!)}%</b>
							<span class="muted">({c.hits} {tx('из', 'of')} {c.n})</span>
						</p>
						<svg viewBox="0 0 {W} {H}" role="img" aria-label={tx('График калибровки: заявленная уверенность против доли сработавших', 'Calibration chart: stated confidence against the share that came true')}>
							{#each TICKS as t (t)}
								<line class="grid" x1={x(0)} x2={x(100)} y1={y(t)} y2={y(t)} />
								<text class="tick" x={PAD.l - 6} y={y(t) + 4} text-anchor="end">{t}%</text>
								<text class="tick" x={x(t)} y={H - PAD.b + 16} text-anchor="middle">{t}%</text>
							{/each}
							<line class="diag" x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} />
							{#each c.buckets as b (b.from)}
								{#if b.level !== 'few' && b.ci}
									<line class="ci" x1={x(b.meanConf)} x2={x(b.meanConf)} y1={y(b.ci[0] * 100)} y2={y(b.ci[1] * 100)} />
								{/if}
								<circle class="dot" class:faint={b.level === 'few'} cx={x(b.meanConf)} cy={y(b.rate! * 100)} r={radius(b.n)} />
							{/each}
						</svg>
						<p class="muted small legend">{tx('По горизонтали — какую уверенность ставили, по вертикали — сколько сбылось. Точки на диагонали — уверенность честная; бледные — меньше 10 гипотез.', 'Across — the confidence you put, up — how much came true. Points on the diagonal — honest confidence; pale ones — fewer than 10 hypotheses.')}</p>
						<ul class="rows">
							{#each c.buckets as b (b.from)}
								<li class="cal">
									<span class="top">
										<span class="lbl">{tl(b.label)}</span>
										{#if b.level === 'few'}
											<span class="few">{tx('мало данных', 'few data')} · {b.hits} {tx('из', 'of')} {b.n}</span>
										{:else}
											<b>{pct(b.rate!)}%</b>
											<span class="muted small">{pct(b.ci![0])}–{pct(b.ci![1])}%</span>
											{#if b.level === 'prelim'}<span class="prelim">{tx('предварительно', 'preliminary')}</span>{/if}
										{/if}
									</span>
									{#if b.level !== 'few'}
										<span class="muted small">{tx('ставили в среднем', 'put on average')} {Math.round(b.meanConf)}%, {tx('сработало', 'came true')} {b.hits} {tx('из', 'of')} {b.n}{gap(b) ? ` — ${gap(b)}` : ''}</span>
									{/if}
								</li>
							{/each}
						</ul>
						{#if c.without}<p class="muted small">{tx(`Ещё ${c.without} закрытых без уверенности — в калибровку не входят.`, `${c.without} more closed without a confidence — not in the calibration.`)}</p>{/if}
					{/if}
					</Fold>
				{:else if key === 'own' || key === 'mode'}
					{@const sides = key === 'own' ? data.own : data.mode}
					<Fold bare key="stats-{key}" title={key === 'own' ? tx('Свои идеи и внешние источники', 'Own ideas and outside sources') : tx('Симуляция и реальные деньги', 'Simulation and real money')}>
						{#snippet aside()}
							<HelpIcon topicKey={key === 'own' ? 'stats.own' : 'stats.mode'} label={key === 'own' ? tx('свои идеи', 'own ideas') : tx('режимы', 'modes')} />
							<button class="handle" data-handle aria-label={tx('Блок: перетащить', 'Block: drag')}><GripVertical size={18} /></button>
						{/snippet}
					{#if sides.every((s) => !s.score.n && !s.open)}
						<p class="muted">
							{key === 'own'
								? tx('Появится, когда закроются гипотезы с источником «Собственная идея» или внешним.', 'Appears when hypotheses from «Own idea» or an outside source close.')
								: tx('Появится, когда закроются гипотезы в режимах «симуляция» и «реальные деньги».', 'Appears when hypotheses in «simulation» and «real money» modes close.')}
						</p>
					{:else}
						{@render compare(sides)}
					{/if}
					</Fold>
				{:else if key === 'tags'}
					<Fold bare key="stats-tags" title={tx('По тегам', 'By tags')} summary={data.tags.shown.map((t) => t.label).join(' · ') || undefined}>
						{#snippet aside()}
							<HelpIcon topicKey="stats.tags" label={tx('теги', 'tags')} />
							<button class="handle" data-handle aria-label={tx('По тегам: перетащить', 'By tags: drag')}><GripVertical size={18} /></button>
						{/snippet}
					{#if data.tags.shown.length}
						{@render compare(data.tags.shown)}
					{:else}
						<p class="muted">{tx('Тег появляется здесь, когда в нём набирается 10 закрытых гипотез. Теги ставятся в карточке гипотезы.', 'A tag appears here once it has 10 closed hypotheses. Tags are set in a hypothesis card.')}</p>
					{/if}
					{#if data.tags.gathering.length}
						<p class="muted small gathering">
							{tx('Набирают', 'Gathering')}: {data.tags.gathering.map((t) => `${t.label} (${t.closed} ${tx('из', 'of')} 10${t.open ? `, ${tx('открыто', 'open')} ${t.open}` : ''})`).join(', ')}
						</p>
					{/if}
					</Fold>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
<DisciplineStats />

{#snippet compare(sides: Side[])}
	<ul class="rows">
		{#each sides as s (s.key)}
			<li class="side">
				<span class="top">
					<b>{tl(s.label)}</b>
					<span class="grow"></span>
					<Rate score={s.score} />
				</span>
				<span class="muted small">
					{tx('закрыто', 'closed')} {s.score.n} · {tx('открыто', 'open')} {s.open}
					{#if s.score.n}· {tx('среднее', 'mean')} <Pct value={s.score.meanExcess} plain /> · {tx('медиана', 'median')} <Pct value={s.score.medianExcess} plain />{/if}
					{#if s.news.n}· {tx('новости отдельно', 'news apart')}: {s.news.hits} {tx('из', 'of')} {s.news.n}{/if}
				</span>
			</li>
		{/each}
	</ul>
{/snippet}

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin-bottom: var(--s3);
	}
	.grow {
		flex: 1;
	}
	.chip {
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.chip.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.hint {
		margin: 0 0 var(--s2);
	}
	.blocks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.card {
		padding: var(--s3) var(--s4) var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
		-webkit-touch-callout: none;
		user-select: none;
		transition: box-shadow 0.15s;
	}
	:global(.blocks.sorting) .card {
		transition: transform 0.15s;
	}
	:global(.card.dragging) {
		box-shadow: var(--shadow);
	}
	.handle {
		width: var(--tap);
		height: var(--tap);
		margin-right: calc(-1 * var(--s3));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--muted);
		touch-action: none;
		cursor: grab;
	}
	.lead {
		margin: 0 0 var(--s2);
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
	}
	.grid {
		stroke: var(--line);
		stroke-width: 1;
	}
	.diag {
		stroke: var(--muted);
		stroke-dasharray: 4 4;
	}
	.tick {
		fill: var(--muted);
		font-size: 11px;
	}
	.ci {
		stroke: var(--accent);
		stroke-width: 2;
		opacity: 0.5;
	}
	.dot {
		fill: var(--accent);
	}
	.dot.faint {
		opacity: 0.35;
	}
	.legend {
		margin: var(--s1) 0 var(--s2);
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		display: flex;
		align-items: baseline;
		gap: var(--s2);
		min-height: 36px;
		padding: var(--s1) 0;
		border-top: 1px solid var(--line);
	}
	.rows li.cal {
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
		padding: var(--s2) 0;
	}
	.cal .top {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--s2);
	}
	.rows li.side {
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
		padding: var(--s2) 0;
	}
	.side .top {
		display: flex;
		align-items: baseline;
		gap: var(--s2);
	}
	.lbl {
		width: 64px;
		flex: none;
		font-variant-numeric: tabular-nums;
	}
	.few {
		color: var(--muted);
		font-size: var(--fs-s);
		padding: 2px var(--s2);
		border-radius: var(--r-pill);
		background: var(--surface-2);
	}
	.prelim {
		font-size: var(--fs-xs);
		color: var(--warn-text);
		background: var(--warn-bg);
		padding: 1px var(--s2);
		border-radius: var(--r-pill);
	}
	.gathering {
		margin: var(--s2) 0 0;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 120px;
		margin-bottom: var(--s3);
		border-radius: var(--r3);
		background: var(--surface);
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.5;
		}
	}
</style>
