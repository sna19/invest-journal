<script lang="ts">
	import { keepScroll } from '#lib/scroll.js';
	import NewsMoves from '#lib/NewsMoves.svelte';
	import Fold from '#lib/Fold.svelte';
	import { loc, tl, tx } from '#lib/i18n.js';
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Wallet from '@lucide/svelte/icons/wallet';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Pencil from '@lucide/svelte/icons/pencil';
	import FileJson from '@lucide/svelte/icons/file-json';
	import TopBar from '#lib/TopBar.svelte';
	import Allocation from '#lib/portfolio/Allocation.svelte';
	import Dividends from '#lib/portfolio/Dividends.svelte';
	import TvLink from '#lib/TvLink.svelte';
	import type { AllocProfile } from '#lib/allocation.js';
	import Empty from '#lib/Empty.svelte';
	import Sheet from '#lib/Sheet.svelte';
	import HelpIcon from '#lib/HelpIcon.svelte';
	import Pct from '#lib/Pct.svelte';
	import EventForm from '#lib/portfolio/EventForm.svelte';
	import { goto } from '$app/navigation';
	import { israelDate } from '#lib/hypothesis.js';
	import { CASH_LABEL, money, priceText, qtyText, STAGE_LABEL, STAGES, type Stage } from '#lib/portfolio.js';
	import { watchActivity } from '#lib/activity.svelte.js';
	import { showToast } from '#lib/toast.svelte.js';
	import TradeSignals from '#lib/TradeSignals.svelte';
	import PortfolioProtection from '#lib/portfolio/PortfolioProtection.svelte';
	import FlagChips from '#lib/path/FlagChips.svelte';
	import ScoreDot from '#lib/ScoreDot.svelte';
	import PortfolioPath from '#lib/path/PortfolioPath.svelte';
	import type { Flag } from '#lib/path.js';
	import { protectFocus } from '#lib/portfolio/protect.svelte.js';
	import Feed from '#lib/journal/Feed.svelte';
	import ToJournal from '#lib/journal/ToJournal.svelte';
	import RiskReview from '#lib/portfolio/RiskReview.svelte';
	import { setScreenLinks } from '#lib/journal/screen.svelte.js';
	import LineChart, { colorOf, type Line } from '#lib/charts/LineChart.svelte';

	/**
	 * Spec section 18 — «Портфель»: the switcher of portfolios, the value in shekels and the return against the
	 * benchmarks, positions by stage (held, want to sell, want to buy, watching, closed). Real and virtual
	 * portfolios work the same; an automatic one follows its source's hypotheses.
	 */
	interface P {
		id: number;
		name: string;
		kind: 'real' | 'virtual';
		currency: 'USD' | 'ILS';
		auto_source_id: number | null;
		auto_amount_ils: number;
		sourceName?: string | null;
	}
	interface Pos {
		exchange: string;
		profile: AllocProfile | null;
		dayPct: number | null;
		dayPc: number | null;
		dayDate: string | null;
		id: number;
		securityId: number;
		symbol: string;
		name: string;
		currency: string;
		priceUnit: string;
		stage: Stage;
		qty: number;
		avgPrice: number | null;
		lastPrice: number | null;
		valuePc: number;
		unrealizedPct: number | null;
		unrealizedPc: number;
		realizedPc: number;
		fromTransfer: boolean;
		eventPrice: boolean;
		livePrice?: boolean;
		priceTime?: string | null;
		lastClose?: string | null;
		weight?: number;
		plan: { kind: string; price: number | null; amount: number | null; note: string | null } | null;
		closedAt: string | null;
	}
	interface View {
		portfolio: P;
		summary: {
			day: { money: number; pct: number | null; date: string; positions: number } | null;
			value: number;
			cash: number;
			held: number;
			invested: number;
			twrPct: number | null;
			from: string | null;
			currency: string;
			balances: { currency: string; amount: number; valuePc: number }[];
			realizedPc: number;
			unrealizedPc: number;
			fromTransfer: boolean;
			taxAccrued: number | null;
			fxUsd: number;
			pricesAsOf: string | null;
			quotesAt?: string | null;
			fxAt?: string | null;
			fetchedAt?: string | null;
			benchmark: { key: string; label: string; returnPct: number | null };
		};
		positions: Pos[];
		lastFee: Record<string, number>;
		cash: { id: number; kind: string; date: string; amount: number; currency: string; toAmount: number | null; toCurrency: string | null; note: string | null; cancelledAt: string | null; reversedBy: number | null; auto: boolean; canCancel: boolean; canReverse: boolean }[];
	}

	const KEY = 'portfolio-current';
	let list = $state<P[] | null>(null);
	let current = $state<number | null>(null);
	// T-032 Д-11: «+» on this screen writes about the open portfolio
	$effect(() => (v ? setScreenLinks([{ type: 'portfolio', id: String(v.portfolio.id), label: v.portfolio.name }]) : undefined));
	let v = $state<View | null>(null);
	let problem = $state<string | null>(null);
	let creating = $state(false);
	let newName = $state('');
	let newKind = $state<'real' | 'virtual'>('real');
	let newCurrency = $state<'USD' | 'ILS' | null>(null);
	// «Перенос позиций» (section 18): a pasted list, a preview, then «Перенести»
	let transferring = $state(false);
	let transferText = $state('');
	let transferPreview = $state<{
		date: string;
		currency: string;
		ok: boolean;
		rows: { n: number; text: string; kind: string; ok: boolean; warnings: string[]; error?: string; qty?: number; price?: number; valuePc?: number; valueNow?: number; match?: 'add' | 'same' | 'differs' | 'dedupe' | 'other_listing'; found?: { symbol: string; name: string; exchange: string; priceUnit: string; isNew?: boolean }; amount?: number; currency?: string }[];
		total: { positions: number; cash: number; cost: number; now: number; broker: number | null };
		match: { add: number; same: number; differs: number; dedupe: number; notListed: { symbol: string; qty: number }[] };
	} | null>(null);
	let transferBusy = $state(false);
	let transferError = $state<string | null>(null);
	async function transfer(apply: boolean) {
		transferBusy = true;
		transferError = null;
		try {
			const r = await fetch(`/api/portfolios/${current}/transfer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: transferText, apply }) });
			const j = await r.json().catch(() => ({}));
			// the securities' history and the recalculation go on in the background: the bar shows them
			watchActivity();
			if (!r.ok) return (transferError = tl(j.message) || tx('Не получилось', 'It did not work'));
			if (!apply) return (transferPreview = j);
			showToast(`${tx('Перенесено позиций', 'Positions carried over')}: ${j.added}${j.deduped ? `, ${tx('дубликатов убрано', 'duplicates removed')}: ${j.deduped}` : ''}${j.skipped.length ? `, ${tx('пропущено строк', 'lines skipped')}: ${j.skipped.length}` : ''}`);
			// «уже есть» is not a problem: only the lines that need a hand are kept open
			const real = j.skipped.filter((x: { why: string }) => x.why !== 'уже есть');
			if (!real.length) {
				transferring = false;
				transferText = '';
			}
			transferPreview = null;
			if (real.length) transferError = tx('Пропущены: ', 'Skipped: ') + real.map((x: { n: number; why: string }) => `${tx('строка', 'line')} ${x.n} — ${tl(x.why)}`).join('; ');
			load();
		} finally {
			transferBusy = false;
		}
	}
	let createError = $state<string | null>(null);
	let adding = $state<{ kind: string; securityId: number | null; hypothesisId: number | null; model?: 'A' | 'B' | 'C' | 'D' | 'G' | 'cA' | 'cB' | null; note?: string | null } | null>(null);
	let cashing = $state(false);
	// deleting a portfolio whole (owner's request): the name is typed back, the app copies the journal first
	let deleting = $state(false);
	let deleteName = $state('');
	let deleteError = $state<string | null>(null);
	async function removePortfolio() {
		deleteError = null;
		const r = await fetch(`/api/portfolios/${current}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmName: deleteName }) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (deleteError = tl(j.message) || tx('Не удалилось', 'Not deleted'));
		showToast(tx(`Портфель «${j.name}» удалён: позиций ${j.positions}, событий ${j.events}`, `Portfolio «${j.name}» deleted: positions ${j.positions}, events ${j.events}`));
		deleting = false;
		deleteName = '';
		current = null;
		await loadList();
		await load();
	}
	let cashKind = $state('deposit');
	let cashTo = $state('');
	let cashAmount = $state('');
	let cashCurrency = $state<'ILS' | 'USD'>('ILS');
	let cashDate = $state(israelDate());
	let cashNote = $state('');
	let cashError = $state<string | null>(null);

	async function loadList() {
		const r = await fetch('/api/portfolios').catch(() => null);
		if (!r?.ok) return (problem = tx('Нет связи с сервером.', 'No connection to the server.'));
		list = (await r.json()).items;
		if (!list!.some((p) => p.id === current)) current = list![0]?.id ?? null;
	}
	let loads = $state(0);
	// T-033: the marks of the return's path in the lists (positions, «Наблюдаю», «Хочу купить»)
	let pathFlags = $state<Record<number, Flag[]>>({});
	async function loadFlags() {
		const ids = [...new Set((v?.positions ?? []).filter((p: { stage: string }) => p.stage !== 'closed').map((p: { securityId: number }) => p.securityId))];
		if (!ids.length) return (pathFlags = {});
		const j = await fetch(`/api/path?flags=${ids.join(',')}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
		pathFlags = j?.items ?? {};
	}
	async function load() {
		if (current === null) return (v = null);
		const r = await fetch(`/api/portfolios/${current}`).catch(() => null);
		if (!r?.ok) return (problem = tx('Нет связи с сервером.', 'No connection to the server.'));
		v = await r.json();
		loads++;
		void loadFlags();
		problem = null;
		loadChart();
		void scroll.restore();
	}
	// back from a card: where the screen was (owner 26.11.2026)
	const scroll = keepScroll(() => `portfolio:${current}`);

	// section 19 «Портфель»: the return against the chosen virtual portfolios and the benchmarks
	interface Series {
		key: string;
		label: string;
		kind: string;
		points: { date: string; value: number }[];
	}
	let chart = $state<Series[] | null>(null);
	let compare = $state<number[]>([]);
	let hiddenSet = false;
	// only the portfolio's own benchmark is on at first (S&P 500 for dollars, TA-125 for shekels)
	let hidden = $state<string[]>([]);
	async function loadChart() {
		const r = await fetch(`/api/portfolios/${current}/chart?compare=${compare.join(',')}`).catch(() => null);
		chart = r?.ok ? (await r.json()).series : null;
		if (chart && !hiddenSet && v) {
			const own = v.summary.currency === 'USD' ? 'benchmark:SPX' : 'benchmark:TA125';
			hidden = chart.filter((x) => x.kind === 'benchmark' && x.key !== own).map((x) => x.key);
			hiddenSet = true;
		}
	}
	function toggleCompare(id: number) {
		compare = compare.includes(id) ? compare.filter((x) => x !== id) : [...compare, id];
		loadChart();
	}
	const toggleLine = (k: string) => (hidden = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]);
	const css = (n: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(n).trim());
	const lineColor = (sr: Series, i: number) =>
		sr.kind === 'portfolio' ? (i === 0 ? css('--accent') : colorOf(i + 2)) : sr.key.startsWith('benchmark:TA125') ? '#9a8a26' : sr.key.endsWith(':ils') ? '#c94040' : '#d9822b';
	const lines = $derived<Line[]>(
		(chart ?? [])
			.map((sr, i) => ({ key: sr.key, label: sr.label, points: sr.points, color: lineColor(sr, i), main: i === 0, dashed: sr.kind === 'benchmark' }))
			.filter((l) => l.main || !hidden.includes(l.key))
	);

	function choose(id: number) {
		current = id;
		hiddenSet = false;
		try {
			localStorage.setItem(KEY, String(id));
		} catch {
			/* ignore */
		}
		load();
	}

	/**
	 * Owner 19.11.2026: the screen stays current — reloaded at the quotes' frequency while visible, and when the
	 * phone comes back to it; ⟳ fetches quotes now.
	 */
	let every = $state(15);
	let refreshing = $state(false);
	let autoTimer: ReturnType<typeof setInterval> | undefined;
	async function refreshNow() {
		refreshing = true;
		await fetch('/api/data/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job: 'quotes' }) }).catch(() => null);
		await load();
		refreshing = false;
	}
	function startAuto() {
		clearInterval(autoTimer);
		if (every > 0) autoTimer = setInterval(() => document.visibilityState === 'visible' && load(), every * 60_000);
	}
	const onVisible = () => document.visibilityState === 'visible' && load();
	/**
	 * The refresh button's colour (owner 19.11.2026): yellow — refreshing; green — fetched within two periods of
	 * the schedule (at least 20 min, an hour when quotes are off); red — longer ago or never.
	 */
	let clock = $state(Date.now());
	const clockTimer = typeof window !== 'undefined' ? setInterval(() => (clock = Date.now()), 30_000) : undefined;
	const freshness = $derived.by(() => {
		if (refreshing) return 'busy';
		const f = v?.summary.fetchedAt;
		if (!f) return 'stale';
		const limit = (every ? Math.max(20, every * 2) : 60) * 60_000;
		return clock - Date.parse(f) <= limit ? 'fresh' : 'stale';
	});
	const FRESH_TITLE: Record<string, string> = { busy: 'Обновляется', fresh: 'Обновлено недавно', stale: 'Давно не обновлялось' }; // shown through tl()
	onDestroy(() => {
		clearInterval(autoTimer);
		clearInterval(clockTimer);
		if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
	});
	const hm = (iso: string) => new Date(iso).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
	const ago = (iso: string) => {
		const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
		return m < 60 ? tx(`${m} мин назад`, `${m} min ago`) : `${hm(iso)}${new Date(iso).toDateString() === new Date().toDateString() ? '' : ', ' + d(iso.slice(0, 10))}`;
	};

	onMount(async () => {
		fetch('/api/data/schedule')
			.then((r) => r.json())
			.then((j) => {
				every = j.quotesEvery || 0;
				startAuto();
			})
			.catch(() => {});
		document.addEventListener('visibilitychange', onVisible);
		try {
			current = Number(localStorage.getItem(KEY)) || null;
		} catch {
			/* ignore */
		}
		const want = Number(page.url.searchParams.get('p'));
		const pos = Number(page.url.searchParams.get('position'));
		if (want) current = want;
		await loadList();
		// T-030: a position opens as its security's card
		if (pos) return void goto(`/position/${pos}`, { replaceState: true });
		if (want || pos) replaceState('/portfolio', {});
		// from a hypothesis card: «Хочу купить» / «Купил» with the link to it (a real portfolio first)
		const add = Number(page.url.searchParams.get('add'));
		if (add) {
			const real = list?.find((p) => p.kind === 'real' && p.id === current) ?? list?.find((p) => p.kind === 'real');
			if (real) current = real.id;
			const k = page.url.searchParams.get('kind');
			const kind = k === 'buy' || k === 'watch' ? k : 'plan_buy';
			// T-020: from a model's candidate card — the trade is linked to the model and its version
			const mv = page.url.searchParams.get('model');
			adding = { kind, securityId: add, hypothesisId: Number(page.url.searchParams.get('hyp')) || null, model: mv === 'A' || mv === 'B' || mv === 'C' || mv === 'D' || mv === 'G' || mv === 'cA' || mv === 'cB' ? mv : null, note: page.url.searchParams.get('note') };
			replaceState('/portfolio', {});
			if (!real) creating = true;
		}
		await load();
	});

	async function create() {
		createError = null;
		const r = await fetch('/api/portfolios', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: newName, kind: newKind, currency: newCurrency }) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (createError = tl(j.message) || tx('Не создался', 'Not created'));
		creating = false;
		newName = '';
		await loadList();
		choose(j.id);
	}

	async function addCash() {
		cashError = null;
		const r = await fetch(`/api/portfolios/${current}/cash`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				kind: cashKind,
				amount: cashAmount,
				currency: cashCurrency,
				date: cashDate,
				note: cashNote,
				...(cashKind === 'convert' ? { toAmount: cashTo, toCurrency: cashCurrency === 'ILS' ? 'USD' : 'ILS' } : {})
			})
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (cashError = tl(j.message) || tx('Не сохранилось', 'Not saved'));
		showToast(`${CASH_LABEL[cashKind]}: ${money(Number(cashAmount.replace(',', '.')), cashCurrency)} — ${tx('записано', 'saved')}`);
		cashing = false;
		cashAmount = '';
		cashTo = '';
		cashNote = '';
		load();
	}
	/** «Изменить» (owner's request, 18.11.2026): the portfolio's name and currency, a money record's date and sums */
	let renaming = $state(false);
	let editName = $state('');
	let editCurrency = $state('ILS');
	let editError = $state<string | null>(null);
	function startRename() {
		if (!v) return;
		editName = v.portfolio.name;
		editCurrency = v.portfolio.currency;
		editError = null;
		renaming = true;
	}
	async function savePortfolio() {
		editError = null;
		const r = await fetch(`/api/portfolios/${current}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: editName, currency: editCurrency })
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (editError = tl((Object.values(j.errors ?? {})[0] as string) ?? j.message) || tx('Не сохранилось', 'Not saved'));
		renaming = false;
		showToast(tx('Портфель изменён', 'Portfolio changed'));
		await loadList();
		load();
	}
	let cashEdit = $state<{ id: number; kind: string; currency: string; toCurrency: string | null; date: string; amount: string; toAmount: string; note: string } | null>(null);
	let cashEditError = $state<string | null>(null);
	async function saveCashEdit() {
		if (!cashEdit) return;
		cashEditError = null;
		const r = await fetch(`/api/cash/${cashEdit.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ date: cashEdit.date, amount: cashEdit.amount, note: cashEdit.note, ...(cashEdit.kind === 'convert' ? { toAmount: cashEdit.toAmount } : {}) })
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return (cashEditError = tl((Object.values(j.errors ?? {})[0] as string) ?? j.message) || tx('Не сохранилось', 'Not saved'));
		cashEdit = null;
		showToast(tx('Запись изменена', 'Record changed'));
		load();
	}
	/** «Экспорт» (owner's request, 18.11.2026): the portfolio as JSON in a window, to copy into an AI adviser */
	let exportText = $state<string | null>(null);
	let exportError = $state<string | null>(null);
	let copied = $state(false);
	let exportEl = $state<HTMLTextAreaElement | undefined>();
	async function openExport() {
		exportError = null;
		copied = false;
		exportText = '';
		const r = await fetch(`/api/portfolios/${current}/export`).catch(() => null);
		if (!r?.ok) return (exportError = tx('Не получилось собрать данные', 'Could not gather the data'));
		exportText = JSON.stringify(await r.json(), null, 2);
	}
	async function copyExport() {
		if (!exportText) return;
		try {
			await navigator.clipboard.writeText(exportText);
		} catch {
			// older Safari: select the text and copy it the old way
			exportEl?.select();
			document.execCommand('copy');
		}
		copied = true;
		showToast(tx('Скопировано — вставьте в чат с AI', 'Copied — paste it into a chat with AI'));
	}
	async function undoCash(id: number, how: 'cancel' | 'reverse') {
		const r = await fetch(`/api/cash/${id}/${how}`, { method: 'POST' });
		if (!r.ok) return (problem = (await r.json().catch(() => ({}))).message ?? tx('Не получилось', 'It did not work'));
		showToast(how === 'cancel' ? tx('Запись отменена', 'Record cancelled') : tx('Сторно записано', 'Reversal saved'));
		load();
	}

	/**
	 * Sorting of the positions (owner's request, 18.11.2026): by the money put in, by ticker, by the change, by the
	 * whole profit. A second tap on the chosen key turns the order; the choice is remembered on this device.
	 */
	type SortKey = 'value' | 'day' | 'cost' | 'symbol' | 'change' | 'profit';
	const SORTS: { key: SortKey; label: string }[] = [
		{ key: 'value', label: 'Стоимость' },
		{ key: 'day', label: 'За день' },
		{ key: 'cost', label: 'Вложено' },
		{ key: 'symbol', label: 'Тикер' },
		{ key: 'change', label: 'Изменение' },
		{ key: 'profit', label: 'Прибыль' }
	];
	let sortKey = $state<SortKey | null>(null);
	let sortDesc = $state(true);
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('portfolio-sort') ?? 'null');
			if (saved && SORTS.some((x) => x.key === saved.key)) {
				sortKey = saved.key;
				sortDesc = !!saved.desc;
			}
		} catch {
			/* no storage: the order of entry */
		}
	});
	function setSort(k: SortKey) {
		if (sortKey === k) sortDesc = !sortDesc;
		else {
			sortKey = k;
			sortDesc = k !== 'symbol';
		}
		try {
			localStorage.setItem('portfolio-sort', JSON.stringify({ key: sortKey, desc: sortDesc }));
		} catch {
			/* not remembered */
		}
	}
	const costOf = (p: Pos) => p.valuePc - p.unrealizedPc;
	// the change since purchase of what is held now, as a broker shows it: unrealized / purchase cost
	const sincePurchase = $derived.by(() => {
		const held = (v?.positions ?? []).filter((p) => p.qty > 0 && (p.stage === 'holding' || p.stage === 'plan_sell'));
		const cost = held.reduce((n, p) => n + costOf(p), 0);
		const gain = held.reduce((n, p) => n + p.unrealizedPc, 0);
		return cost > 0 ? { pct: (gain / cost) * 100, gain } : null;
	});
	const profitOf = (p: Pos) => p.unrealizedPc + p.realizedPc;
	function sorted(rows: Pos[]): Pos[] {
		if (!sortKey) return rows;
		const k = sortKey;
		const val = (p: Pos): number | string | null =>
			k === 'symbol'
				? p.symbol
				: k === 'value'
					? (p.qty > 0 ? p.valuePc : null)
					: k === 'day'
						? p.dayPct
						: k === 'cost'
							? (p.qty > 0 ? costOf(p) : null)
							: k === 'change'
								? p.unrealizedPct
								: profitOf(p);
		return [...rows].sort((a, b) => {
			const x = val(a);
			const y = val(b);
			// a position without the number goes last in either order
			if (x === null || y === null) return x === y ? a.symbol.localeCompare(b.symbol) : x === null ? 1 : -1;
			const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
			// equal numbers: by ticker, so the order does not jump
			return (sortDesc ? -c : c) || a.symbol.localeCompare(b.symbol);
		});
	}
	/** «за день» today, «за 19 нояб.» when the change is of an earlier trading day (the exchange has not opened) */
	const dayWord = (date: string | null) => (!date || date >= israelDate() ? tx('за день', 'today') : `${tx('за', 'on')} ${d(date)}`);
	const by = (s: Stage) => sorted(v?.positions.filter((p) => p.stage === s) ?? []);
	// «17 нояб.» this year, «17 нояб. 2025» before it
	const d = (s: string) =>
		new Date(s + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', ...(s.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
</script>

<svelte:head><title>{tx('Портфель', 'Portfolio')} · {tx('Журнал гипотез', 'Hypothesis journal')}</title></svelte:head>

<TopBar title={tx('Портфель', 'Portfolio')} help="portfolio.kinds" />
{#if current !== null}{#key current}<TradeSignals portfolioId={current} />{/key}{/if}
<NewsMoves />

{#if list && list.length}
	<div class="switch" role="tablist" aria-label={tx('Портфели', 'Portfolios')}>
		{#each list as p (p.id)}
			<button role="tab" aria-selected={p.id === current} class:on={p.id === current} onclick={() => choose(p.id)}
				>{p.name}{#if p.kind === 'virtual' && !p.auto_source_id}<small> · {tx('вирт.', 'virt.')}</small>{/if}</button
			>
		{/each}
		<button class="add" aria-label={tx('Новый портфель', 'New portfolio')} onclick={() => (creating = true)}><Plus size={18} /></button>
	</div>
{/if}

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

{#if list === null}
	<div class="skeleton"></div>
{:else if !list.length}
	<Empty title={tx('Ваши портфели', 'Your portfolios')}>
		{tx('Здесь будут реальный портфель и виртуальные: позиции от «наблюдаю» до «продал», стоимость в шекелях и доходность против S&P 500 и ТА-125. Всё вводится вручную, сделка — за полминуты.', 'Here go your real portfolio and virtual ones: positions from «watching» to «sold», value and return against the S&P 500 and TA-125. Everything is entered by hand, a trade takes half a minute.')}
		{#snippet action()}<button onclick={() => ((newName = tx('Мой портфель', 'My portfolio')), (newKind = 'real'), (newCurrency = null), (creating = true))}>{tx('Создать портфель', 'Create a portfolio')}</button>{/snippet}
	</Empty>
{:else if v}
	{@const s = v.summary}
	{#if v.portfolio.kind === 'real' && !v.portfolio.auto_source_id}<PortfolioProtection portfolioId={v.portfolio.id} version={loads} />{/if}
	{#if v.portfolio.auto_source_id}
		<p class="auto">
			{tx('Автоматический: каждая гипотеза', 'Automatic: each hypothesis of')} «{tl(v.portfolio.sourceName)}» {tx('на рост покупается на', 'on a rise is bought for')} {money(v.portfolio.auto_amount_ils, v.portfolio.currency)} {tx('и продаётся при закрытии.', 'and sold when it closes.')}
			<HelpIcon topicKey="portfolio.source_auto" label={tx('автоматический портфель', 'automatic portfolio')} />
		</p>
	{/if}
	<section class="card summary">
		<div class="value">
			<span class="k">{tx('Стоимость', 'Value')}</span>
			<b>{money(s.value, s.currency)}</b>
			{#if s.day}<span class="dayall">{dayWord(s.day.date)} <Pct value={s.day.pct} /> <span class="dm">{money(s.day.money, s.currency, true)}</span></span>{/if}
			<span class="sub">{tx('в бумагах', 'in securities')} {money(s.held, s.currency)}</span>
			{#each s.balances as bl (bl.currency)}
				<span class="sub" class:neg={bl.amount < 0}
					>{tx('деньги', 'cash')} {money(bl.amount, bl.currency)}{bl.currency !== s.currency ? ` ≈ ${money(bl.valuePc, s.currency)}` : ''}</span
				>
			{/each}
			{#if s.taxAccrued}<span class="sub">{tx('начисленный налог', 'accrued tax')} {money(s.taxAccrued, s.currency)} ({tx('справочно', 'for reference')})</span>{/if}
		</div>
		<div class="ret">
			<span class="k">{tx('Доходность', 'Return')} <HelpIcon topicKey="portfolio.twr" label={tx('доходность TWR', 'TWR return')} /></span>
			<b><Pct value={s.twrPct} /></b>
			<span class="sub">{s.from ? `${tx('с', 'since')} ${d(s.from)}` : tx('пока нет сделок', 'no trades yet')}{s.fromTransfer ? tx(' · часть позиций — с даты переноса', ' · some positions — since carry-over') : ''}</span>
			<!-- owner 27.11.2026 «прибыльность не совпадает»: the broker shows the change since purchase — the same here, beside the TWR -->
			{#if sincePurchase}
				<span class="sub">{tx('с покупки', 'since purchase')} <b><Pct value={sincePurchase.pct} /></b> · {money(sincePurchase.gain, s.currency, true)} <HelpIcon topicKey="portfolio.twr" label={tx('доходность и «с покупки»', 'return and «since purchase»')} /></span>
			{/if}
		</div>
		{#if s.from}
			<ul class="bench">
				<li>
					<span>{tl(s.benchmark.label)}</span>
					<Pct value={s.benchmark.returnPct} plain />
					<span class="sub">{tx('за тот же срок', 'over the same period')}</span>
				</li>
			</ul>
		{/if}
		<p class="sub line">
			{tx('Реализовано', 'Realized')} {money(s.realizedPc, s.currency, true)} · {tx('не реализовано', 'unrealized')} {money(s.unrealizedPc, s.currency, true)}{#if s.balances.some((b) => b.currency !== s.currency) || v.positions.some((p) => p.currency !== s.currency && p.qty > 0)}
				· $ = {s.fxUsd} ₪ <HelpIcon topicKey="portfolio.fx" label={tx('курс', 'rate')} />{/if}
			<br /><span class="freshline"
				>{#if s.quotesAt}{tx('Котировки', 'Quotes')}: {ago(s.quotesAt)}{:else}{tx('Котировок за сегодня нет', 'No quotes today')}{/if}{#if s.pricesAsOf} · {tx('закрытия на', 'closes of')} {d(s.pricesAsOf)}{/if}
				<button class="ref {freshness}" onclick={refreshNow} disabled={refreshing} aria-label={tx('Обновить котировки сейчас', 'Refresh quotes now')} title={tl(FRESH_TITLE[freshness])}
					><span class:spin={refreshing}><RefreshCw size={13} /></span>{refreshing ? tx('Обновляю…', 'Refreshing…') : tx('Обновить', 'Refresh')}</button
				></span
			>
		</p>
	</section>

	{#if !v.portfolio.auto_source_id}
		<div class="actions">
			<button class="main" onclick={() => (adding = { kind: 'buy', securityId: null, hypothesisId: null })}>{tx('Купил', 'Bought')}</button>
			<button onclick={() => (adding = { kind: 'plan_buy', securityId: null, hypothesisId: null })}>{tx('Хочу купить', 'Want to buy')}</button>
			<button onclick={() => (adding = { kind: 'watch', securityId: null, hypothesisId: null })}>{tx('Наблюдаю', 'Watching')}</button>
			<button onclick={() => (cashing = true)}><Wallet size={18} /> {tx('Деньги', 'Cash')}</button>
			<button onclick={() => ((transferring = true), (transferPreview = null), (transferError = null))}>{tx('Перенос позиций', 'Carry over positions')}</button>
			<a class="together" href="/portfolio/together">{tx('Всё вместе', 'All together')}</a>
			<a class="together" href="/portfolio/report?p={v.portfolio.id}">{tx('Отчёт', 'Report')}</a>
			<a class="together" href="/portfolio/risk?p={v.portfolio.id}">{tx('Риск', 'Risk')}</a>
		</div>
	{/if}

	{#if !v.positions.length}
		<p class="muted center">{tx('Позиций пока нет. «Купил» — сделка; «Хочу купить» и «Наблюдаю» — бумага на заметку, с причиной.', 'No positions yet. «Bought» is a trade; «Want to buy» and «Watching» put a security on your list, with a reason.')}</p>
	{/if}

	{#if v.positions.length > 1}
		<div class="toggles sorts" role="group" aria-label={tx('Сортировка позиций', 'Sort positions')}>
			{#each SORTS as o (o.key)}
				<button class:on={sortKey === o.key} aria-pressed={sortKey === o.key} onclick={() => setSort(o.key)}
					>{tl(o.label)}{#if sortKey === o.key}{o.key === 'symbol' ? (sortDesc ? tx(' Я→А', ' Z→A') : tx(' А→Я', ' A→Z')) : sortDesc ? ' ↓' : ' ↑'}{/if}</button
				>
			{/each}
		</div>
	{/if}

	{#each STAGES as st (st)}
		{@const rows = by(st)}
		{#if rows.length}
			<Fold key="portfolio-stage-{st}" remind="portfolio.stages" title={`${STAGE_LABEL[st]} · ${rows.length}`} open={st !== 'closed'} summary={rows.map((r) => r.symbol).join(' · ')}>
				{#snippet aside()}{#if st === 'holding'}<HelpIcon topicKey="portfolio.stages" label={tx('этапы позиции', 'position stages')} />{/if}{/snippet}
				<ul class="list">
					{#each rows as p (p.id)}
						<li>
							<button onclick={() => goto(`/security/${p.securityId}?position=${p.id}`)}>
								<span class="top">
									<b>{p.symbol}</b>
									{#if st !== 'closed'}<ScoreDot id={p.securityId} />{/if}
									{#if st !== 'closed' && pathFlags[p.securityId]}<FlagChips flags={pathFlags[p.securityId]} />{/if}
									<span class="grow"></span>
									{#if st === 'holding' || st === 'plan_sell'}
										<span class="val">{money(p.valuePc, v.summary.currency)}</span>
										<span class="day" title={tx('за день', 'today')}><Pct value={p.dayPct} /></span>
										<b class="res" title={tx('с покупки', 'since purchase')}><Pct value={p.unrealizedPct} /></b>
										<span class="src" class:live={p.livePrice} title={p.livePrice && p.priceTime ? `${tx('котировка', 'quote')} ${hm(p.priceTime)}` : p.lastClose ? `${tx('закрытие', 'close')} ${d(p.lastClose)}` : tx('нет цены', 'no price')}></span>
									{:else if st === 'closed'}
										<span class="sub">{p.closedAt ? d(p.closedAt) : ''}</span>
										{#if p.realizedPc}<b class="res">{money(p.realizedPc, v.summary.currency, true)}</b>{/if}
									{:else if p.plan?.price}
										<span class="sub">{tx('по', 'at')} {priceText(p.plan.price, p.priceUnit)} · {tx('сейчас', 'now')} {priceText(p.lastPrice, p.priceUnit)}</span>
									{:else}
										<span class="sub">{priceText(p.lastPrice, p.priceUnit)}</span>
									{/if}
								</span>
								<span class="mid">
									{#if (st === 'holding' || st === 'plan_sell') && p.dayPc !== null}<span class="dayline">{dayWord(p.dayDate)} {money(p.dayPc, v.summary.currency, true)}</span>{' · '}{/if}{p.name}{#if st === 'holding' || st === 'plan_sell'}{' · '}{qtyText(p.qty)} {tx('шт.', 'pcs')} · {tx('доля', 'weight')} {Math.round(p.weight ?? 0)}%{#if sortKey === 'cost'} · {tx('вложено', 'invested')} {money(costOf(p), v.summary.currency)}{:else if sortKey === 'profit'} · {tx('прибыль', 'profit')} {money(profitOf(p), v.summary.currency, true)}{/if}{#if p.fromTransfer} · {tx('с даты переноса', 'since carry-over')}{/if}{#if p.eventPrice} · {tx('цена переноса', 'carry-over price')}{/if}{/if}
								</span>
								{#if p.plan?.note && st !== 'closed' && st !== 'holding'}<span class="note">{p.plan.note}</span>{/if}
								<ChevronRight size={18} />
							</button>
							<span class="tvpos"><TvLink exchange={p.exchange} symbol={p.symbol} /></span>
						</li>
					{/each}
				</ul>
			</Fold>
		{/if}
	{/each}

	{#if chart && chart[0]?.points.length > 1}
		<Fold key="portfolio-chart" title={tx('Доходность', 'Return')} remind="portfolio.chart">
			{#snippet aside()}<HelpIcon topicKey="portfolio.chart" label={tx('график доходности', 'return chart')} />{/snippet}
			<LineChart {lines} percent height={220} />
			<div class="toggles">
				{#each chart.slice(1).filter((sr) => sr.kind === 'benchmark') as sr (sr.key)}
					<button class:on={!hidden.includes(sr.key)} aria-pressed={!hidden.includes(sr.key)} onclick={() => toggleLine(sr.key)}>{sr.label}</button>
				{/each}
				{#each (list ?? []).filter((p) => p.id !== current) as p (p.id)}
					<button class:on={compare.includes(p.id)} aria-pressed={compare.includes(p.id)} onclick={() => toggleCompare(p.id)}>{p.name}</button>
				{/each}
			</div>
		</Fold>
	{/if}

	{#if v.positions.some((p) => p.valuePc > 0) || v.summary.cash > 0}
		<Allocation positions={v.positions} cash={v.summary.cash} currency={v.summary.currency} />
	{/if}
	<!-- owner 28.11.2026: what the held securities pay, and the dividend strategy's numbers -->
	{#key v.portfolio.id}<Dividends portfolioId={v.portfolio.id} version={loads} />{/key}


	{#if v.portfolio.kind === 'real' && !v.portfolio.auto_source_id}{#key v.portfolio.id}<RiskReview portfolioId={v.portfolio.id} currency={v.summary.currency} />{/key}{/if}
	<div class="tojournal">
		<ToJournal
			links={[{ type: 'portfolio', id: String(v.portfolio.id), label: v.portfolio.name }]}
			snapshot={() => ({
				type: 'portfolio',
				params: { portfolioId: v!.portfolio.id, name: v!.portfolio.name },
				data: { currency: v!.summary.currency, value: v!.summary.value, twrPct: v!.summary.twrPct, positions: v!.positions.filter((p) => p.qty > 0).map((p) => ({ symbol: p.symbol, weight: p.weight ?? 0, valuePc: p.valuePc, unrealizedPct: p.unrealizedPct })) }
			})}
		/>
	</div>
	<!-- T-032 Д-08: the portfolio's diary, with its securities' entries («через AAPL») -->
	{#if v && !v.portfolio.auto_source_id}<PortfolioPath portfolioId={v.portfolio.id} version={loads} />{/if}
	<Fold key="portfolio-journal" title={tx('Дневник', 'Diary')} open={false} remind="journal.inherit">
		{#snippet aside()}<HelpIcon topicKey="journal.inherit" label={tx('дневник портфеля', 'the portfolio\'s diary')} />{/snippet}
		{#key v.portfolio.id}<Feed scope={`portfolio:${v.portfolio.id}`} links={[{ type: 'portfolio', id: String(v.portfolio.id), label: v.portfolio.name }]} />{/key}
	</Fold>

	{#if v.cash.length}
		<Fold key="portfolio-cash" remind="portfolio.fx" title={`${tx('Деньги', 'Cash')} · ${v.cash.filter((c) => !c.cancelledAt && c.kind !== 'reverse').length}`} open={false}>
			<ul class="list cash">
				{#each v.cash as c (c.id)}
					<li class:off={c.cancelledAt || c.reversedBy || c.kind === 'reverse'}>
						<span class="when">{d(c.date)}</span>
						<span class="what"
							><b>{CASH_LABEL[c.kind]}</b> {money(c.amount, c.currency)}{#if c.kind === 'convert' && c.toAmount} → {money(c.toAmount, c.toCurrency ?? 'USD')} · {tx('курс', 'rate')} {(c.amount / c.toAmount).toFixed(4)}{/if}{#if c.note} · {c.note}{/if}{#if c.auto} · {tx('авто', 'auto')}{/if}</span
						>
						{#if !c.auto && !v.portfolio.auto_source_id && !c.cancelledAt && !c.reversedBy && c.kind !== 'reverse'}
							<button
								class="undo"
								aria-label={tx('Изменить запись', 'Edit the record')}
								title={tx('Изменить', 'Edit')}
								onclick={() =>
									((cashEditError = null),
									(cashEdit = { id: c.id, kind: c.kind, currency: c.currency, toCurrency: c.toCurrency, date: c.date, amount: String(c.amount), toAmount: c.toAmount === null ? '' : String(c.toAmount), note: c.note ?? '' }))}
								><Pencil size={16} /></button
							>
						{/if}
						{#if !c.auto && c.canCancel}
							<button class="undo" aria-label={tx('Отменить запись', 'Cancel the record')} onclick={() => undoCash(c.id, 'cancel')}><Undo2 size={16} /></button>
						{:else if !c.auto && c.canReverse}
							<button class="undo text" onclick={() => undoCash(c.id, 'reverse')}>{tx('Сторно', 'Reverse')}</button>
						{/if}
					</li>
				{/each}
			</ul>
		</Fold>
	{/if}
	<button class="delete edit" onclick={openExport}><FileJson size={16} /> {tx('Экспорт для AI', 'Export for AI')}</button>
	<button class="delete edit" onclick={startRename}><Pencil size={16} /> {tx('Название и валюта портфеля', 'Portfolio name and currency')}</button>
	<button class="delete" onclick={() => ((deleting = true), (deleteName = ''), (deleteError = null))}>{tx('Удалить портфель', 'Delete portfolio')} «{v.portfolio.name}»</button>
	<p class="muted small">{tx('Остаток денег — как у брокера; покупка без остатка только предупреждает. Для доходности недостающее считается взносом, так что она не искажается.', 'The cash balance is as at the broker; a purchase without cash only warns. For the return the shortfall counts as a deposit, so it is not distorted.')}</p>
{/if}

{#if creating}
	<Sheet title={tx('Новый портфель', 'New portfolio')} onclose={() => (creating = false)}>
		<div class="form">
			<label>{tx('Название', 'Name')} <input bind:value={newName} placeholder={tx('Мой портфель', 'My portfolio')} /></label>
			<div class="seg" role="radiogroup" aria-label={tx('Вид', 'Kind')}>
				<button role="radio" aria-checked={newKind === 'real'} class:on={newKind === 'real'} onclick={() => (newKind = 'real')}>{tx('Реальный', 'Real')}</button>
				<button role="radio" aria-checked={newKind === 'virtual'} class:on={newKind === 'virtual'} onclick={() => (newKind = 'virtual')}>{tx('Виртуальный', 'Virtual')}</button>
			</div>
			<span class="muted small">{tx('Валюта — в ней брокер показывает итог; сменить можно и потом', 'Currency — the one the broker shows the total in; it can be changed later')}</span>
			<div class="seg" role="radiogroup" aria-label={tx('Валюта', 'Currency')}>
				<button role="radio" aria-checked={newCurrency === 'USD'} class:on={newCurrency === 'USD'} onclick={() => (newCurrency = 'USD')}>$ {tx('доллары', 'dollars')}</button>
				<button role="radio" aria-checked={newCurrency === 'ILS'} class:on={newCurrency === 'ILS'} onclick={() => (newCurrency = 'ILS')}>₪ {tx('шекели', 'shekels')}</button>
			</div>
			<p class="muted small">
				{tx('Долларовый — бумаги США, бенчмарк S&P 500; шекелевый — бумаги TASE (и иностранные ETF, если брокер показывает их в шекелях), бенчмарк ТА-125. Реальный — ваши деньги, виртуальный — проверка идей без денег. Автоматический портфель источника включается в карточке источника.', 'Dollar — US securities, benchmark S&P 500; shekel — TASE securities (and foreign ETFs if the broker shows them in shekels), benchmark TA-125. Real — your money, virtual — testing ideas without money. A source\'s automatic portfolio is turned on in the source card.')}
			</p>
			{#if createError}<p class="err">{createError}</p>{/if}
			<button class="primary" disabled={!newName.trim() || !newCurrency} onclick={create}>{tx('Создать', 'Create')}</button>
		</div>
	</Sheet>
{/if}

{#if adding && current !== null && v}
	<Sheet title={adding.kind === 'buy' ? tx('Купил', 'Bought') : adding.kind === 'plan_buy' ? tx('Хочу купить', 'Want to buy') : tx('Наблюдаю', 'Watching')} onclose={() => (adding = null)}>
		<EventForm
			portfolioId={current}
			kind={adding.kind}
			securityId={adding.securityId}
			hypothesisId={adding.hypothesisId}
			modelVariant={adding.model ?? null}
			initialNote={adding.note ?? null}
			lastFee={v.lastFee}
			portfolioCurrency={v.summary.currency}
			portfolioValue={v.summary.value}
			onsaved={(pid) => {
				// T-021: a purchase opens its card with the cheat sheet for the broker
				if (adding?.kind === 'buy') protectFocus.positionId = pid;
				adding = null;
				showToast(tx('Записано', 'Saved'));
				goto(`/position/${pid}`);
			}}
			oncancel={() => (adding = null)}
		/>
		{#if adding.hypothesisId}<p class="muted small">{tx('Позиция будет связана с гипотезой', 'The position will be linked to hypothesis')} №{adding.hypothesisId}.</p>{/if}
		{#if adding.model}<p class="muted small">{tx(`Сделка будет связана с квартальной моделью, ${adding.model.startsWith('c') ? '(сырьё) ' : ''}вариант ${adding.model.endsWith('A') ? 'А' : 'Б'}, и версией её параметров.`, `The trade will be linked to the quarterly model, variant ${adding.model}, and the version of its parameters.`)}</p>{/if}
	</Sheet>
{/if}


{#if transferring && v}
	<Sheet title="{tx('Перенос позиций', 'Carry over positions')} · {v.portfolio.name}" onclose={() => (transferring = false)}>
		<div class="form">
			<p class="muted small">
				{tx('Позиции, купленные до начала ведения портфеля. По строке на бумагу, сначала строка с датой переноса:', 'Positions bought before you started the portfolio. One line per security, first a line with the carry-over date:')} <HelpIcon topicKey="portfolio.transfer" label={tx('перенос позиций', 'carry over positions')} />
			</p>
			<pre class="sample">{tx(`date 2026-11-17
SCHD 40.5 30.00            тикер, количество, цена
ESLT value=5000 cost=4000     стоимость и стоимость покупки
yahoo:CSPX.L value=10000      ETF UCITS (Лондон) — по символу Yahoo
cash ILS 5290.91 · cash USD 663.15 · tax 2881.45`, `date 2026-11-17
SCHD 40.5 30.00            ticker, quantity, price
ESLT value=5000 cost=4000     value and purchase cost
yahoo:CSPX.L value=10000      UCITS ETF (London) — by Yahoo symbol
cash ILS 5290.91 · cash USD 663.15 · tax 2881.45`)}</pre>
			<p class="muted small">
				{tx('Количество по стоимости = стоимость / цена закрытия на дату, до целых. Можно дописать avg=средняя цена или cost=стоимость покупки — тогда прибыль считается от покупки, иначе «с даты переноса». Данные остаются только в приложении.', 'Quantity from value = value / close on the date, to whole units. Add avg=average price or cost=purchase cost — then profit counts from the purchase, otherwise «since carry-over». The data stay in the app only.')}
			</p>
			<textarea rows="8" bind:value={transferText} spellcheck="false" aria-label={tx('Список позиций', 'Position list')}></textarea>
			{#if transferError}<p class="err">{transferError}</p>{/if}
			{#if transferPreview}
				{@const tp = transferPreview}
				<ul class="tp">
					{#each tp.rows as r (r.n)}
						<li class:bad={!r.ok || r.match === 'differs' || r.match === 'other_listing'} class:same={r.match === 'same'}>
							<span class="tn">{r.n}</span>
							<span class="tw">
								{#if r.kind === 'position'}
									<b>{r.found?.symbol ?? r.text.split(/\s/)[0]}</b>{#if r.found} {r.found.name} · {r.found.exchange}{/if}
									{#if r.found && r.qty !== undefined && r.price !== undefined} · {qtyText(r.qty)} × {priceText(r.price, r.found?.priceUnit ?? 'USD')} = {money(r.valuePc ?? 0, tp.currency)}{/if}
								{:else if r.kind === 'cash'}
									{tx('деньги', 'cash')} {money(r.amount ?? 0, r.currency ?? 'ILS')}
								{:else if r.kind === 'tax'}
									{tx('начисленный налог', 'accrued tax')} {money(r.amount ?? 0, tp.currency)}
								{:else if r.kind === 'total'}
									{tx('итог брокера по бумагам', 'the broker\'s total of the securities')} {money(r.amount ?? 0, tp.currency)}
								{:else}
									{r.text}
								{/if}
								{#each [...(r.error ? [r.error] : []), ...r.warnings] as w (w)}<small>{tl(w)}</small>{/each}
							</span>
						</li>
					{/each}
				</ul>
				<p class="small">
					{tx('На', 'On')} {d(tp.date)}: {tx('бумаги', 'securities')} <b>{money(tp.total.positions, tp.currency)}</b> + {tx('деньги', 'cash')} {money(tp.total.cash, tp.currency)} =
					<b>{money(tp.total.positions + tp.total.cash, tp.currency)}</b>{#if tp.total.cost} · {tx('стоимость покупки', 'purchase cost')} {money(tp.total.cost, tp.currency)}{/if}
				</p>
				<!-- owner 27.11.2026: the list against what the portfolio holds, and the check sum against the broker -->
				<p class="small">
					{tx(`Добавится: ${tp.match.add} · уже есть: ${tp.match.same} · дубликатов уберётся: ${tp.match.dedupe} · расходится: ${tp.match.differs}`, `To add: ${tp.match.add} · already there: ${tp.match.same} · duplicates to remove: ${tp.match.dedupe} · differ: ${tp.match.differs}`)}{#if tp.match.notListed.length} · <b>{tx('в портфеле, но нет в списке', 'in the portfolio but not in the list')}: {tp.match.notListed.map((x) => `${x.symbol} ${qtyText(x.qty)}`).join(', ')}</b>{/if}
				</p>
				<p class="small">
					{tx('По сегодняшним ценам', 'At today\'s prices')}: <b>{money(tp.total.now, tp.currency)}</b>{#if tp.total.broker !== null} · {tx('у брокера', 'at the broker')} {money(tp.total.broker, tp.currency)} · {tx('разница', 'difference')}
						<b class:err={Math.abs(tp.total.now - tp.total.broker) > tp.total.broker * 0.01}>{money(tp.total.now - tp.total.broker, tp.currency, true)} ({(((tp.total.now - tp.total.broker) / tp.total.broker) * 100).toFixed(2)}%)</b>{/if}
				</p>
				<button class="primary" disabled={transferBusy} onclick={() => transfer(true)}>{tp.ok ? tx('Перенести', 'Carry over') : tx('Перенести строки без ошибок', 'Carry over the lines without errors')}</button>
			{:else}
				<button class="primary" disabled={transferBusy || !transferText.trim()} onclick={() => transfer(false)}>{transferBusy ? tx('Проверяю…', 'Checking…') : tx('Проверить', 'Check')}</button>
			{/if}
		</div>
	</Sheet>
{/if}

{#if exportText !== null && v}
	<Sheet title="{tx('Экспорт', 'Export')} · {v.portfolio.name}" onclose={() => (exportText = null)}>
		<div class="form">
			<p class="muted small">{tx('Все данные портфеля в JSON: итоги, позиции с историей сделок, деньги, связанные гипотезы. Скопируйте и вставьте в чат с AI вместе со своим вопросом.', 'All the portfolio data in JSON: totals, positions with their trade history, cash, linked hypotheses. Copy it and paste into a chat with AI together with your question.')}</p>
			{#if exportError}
				<p class="err">{exportError}</p>
			{:else if !exportText}
				<p class="muted">{tx('Собираю…', 'Gathering…')}</p>
			{:else}
				<textarea class="export" readonly bind:this={exportEl} value={exportText} aria-label={tx('Данные портфеля в JSON', 'Portfolio data in JSON')}></textarea>
				<p class="muted small">{(exportText.length / 1024).toFixed(1)} {tx('КБ', 'KB')} · {tx('позиций', 'positions')} {v.positions.length}</p>
				<button class="primary" onclick={copyExport}>{copied ? tx('Скопировано ✓', 'Copied ✓') : tx('Скопировать', 'Copy')}</button>
			{/if}
		</div>
	</Sheet>
{/if}

{#if renaming && v}
	<Sheet title={tx('Портфель', 'Portfolio')} onclose={() => (renaming = false)}>
		<div class="form">
			<label>{tx('Название', 'Name')} <input bind:value={editName} maxlength="60" /></label>
			{#if !v.portfolio.auto_source_id}
				<span class="muted small">{tx('Валюта портфеля', 'Portfolio currency')}</span>
				<div class="seg" role="radiogroup" aria-label={tx('Валюта', 'Currency')}>
					<button role="radio" aria-checked={editCurrency === 'USD'} class:on={editCurrency === 'USD'} onclick={() => (editCurrency = 'USD')}>$ {tx('доллары', 'dollars')}</button>
					<button role="radio" aria-checked={editCurrency === 'ILS'} class:on={editCurrency === 'ILS'} onclick={() => (editCurrency = 'ILS')}>₪ {tx('шекели', 'shekels')}</button>
				</div>
				<p class="muted small">
					{tx('Сделки и деньги остаются в своих валютах; стоимость, доходность и итоги пересчитаются в новой валюте с самого начала, по курсу каждого дня. В долларовый портфель — только бумаги в долларах.', 'Trades and cash stay in their currencies; value, return and totals are recomputed in the new currency from the very start, at each day\'s rate. A dollar portfolio takes only dollar securities.')}
				</p>
			{/if}
			{#if editError}<p class="err">{editError}</p>{/if}
			<button class="primary" onclick={savePortfolio}>{tx('Сохранить', 'Save')}</button>
		</div>
	</Sheet>
{/if}

{#if cashEdit}
	<Sheet title="{tx('Изменить', 'Edit')}: {CASH_LABEL[cashEdit.kind].toLowerCase()}" onclose={() => (cashEdit = null)}>
		<div class="form">
			<label>{tx('Дата', 'Date')} <input type="date" bind:value={cashEdit.date} /></label>
			<label>{cashEdit.kind === 'convert' ? tx('Отдал', 'Gave') : tx('Сумма', 'Amount')}, {cashEdit.currency === 'USD' ? '$' : '₪'} <input inputmode="decimal" bind:value={cashEdit.amount} /></label>
			{#if cashEdit.kind === 'convert'}
				<label>{tx('Получил', 'Got')}, {cashEdit.toCurrency === 'USD' ? '$' : '₪'} <input inputmode="decimal" bind:value={cashEdit.toAmount} /></label>
			{/if}
			<label>{tx('Заметка', 'Note')} <input bind:value={cashEdit.note} /></label>
			<p class="muted small">{tx('Прежние значения сохранятся в журнале правок. Вид записи и валюта не меняются — для этого сторно и новая запись.', 'Old values are kept in the edit log. The kind and currency do not change — for that, a reversal and a new record.')}</p>
			{#if cashEditError}<p class="err">{cashEditError}</p>{/if}
			<button class="primary" onclick={saveCashEdit}>{tx('Сохранить', 'Save')}</button>
		</div>
	</Sheet>
{/if}

{#if deleting && v}
	<Sheet title={tx('Удалить портфель', 'Delete portfolio')} onclose={() => (deleting = false)}>
		<div class="form">
			<p>
				{tx('Портфель', 'Portfolio')} «<b>{v.portfolio.name}</b>» {tx('удалится целиком: позиций', 'is deleted entirely: positions')} {v.positions.length}, {tx('записей денег', 'cash records')} {v.cash.length} {tx('и вся их история. Вернуть его из приложения нельзя; перед удалением приложение сохранит копию журнала в резервных копиях.', 'and all their history. It cannot be brought back in the app; before deleting, the app saves a copy of the journal in the backups.')}
			</p>
			{#if v.portfolio.auto_source_id}<p class="muted small">{tx('Это автоматический портфель источника; если источник останется включённым, приложение заведёт его заново.', 'This is a source\'s automatic portfolio; if the source stays on, the app creates it again.')}</p>{/if}
			<label>{tx('Чтобы подтвердить, наберите название', 'To confirm, type the name')} <input bind:value={deleteName} placeholder={v.portfolio.name} autocomplete="off" /></label>
			{#if deleteError}<p class="err">{deleteError}</p>{/if}
			<button class="danger" disabled={deleteName.trim() !== v.portfolio.name} onclick={removePortfolio}>{tx('Удалить навсегда', 'Delete forever')}</button>
		</div>
	</Sheet>
{/if}

{#if cashing}
	<Sheet title={tx('Деньги портфеля', 'Portfolio cash')} onclose={() => (cashing = false)}>
		<div class="form">
			<div class="seg five" role="radiogroup" aria-label={tx('Вид', 'Kind')}>
				{#each ['deposit', 'convert', 'withdraw', 'dividend', 'fee', 'tax'] as k (k)}
					<button role="radio" aria-checked={cashKind === k} class:on={cashKind === k} onclick={() => (cashKind = k)}>{CASH_LABEL[k]}</button>
				{/each}
			</div>
			<div class="row">
				<label>{cashKind === 'convert' ? tx('Отдал', 'Gave') : tx('Сумма', 'Amount')} <input inputmode="decimal" bind:value={cashAmount} placeholder="0" /></label>
				<label
					>{tx('Валюта', 'Currency')}
					<select bind:value={cashCurrency}><option value="ILS">₪</option><option value="USD">$</option></select>
				</label>
			</div>
			{#if cashKind === 'convert'}
				<label
					>{tx('Получил', 'Got')}, {cashCurrency === 'ILS' ? '$' : '₪'}
					<input inputmode="decimal" bind:value={cashTo} placeholder="0" />
				</label>
				{#if Number(cashAmount.replace(',', '.')) > 0 && Number(cashTo.replace(',', '.')) > 0}
					<p class="muted small">
						{tx('Курс сделки', 'Deal rate')}: {(cashCurrency === 'ILS' ? Number(cashAmount.replace(',', '.')) / Number(cashTo.replace(',', '.')) : Number(cashTo.replace(',', '.')) / Number(cashAmount.replace(',', '.'))).toFixed(4)} ₪ {tx('за $ — с комиссией банка, фиксируется один раз.', 'per $ — with the bank fee, fixed once.')}
					</p>
				{/if}
			{/if}
			<label>{tx('Дата', 'Date')} <input type="date" max={israelDate()} bind:value={cashDate} /></label>
			<label>{tx('Заметка', 'Note')} <input bind:value={cashNote} placeholder={tx('необязательно', 'optional')} /></label>
			{#if cashError}<p class="err">{cashError}</p>{/if}
			<button class="primary" disabled={!cashAmount.trim() || (cashKind === 'convert' && !cashTo.trim())} onclick={addCash}>{tx('Записать', 'Save')}</button>
			<p class="muted small">
				{tx('Взнос и вывод — деньги извне, они не меняют доходность. Конвертация в долларовом портфеле — его взнос; в шекелевом — перевод между валютами. Дивиденд, комиссия и налог — часть доходности.', 'Deposits and withdrawals are money from outside; they do not change the return. A conversion in a dollar portfolio is its deposit; in a shekel one — a transfer between currencies. Dividends, fees and tax are part of the return.')}
			</p>
		</div>
	</Sheet>
{/if}

<style>
	.day {
		font-size: var(--fs-s);
	}
	.val {
		white-space: nowrap;
	}
	.dayline {
		white-space: nowrap;
		color: var(--text);
	}
	.dayall {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px;
		font-size: var(--fs-s);
		font-weight: 600;
	}
	.dayall .dm {
		font-weight: 400;
		color: var(--muted);
	}
	.switch {
		display: flex;
		gap: var(--s2);
		overflow-x: auto;
		scrollbar-width: none;
		margin-bottom: var(--s3);
	}
	.switch button {
		flex: none;
		min-height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
		font-size: var(--fs-s);
		cursor: pointer;
		white-space: nowrap;
	}
	.switch button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--bg);
	}
	.switch .add {
		display: inline-flex;
		align-items: center;
		min-width: 36px;
		justify-content: center;
		padding: 0;
	}
	.ch-head {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: var(--s2);
	}
	.toggles {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
		margin-top: var(--s2);
	}
	.toggles button {
		min-height: 32px;
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: none;
		font-size: var(--fs-s);
		color: var(--muted);
		cursor: pointer;
	}
	.toggles button.on {
		color: var(--text);
		border-color: var(--text);
	}
	.sorts {
		margin: var(--s3) 0 0;
	}
	.delete {
		display: block;
		margin: var(--s5) auto var(--s2);
		min-height: var(--tap);
		padding: 0 var(--s4);
		border: none;
		background: none;
		color: var(--down);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.export {
		width: 100%;
		height: 50vh;
		box-sizing: border-box;
		padding: var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
		white-space: pre;
		resize: none;
	}
	.freshline {
		display: inline-flex;
		align-items: center;
		gap: var(--s1);
	}
	.ref {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 28px;
		margin-left: var(--s1);
		padding: 0 10px;
		border: none;
		border-radius: 999px;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
		transition: background 0.2s;
	}
	.ref.fresh {
		background: #1f9d55;
	}
	.ref.busy {
		background: #e0a800;
		color: #1d1d1d;
	}
	.ref.stale {
		background: #d64545;
	}
	.ref:disabled {
		cursor: progress;
	}
	.spin {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.src {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--muted);
		opacity: 0.5;
		flex: none;
	}
	.src.live {
		background: var(--up);
		opacity: 1;
	}
	.delete.edit {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin-bottom: 0;
		color: var(--link);
	}
	.danger {
		min-height: var(--tap);
		border: none;
		border-radius: var(--r2);
		background: var(--down);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.danger:disabled {
		opacity: 0.4;
	}
	.neg {
		color: var(--down);
	}
	.together {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	.sample {
		margin: 0;
		padding: var(--s2) var(--s3);
		border-radius: var(--r1);
		background: var(--surface-2);
		font-size: var(--fs-xs);
		overflow-x: auto;
	}
	.form textarea {
		min-height: 160px;
		padding: var(--s2) var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		font-family: ui-monospace, monospace;
		font-size: 16px;
	}
	.tp {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--fs-s);
	}
	.tp li {
		display: flex;
		gap: var(--s2);
		padding: var(--s2);
		border-radius: var(--r1);
		background: var(--surface-2);
	}
	.tp li.same {
		opacity: 0.6;
	}
	.tp li.bad {
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.tn {
		flex: none;
		width: 20px;
		color: var(--muted);
	}
	.tw {
		display: flex;
		flex-direction: column;
	}
	.tw small {
		font-size: var(--fs-xs);
	}
	.auto {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 0 var(--s3);
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.card {
		padding: var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
		margin-bottom: var(--s3);
	}
	.summary {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s3);
	}
	.value,
	.ret {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.value b,
	.ret b {
		font-size: var(--fs-xl);
	}
	.k {
		display: flex;
		align-items: center;
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.sub {
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.bench {
		grid-column: 1 / -1;
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bench li {
		display: flex;
		gap: var(--s2);
		align-items: baseline;
	}
	.bench li span:first-child {
		width: 72px;
		color: var(--muted);
		font-size: var(--fs-s);
	}
	.line {
		grid-column: 1 / -1;
		margin: 0;
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s2);
		margin-bottom: var(--s3);
	}
	.actions button {
		justify-content: center;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: var(--tap);
		padding: 0 var(--s4);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		font-weight: 600;
		cursor: pointer;
	}
	.actions button.main {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}
	.stage {
		margin-bottom: var(--s3);
	}
	.n {
		color: var(--muted);
		font-weight: 400;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.list button {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s3) calc(var(--s4) + 20px) var(--s3) var(--s4);
		border: none;
		border-radius: var(--r2);
		background: var(--surface);
		text-align: left;
		cursor: pointer;
	}
	.list li {
		position: relative;
	}
	/* «TV ↗» in the row's corner, under the chevron */
	.tvpos {
		position: absolute;
		right: var(--s2);
		bottom: var(--s2);
	}
	.list button > :global(svg) {
		position: absolute;
		right: var(--s3);
		top: 35%;
		transform: translateY(-50%);
		color: var(--muted);
	}
	.top {
		display: flex;
		align-items: baseline;
		gap: var(--s2);
	}
	.grow {
		flex: 1;
	}
	.mid,
	.note {
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.note {
		font-style: italic;
	}
	.cash li {
		display: flex;
		align-items: center;
		gap: var(--s3);
		padding: var(--s2) var(--s3);
		border-radius: var(--r2);
		background: var(--surface);
	}
	.cash li.off .what {
		text-decoration: line-through;
		color: var(--muted);
	}
	.when {
		flex: none;
		width: 64px;
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.what {
		flex: 1;
	}
	.undo {
		min-width: 36px;
		min-height: 36px;
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.undo.text {
		color: var(--link);
		font-size: var(--fs-s);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.form label {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
		font-size: var(--fs-s);
		color: var(--muted);
	}
	.form input,
	.form select {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r1);
		background: var(--surface);
		color: var(--text);
		box-sizing: border-box;
		width: 100%;
	}
	.row {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: var(--s3);
	}
	.seg {
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: var(--r2);
		background: var(--surface-2);
	}
	.seg button {
		flex: 1;
		min-height: 36px;
		border: none;
		border-radius: var(--r1);
		background: none;
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.seg button.on {
		background: var(--surface);
		font-weight: 600;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
	}
	.seg.five button {
		padding: 0 2px;
	}
	.primary {
		min-height: var(--tap);
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.5;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
	.center {
		text-align: center;
	}
	.err {
		color: var(--down);
		margin: 0;
	}
	.warn {
		padding: var(--s3);
		border-radius: var(--r2);
		background: var(--warn-bg);
		color: var(--warn-text);
	}
	.skeleton {
		height: 160px;
		border-radius: var(--r3);
		background: var(--surface);
	}
	.tojournal {
		margin: var(--s2) 0;
	}
</style>
