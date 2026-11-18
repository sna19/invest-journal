import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { cashFlow, effective, splitFactor, valueOn } from '../portfolio.js';
import { benchmarkId, book, marketView, security } from './portfolio.js';

/**
 * Spec section 19 — what the charts show that TradingView does not: the price of a security together with the
 * hypotheses on it, the sources' signals and the owner's own trades; the portfolio's return against the
 * virtual ones and the benchmarks. Data only — the drawing is Lightweight Charts in the browser.
 */

/** Four decimals are plenty for a line on a phone and keep ten years under 100 KB. */
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export const PERIODS = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60, '10Y': 120 } as const;
export type Period = keyof typeof PERIODS;

export function periodStart(period: Period, today: string) {
	const [y, m, d] = today.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1 - PERIODS[period], d));
	return t.toISOString().slice(0, 10);
}

export interface Marker {
	id: string;
	date: string;
	/** where the marker stands, in the chart's price scale */
	price: number;
	kind: 'entry' | 'exit' | 'buy' | 'sell';
	label: string;
	/** for the colour: the source of a hypothesis */
	sourceId?: number;
	hypothesisId?: number;
	positionId?: number;
	direction?: string;
}

/** Spec section 19 «Бумага»: close and the benchmark from the same starting point; marks of hypotheses and trades. */
export function securityChart(app: Database.Database, market: Database.Database, id: number, period: Period = '1Y', today = israelDate()) {
	const s = security(market, id);
	if (!s) return null;
	const m = marketView(market);
	const from = periodStart(period, today);
	const benchId = benchmarkId(market, s.country === 'IL' ? 'benchmark:TA125' : 'benchmark:SPX');
	const rows = market.prepare('select date, close from market_prices_daily where security_id = ? and date >= ? order by date').all(id, from) as {
		date: string;
		close: number;
	}[];
	let bench: { date: string; value: number }[] = [];
	if (benchId && benchId !== id && rows.length) {
		const b = market.prepare('select date, close from market_prices_daily where security_id = ? and date >= ? order by date').all(benchId, rows[0].date) as {
			date: string;
			close: number;
		}[];
		const base = m.price(benchId, rows[0].date);
		// the benchmark brought to the security's first close: both lines start at one point
		if (base) bench = b.map((r) => ({ date: r.date, value: (r.close / base) * rows[0].close }));
	}
	const splits = m.splits(id);
	const scaled = (price: number, date: string) => price / splitFactor(date, splits);
	const markers: Marker[] = [];

	const hyps = app
		.prepare(
			`select h.id, h.direction, h.signal_type as signalType, h.status, h.entry_price as entryPrice, h.entry_price_date as entryPriceDate,
			        h.exit_price as exitPrice, h.exit_date as exitDate, h.excess_pct as excessPct, h.current_excess_pct as currentExcessPct,
			        h.horizon_date as horizonDate, h.outcome, a.source_id as sourceId, s.name as sourceName
			   from hypotheses h join articles a on a.id = h.article_id join sources s on s.id = a.source_id
			  where h.security_id = ? and h.status <> 'cancelled' order by h.entry_date`
		)
		.all(id) as {
		id: number;
		direction: string;
		signalType: string;
		status: string;
		entryPrice: number | null;
		entryPriceDate: string | null;
		exitPrice: number | null;
		exitDate: string | null;
		excessPct: number | null;
		currentExcessPct: number | null;
		horizonDate: string;
		outcome: string | null;
		sourceId: number;
		sourceName: string;
	}[];
	for (const h of hyps) {
		const arrow = h.direction === 'long' ? '▲' : '▼';
		if (h.entryPrice && h.entryPriceDate && h.entryPriceDate >= from)
			markers.push({
				id: `h${h.id}`,
				date: h.entryPriceDate,
				price: scaled(h.entryPrice, h.entryPriceDate),
				kind: 'entry',
				label: `${arrow} ${h.sourceName}`,
				sourceId: h.sourceId,
				hypothesisId: h.id,
				direction: h.direction
			});
		if (h.exitPrice && h.exitDate && h.exitDate >= from)
			markers.push({
				id: `x${h.id}`,
				date: h.exitDate,
				price: scaled(h.exitPrice, h.exitDate),
				kind: 'exit',
				label: `${h.outcome === 'hit' ? '✓' : '✗'} ${h.sourceName}`,
				sourceId: h.sourceId,
				hypothesisId: h.id,
				direction: h.direction
			});
	}

	// the owner's trades — automatic portfolios repeat the hypotheses, so they stay off the chart
	const pos = app
		.prepare(
			`select p.id, p.stage, p.portfolio_id as portfolioId, f.name as portfolio, f.kind, f.auto_source_id as auto
			   from positions p join portfolios f on f.id = p.portfolio_id where p.security_id = ? and f.archived_at is null order by p.id`
		)
		.all(id) as { id: number; stage: string; portfolioId: number; portfolio: string; kind: string; auto: number | null }[];
	for (const p of pos.filter((x) => !x.auto)) {
		const evs = app
			.prepare(
				`select id, kind, date, qty, price, fee, fx_rate as fxRate, reverses_event_id as reversesEventId, cancelled_at as cancelledAt
				   from position_events where position_id = ?`
			)
			.all(p.id) as Parameters<typeof effective>[0];
		for (const e of effective(evs))
			if ((e.kind === 'buy' || e.kind === 'sell') && e.price && e.date >= from)
				markers.push({
					id: `e${e.id}`,
					date: e.date,
					price: scaled(e.price, e.date),
					kind: e.kind,
					label: `${e.kind === 'buy' ? 'Купил' : 'Продал'}${p.kind === 'virtual' ? ' (вирт.)' : ''}`,
					positionId: p.id
				});
	}
	markers.sort((a, b) => a.date.localeCompare(b.date));

	const first = rows[0];
	const last = rows.at(-1);
	return {
		security: { id: s.id, symbol: s.symbol, name: s.name_en, exchange: s.exchange_code, currency: s.price_unit === 'USD' ? 'USD' : 'ILS', priceUnit: s.price_unit },
		benchmark: benchId && benchId !== id ? { id: benchId, label: s.country === 'IL' ? 'ТА-125' : 'S&P 500' } : null,
		period,
		points: rows.map((r) => ({ date: r.date, value: r4(r.close) })),
		bench: bench.map((b) => ({ date: b.date, value: r4(b.value) })),
		markers,
		change: first && last ? (last.close / first.close - 1) * 100 : null,
		benchChange: bench.length > 1 ? (bench.at(-1)!.value / bench[0].value - 1) * 100 : null,
		last: last ?? null,
		hypotheses: hyps.map((h) => ({
			id: h.id,
			direction: h.direction,
			signalType: h.signalType,
			status: h.status,
			sourceId: h.sourceId,
			sourceName: h.sourceName,
			entryPriceDate: h.entryPriceDate,
			horizonDate: h.horizonDate,
			excessPct: h.status === 'open' ? h.currentExcessPct : h.excessPct,
			outcome: h.outcome
		})),
		positions: pos
	};
}

/**
 * The growth of a portfolio day by day, in % from its first money: each day's value less the money that came
 * that day, against the day before (the same TWR, cut daily). Long histories are sampled weekly; days with outside
 * money always stay.
 */
export function portfolioSeries(app: Database.Database, market: Database.Database, id: number, today = israelDate(), dates?: string[]) {
	const m = marketView(market);
	const { book: b } = book(app, m, id);
	const cf = cashFlow(b, m);
	if (!cf.flows.length) return { start: null as string | null, points: [] as { date: string; value: number }[] };
	const start = cf.flows[0].date;
	const flowOn = new Map(cf.flows.map((f) => [f.date, f.value]));
	const days = [...new Set([...(dates ?? tradingDays(market, start, today)), ...cf.flows.map((f) => f.date), today])].filter((d) => d >= start && d <= today).sort();
	const keep = days.length > 600 ? days.filter((d, i) => i % 5 === 0 || flowOn.has(d) || i === days.length - 1) : days;
	let growth = 1;
	let prev = 0;
	const points: { date: string; value: number }[] = [];
	// the flows between two kept days all come on the later one
	let pending = 0;
	let k = 0;
	const flowDates = cf.flows.map((f) => f.date);
	for (const d of keep) {
		while (k < flowDates.length && flowDates[k] <= d) pending += cf.flows[k++].value;
		const v = valueOn(b, m, d, cf.history);
		// money at the day's close, the first day from the money itself — as in twr()
		if (prev > 1e-9) growth *= (v - pending) / prev;
		else if (pending > 1e-9) growth *= v / pending;
		pending = 0;
		prev = v;
		points.push({ date: d, value: (growth - 1) * 100 });
	}
	return { start, points };
}

function tradingDays(market: Database.Database, from: string, to: string) {
	return (
		market
			.prepare(
				`select distinct date from market_prices_daily where security_id in (select id from ref_securities where is_benchmark = 1) and date between ? and ? order by date`
			)
			.all(from, to) as { date: string }[]
	).map((r) => r.date);
}

/** Spec section 19 «Портфель»: the real portfolio against the chosen virtual ones and the benchmarks, % from its start. */
export function portfolioChart(app: Database.Database, market: Database.Database, id: number, compare: number[] = [], today = israelDate()) {
	const names = new Map(
		(app.prepare('select id, name from portfolios').all() as { id: number; name: string }[]).map((r) => [r.id, r.name])
	);
	if (!names.has(id)) return null;
	const main = portfolioSeries(app, market, id, today);
	const series = [{ key: `p${id}`, label: names.get(id)!, kind: 'portfolio', points: main.points }];
	for (const c of compare.filter((x) => x !== id && names.has(x)))
		series.push({ key: `p${c}`, label: names.get(c)!, kind: 'portfolio', points: portfolioSeries(app, market, c, today).points.filter((p) => !main.start || p.date >= main.start) });
	if (main.start) {
		const m = marketView(market);
		for (const [key, label, ils] of [
			['benchmark:SPX', 'S&P 500', false],
			['benchmark:SPX', 'S&P 500 в ₪', true],
			['benchmark:TA125', 'ТА-125', false]
		] as const) {
			const bid = benchmarkId(market, key);
			if (!bid) continue;
			const rows = market.prepare('select date, close from market_prices_daily where security_id = ? and date >= ? and date <= ? order by date').all(bid, main.start, today) as {
				date: string;
				close: number;
			}[];
			const base = m.price(bid, main.start);
			if (!base || !rows.length) continue;
			const fx0 = ils ? m.usd(main.start) : 1;
			series.push({
				key: `${key}${ils ? ':ils' : ''}`,
				label,
				kind: 'benchmark',
				points: rows.map((r) => ({ date: r.date, value: ((r.close * (ils ? m.usd(r.date) : 1)) / (base * fx0) - 1) * 100 }))
			});
		}
	}
	return { start: main.start, series };
}
