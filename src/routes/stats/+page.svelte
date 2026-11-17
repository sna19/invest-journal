<script lang="ts">
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
			problem = 'Нет связи с сервером.';
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
		if (Math.abs(d) < 5) return 'сходится';
		return d < 0 ? `сбывается на ${-d} п.п. реже` : `сбывается на ${d} п.п. чаще`;
	}
</script>

<svelte:head><title>Статистика · Журнал гипотез</title></svelte:head>

<TopBar title="Статистика" help="stats.screen" />

<div class="bar">
	<button class="chip" class:on={noDefault} aria-pressed={noDefault} onclick={toggle}>Без срока по умолчанию</button>
	<span class="grow"></span>
	{#if data && (data.total.closed || data.total.open)}<span class="muted small">закрыто {data.total.closed} · открыто {data.total.open}</span>{/if}
</div>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if data === null}
	{#each [1, 2, 3] as i (i)}<div class="skeleton"></div>{/each}
{:else if !data.total.closed && !data.total.open}
	<Empty title="Калибровка и сравнения">
		Здесь будет видно, сбывается ли ваша уверенность («ставлю 70% — сбывается ли 70%»), как ваши идеи выглядят рядом с внешними
		источниками и чем симуляция отличается от реальных денег. Всё считается по закрытым гипотезам.
		{#snippet action()}<a href="/new">Новая гипотеза</a>{/snippet}
	</Empty>
{:else}
	<p class="muted small hint">Блоки можно поменять местами: удерживайте блок или тяните за ≡.</p>
	<ul class="blocks" use:sortable={{ preview: (k) => (preview = k), drop: saveOrder }}>
		{#each shown as key (key)}
			<li class="card" data-key={key}>
				{#if key === 'calibration'}
					{@const c = data.calibration}
					<div class="head">
						<h2>Калибровка</h2>
						<HelpIcon topicKey="stats.calibration" label="калибровка" />
						<span class="grow"></span>
						<button class="handle" data-handle aria-label="Калибровка: перетащить"><GripVertical size={18} /></button>
					</div>
					{#if !c.n}
						<p class="muted">
							Появится, когда закроются гипотезы с заполненной уверенностью.{#if c.without}
								Сейчас закрыто {c.without} без уверенности — они в калибровку не входят.{/if}
						</p>
					{:else}
						<p class="lead">
							В среднем ставите <b>{Math.round(c.meanConf!)}%</b>, сбывается <b>{pct(c.rate!)}%</b>
							<span class="muted">({c.hits} из {c.n})</span>
						</p>
						<svg viewBox="0 0 {W} {H}" role="img" aria-label="График калибровки: заявленная уверенность против доли сработавших">
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
						<p class="muted small legend">По горизонтали — какую уверенность ставили, по вертикали — сколько сбылось. Точки на диагонали — уверенность честная; бледные — меньше 10 гипотез.</p>
						<ul class="rows">
							{#each c.buckets as b (b.from)}
								<li class="cal">
									<span class="top">
										<span class="lbl">{b.label}</span>
										{#if b.level === 'few'}
											<span class="few">мало данных · {b.hits} из {b.n}</span>
										{:else}
											<b>{pct(b.rate!)}%</b>
											<span class="muted small">{pct(b.ci![0])}–{pct(b.ci![1])}%</span>
											{#if b.level === 'prelim'}<span class="prelim">предварительно</span>{/if}
										{/if}
									</span>
									{#if b.level !== 'few'}
										<span class="muted small">ставили в среднем {Math.round(b.meanConf)}%, сработало {b.hits} из {b.n}{gap(b) ? ` — ${gap(b)}` : ''}</span>
									{/if}
								</li>
							{/each}
						</ul>
						{#if c.without}<p class="muted small">Ещё {c.without} закрытых без уверенности — в калибровку не входят.</p>{/if}
					{/if}
				{:else if key === 'own' || key === 'mode'}
					{@const sides = key === 'own' ? data.own : data.mode}
					<div class="head">
						<h2>{key === 'own' ? 'Свои идеи и внешние источники' : 'Симуляция и реальные деньги'}</h2>
						<HelpIcon topicKey={key === 'own' ? 'stats.own' : 'stats.mode'} label={key === 'own' ? 'свои идеи' : 'режимы'} />
						<span class="grow"></span>
						<button class="handle" data-handle aria-label="Блок: перетащить"><GripVertical size={18} /></button>
					</div>
					{#if sides.every((s) => !s.score.n && !s.open)}
						<p class="muted">
							{key === 'own'
								? 'Появится, когда закроются гипотезы с источником «Собственная идея» или внешним.'
								: 'Появится, когда закроются гипотезы в режимах «симуляция» и «реальные деньги».'}
						</p>
					{:else}
						{@render compare(sides)}
					{/if}
				{:else if key === 'tags'}
					<div class="head">
						<h2>По тегам</h2>
						<HelpIcon topicKey="stats.tags" label="теги" />
						<span class="grow"></span>
						<button class="handle" data-handle aria-label="По тегам: перетащить"><GripVertical size={18} /></button>
					</div>
					{#if data.tags.shown.length}
						{@render compare(data.tags.shown)}
					{:else}
						<p class="muted">Тег появляется здесь, когда в нём набирается 10 закрытых гипотез. Теги ставятся в карточке гипотезы.</p>
					{/if}
					{#if data.tags.gathering.length}
						<p class="muted small gathering">
							Набирают: {data.tags.gathering.map((t) => `${t.label} (${t.closed} из 10${t.open ? `, открыто ${t.open}` : ''})`).join(', ')}
						</p>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#snippet compare(sides: Side[])}
	<ul class="rows">
		{#each sides as s (s.key)}
			<li class="side">
				<span class="top">
					<b>{s.label}</b>
					<span class="grow"></span>
					<Rate score={s.score} />
				</span>
				<span class="muted small">
					закрыто {s.score.n} · открыто {s.open}
					{#if s.score.n}· среднее <Pct value={s.score.meanExcess} plain /> · медиана <Pct value={s.score.medianExcess} plain />{/if}
					{#if s.news.n}· новости отдельно: {s.news.hits} из {s.news.n}{/if}
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
	.head {
		display: flex;
		align-items: center;
		gap: 2px;
		min-height: var(--tap);
	}
	h2 {
		margin: 0;
		font-size: var(--fs-m);
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
