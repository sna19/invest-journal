import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { cashFlow, matches, twr, unitFactor, valueOn } from '../portfolio.js';
import { benchmarkId, book, marketView, portfolioRow } from './portfolio.js';

/**
 * The portfolio's report (owner's request 20.11.2026): how the portfolio went month by month, and the closed
 * trades — each sale against what the market did over the same days, to see what was done right.
 */

const r2 = (x: number) => Math.round(x * 100) / 100;

/** the last day of each month from `from` to `to`, and `to` itself */
function monthEnds(from: string, to: string): string[] {
	const out: string[] = [];
	let [y, m] = from.split('-').map(Number);
	for (;;) {
		const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
		if (end >= to) {
			out.push(to);
			break;
		}
		out.push(end);
		m++;
		if (m > 12) {
			m = 1;
			y++;
		}
	}
	return out;
}

export interface MonthRow {
	/** YYYY-MM */
	month: string;
	/** the month's time-weighted return, % */
	pct: number | null;
	/** the benchmark over the same days, % */
	benchPct: number | null;
	valueStart: number;
	valueEnd: number;
	/** money that came in (deposits, carried-over positions) less what went out */
	flows: number;
	/** what the month earned: the change of value less the flows */
	gain: number;
	realized: number;
	dividends: number;
	/** fees and tax written as money events */
	costs: number;
	/** the rest of the gain: the price (and the rate) of what is held */
	unrealized: number;
}

export interface TradeRow {
	positionId: number;
	symbol: string;
	name: string;
	exchange: string;
	buyDate: string;
	sellDate: string;
	days: number;
	qty: number;
	/** in the position's currency, % */
	returnPct: number;
	/** in the portfolio's currency, with the rates of both days */
	profitPc: number;
	/** the market (S&P 500 or TA-125 by the security's exchange) over the same days, % */
	benchPct: number | null;
	/** return − market, percentage points */
	excess: number | null;
	/** the price now against the sale's, % — whether the sale came early */
	afterPct: number | null;
	/** what the purchase came from */
	kind: 'hypothesis' | 'model' | 'own' | 'transfer';
	/** the lot came by «Перенесено» without a purchase price: the return is since the transfer */
	fromTransfer: boolean;
}

export function portfolioReport(app: Database.Database, market: Database.Database, id: number, today = israelDate()) {
	const p = portfolioRow(app, id);
	if (!p) return null;
	const pc = p.currency;
	const m = marketView(market);
	const { rows, evs, book: b } = book(app, m, id);
	const flow = cashFlow(b, m);
	const first = flow.flows[0]?.date ?? null;
	const rate = (c: string, d: string) => (c === pc ? 1 : m.conv(c, pc, d));

	// ── by months ───────────────────────────────────────────────────────────────
	const ends = first ? monthEnds(first, today) : [];
	const t = twr(b, m, today, ends);
	const growthAt = (d: string) => {
		let g = 1;
		for (const x of t.series) {
			if (x.date > d) break;
			g = x.growth;
		}
		return g;
	};
	const benchId = benchmarkId(market, pc === 'USD' ? 'benchmark:SPX' : 'benchmark:TA125');
	const bench = (from: string, to: string) => {
		const x = benchId ? m.price(benchId, from) : null;
		const y = benchId ? m.price(benchId, to) : null;
		return x && y ? (y / x - 1) * 100 : null;
	};

	// sales with their lots (FIFO), the events behind them
	const evById = new Map([...evs.values()].flat().map((e) => [e.id, e]));
	const sales = b.positions.flatMap((pos) => {
		const r = rows.find((x) => x.id === pos.id)!;
		return matches(pos.trades, pos.f).map((x) => ({ ...x, pos, r }));
	});

	const months: MonthRow[] = [];
	let prevEnd = first ? new Date(Date.parse(first + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10) : today;
	for (const end of ends) {
		const month = end.slice(0, 7);
		const within = (d: string) => d > prevEnd && d <= end;
		const vStart = first && prevEnd >= first ? valueOn(b, m, prevEnd, flow.history) : 0;
		const vEnd = valueOn(b, m, end, flow.history);
		const flows = flow.flows.filter((f) => within(f.date)).reduce((n, f) => n + f.value, 0);
		const gStart = prevEnd >= (first ?? '') ? growthAt(prevEnd) : 1;
		const realized = sales.filter((s) => within(s.sellDate)).reduce((n, s) => n + s.qty * (s.proceeds * s.fxSell - s.cost * s.fxBuy), 0);
		const dividends = b.cash.filter((c) => c.kind === 'dividend' && within(c.date)).reduce((n, c) => n + c.amount * rate(c.currency, c.date), 0);
		const costs = b.cash.filter((c) => (c.kind === 'fee' || c.kind === 'tax') && within(c.date)).reduce((n, c) => n + c.amount * rate(c.currency, c.date), 0);
		const gain = vEnd - vStart - flows;
		months.push({
			month,
			pct: r2((growthAt(end) / gStart - 1) * 100),
			benchPct: (() => {
				const x = bench(prevEnd >= (first ?? '') ? prevEnd : first!, end);
				return x === null ? null : r2(x);
			})(),
			valueStart: r2(vStart),
			valueEnd: r2(vEnd),
			flows: r2(flows),
			gain: r2(gain),
			realized: r2(realized),
			dividends: r2(dividends),
			costs: r2(costs),
			unrealized: r2(gain - realized - dividends + costs)
		});
		prevEnd = end;
	}

	// ── closed trades ───────────────────────────────────────────────────────────
	const secBench = new Map<string, number | undefined>();
	const benchOf = (exchange: string) => {
		const k = exchange === 'TASE' ? 'benchmark:TA125' : 'benchmark:SPX';
		if (!secBench.has(k)) secBench.set(k, benchmarkId(market, k as 'benchmark:SPX' | 'benchmark:TA125'));
		return secBench.get(k);
	};
	const DAY = 86_400_000;
	const trades: TradeRow[] = sales.map((s) => {
		const buy = evById.get(s.buyId) as { hypothesisId?: number | null; modelVersionId?: number | null } | undefined;
		const kind: TradeRow['kind'] = s.opening ? 'transfer' : buy?.modelVersionId ? 'model' : buy?.hypothesisId ? 'hypothesis' : 'own';
		const ret = (s.proceeds / s.cost - 1) * 100;
		const bid = benchOf(s.r.exchange_code);
		const bx = bid ? m.price(bid, s.buyDate) : null;
		const by = bid ? m.price(bid, s.sellDate) : null;
		const benchPct = bx && by ? (by / bx - 1) * 100 : null;
		const nowP = m.dayMove(s.pos.securityId)?.now ?? m.last(s.pos.securityId)?.close ?? null;
		const f = unitFactor(s.r.price_unit);
		const sellPrice = (s.proceeds + 0) / f;
		return {
			positionId: s.pos.id,
			symbol: s.r.symbol,
			name: s.r.security_name,
			exchange: s.r.exchange_code,
			buyDate: s.buyDate,
			sellDate: s.sellDate,
			days: Math.round((Date.parse(s.sellDate) - Date.parse(s.buyDate)) / DAY),
			qty: s.qty,
			returnPct: r2(ret),
			profitPc: r2(s.qty * (s.proceeds * s.fxSell - s.cost * s.fxBuy)),
			benchPct: benchPct === null ? null : r2(benchPct),
			excess: benchPct === null ? null : r2(ret - benchPct),
			afterPct: nowP && sellPrice > 0 ? r2((nowP / sellPrice - 1) * 100) : null,
			kind,
			fromTransfer: s.fromTransfer
		};
	});
	trades.sort((a, b) => b.sellDate.localeCompare(a.sellDate));

	const wins = trades.filter((x) => x.profitPc > 0);
	const losses = trades.filter((x) => x.profitPc < 0);
	const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
	const kinds = (['hypothesis', 'model', 'own', 'transfer'] as const)
		.map((k) => {
			const list = trades.filter((x) => x.kind === k);
			return {
				kind: k,
				n: list.length,
				profitPc: r2(list.reduce((n, x) => n + x.profitPc, 0)),
				beat: list.filter((x) => (x.excess ?? -1) > 0).length
			};
		})
		.filter((x) => x.n);
	return {
		portfolio: { id: p.id, name: p.name, currency: pc },
		from: first,
		benchLabel: pc === 'USD' ? 'S&P 500' : 'ТА-125',
		months,
		total: { pct: t.twr === null ? null : r2(t.twr * 100), benchPct: first ? (() => { const x = bench(first, today); return x === null ? null : r2(x); })() : null },
		trades,
		summary: {
			n: trades.length,
			profitPc: r2(trades.reduce((n, x) => n + x.profitPc, 0)),
			wins: wins.length,
			beat: trades.filter((x) => (x.excess ?? -1) > 0).length,
			withBench: trades.filter((x) => x.excess !== null).length,
			avgWinPct: avg(wins.map((x) => x.returnPct)),
			avgLossPct: avg(losses.map((x) => x.returnPct)),
			avgDaysWin: avg(wins.map((x) => x.days)),
			avgDaysLoss: avg(losses.map((x) => x.days)),
			soldEarly: trades.filter((x) => (x.afterPct ?? 0) > 10).length,
			kinds
		}
	};
}
