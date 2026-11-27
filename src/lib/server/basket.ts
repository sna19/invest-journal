import type Database from 'better-sqlite3';
import { benchmarkId } from './portfolio.js';

/**
 * Owner 27.11.2026, a set's «Корзина»: if every security of the set had been bought for the same money at the start
 * of the period and held (not rebalanced) — the basket's value against the market's index over the same days, its
 * worst drawdown and each security's part of the result. Prices adjusted for dividends and splits. A security without
 * a price at the start is left out and named.
 */
export function basket(market: Database.Database, ids: number[], years: number, today = new Date()) {
	const from = new Date(today.getTime() - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
	const q = market.prepare('select date, adj_close as v from market_prices_adjusted where security_id = ? and date >= ? order by date');
	const meta = market.prepare(`select s.symbol, e.country from ref_securities s join ref_exchanges e on e.code = s.exchange_code where s.id = ?`);
	const series = new Map<number, Map<string, number>>();
	const out: number[] = [];
	const symbols = new Map<number, string>();
	let il = 0;
	for (const id of ids) {
		const m = meta.get(id) as { symbol: string; country: string } | undefined;
		symbols.set(id, m?.symbol ?? '?');
		if (m?.country === 'IL') il++;
		const rows = q.all(id, from) as { date: string; v: number }[];
		// held from the start of the period: a first price within 10 days of it
		if (rows.length < 20 || Date.parse(rows[0].date) - Date.parse(from) > 10 * 86_400_000) {
			out.push(id);
			continue;
		}
		series.set(id, new Map(rows.map((r) => [r.date, r.v])));
	}
	const bench = benchmarkId(market, il > ids.length / 2 ? 'benchmark:TA125' : 'benchmark:SPX');
	const benchRows = bench ? (q.all(bench, from) as { date: string; v: number }[]) : [];
	const members = [...series.keys()];
	if (!members.length) return { years, members: [], left: out.map((id) => ({ id, symbol: symbols.get(id)! })), points: [], bench: [], benchLabel: null, total: null, benchTotal: null, perYear: null, maxDrawdown: null, benchDrawdown: null, parts: [] };
	// the days: those of the benchmark (or of the first member), each member's last known value carried
	const days = (benchRows.length ? benchRows.map((r) => r.date) : [...series.get(members[0])!.keys()]).filter((d) => d >= from);
	const last = new Map<number, number>();
	const first = new Map<number, number>();
	const points: { date: string; value: number }[] = [];
	for (const d of days) {
		let sum = 0;
		let n = 0;
		for (const id of members) {
			const v = series.get(id)!.get(d);
			if (v !== undefined) last.set(id, v);
			const lv = last.get(id);
			if (lv === undefined) continue;
			if (!first.has(id)) first.set(id, lv);
			sum += lv / first.get(id)!;
			n++;
		}
		if (n === members.length) points.push({ date: d, value: Math.round((sum / n) * 10000) / 100 });
	}
	const b0 = benchRows.find((r) => r.date >= (points[0]?.date ?? from))?.v;
	const benchPts = b0 ? benchRows.filter((r) => r.date >= points[0].date).map((r) => ({ date: r.date, value: Math.round((r.v / b0) * 10000) / 100 })) : [];
	const dd = (p: { value: number }[]) => {
		let peak = -Infinity;
		let worst = 0;
		for (const x of p) {
			peak = Math.max(peak, x.value);
			worst = Math.min(worst, x.value / peak - 1);
		}
		return Math.round(worst * 1000) / 10;
	};
	const total = points.length ? Math.round((points.at(-1)!.value - 100) * 10) / 10 : null;
	const span = points.length > 1 ? (Date.parse(points.at(-1)!.date) - Date.parse(points[0].date)) / (365.25 * 86_400_000) : 0;
	const parts = members
		.map((id) => {
			const r = (last.get(id)! / first.get(id)! - 1) * 100;
			return { id, symbol: symbols.get(id)!, ret: Math.round(r * 10) / 10, part: Math.round((r / members.length) * 10) / 10 };
		})
		.sort((a, b) => b.part - a.part);
	return {
		years,
		members,
		left: out.map((id) => ({ id, symbol: symbols.get(id)! })),
		points,
		bench: benchPts,
		benchLabel: bench ? (il > ids.length / 2 ? 'ТА-125' : 'S&P 500') : null,
		total,
		benchTotal: benchPts.length ? Math.round((benchPts.at(-1)!.value - 100) * 10) / 10 : null,
		perYear: total !== null && span > 0.9 ? Math.round(((1 + total / 100) ** (1 / span) - 1) * 1000) / 10 : null,
		maxDrawdown: points.length ? dd(points) : null,
		benchDrawdown: benchPts.length ? dd(benchPts) : null,
		parts
	};
}
