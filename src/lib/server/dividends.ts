import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { unitFactor } from '../portfolio.js';
import { marketView, portfolioView } from './portfolio.js';
import { splitScale } from './market/splits.js';

/**
 * Owner 28.11.2026: «сколько дивидендов я получил в этом году от каждой акции … как отслеживать дивидендную
 * стратегию; израильские банки падают, но дивиденды платят — и я это пропускаю». From the exchange's dividend history
 * (ex-date and amount a share, loaded every day for what is held) and the position's own trades:
 * - received this year — the shares held the day before each ex-date × the amount, before tax, in the portfolio's
 *   currency at that day's rate; what was recorded as «Дивиденд» in the portfolio's money next to it;
 * - the last 12 months a share, the yield on today's price and on the purchase price (yield on cost);
 * - the years in a row the yearly dividend grew, and a cut (the last payment a fifth under the one before, or the
 *   last full year under the year before);
 * - the next ex-date (announced, or guessed from the last one and the usual gap) and what it should bring;
 * - the total return since the purchase: the price and the dividends received together.
 * The amounts are split-adjusted by the provider; the shares held then are brought to today's split scale.
 */
export interface DivPayment {
	date: string;
	perShare: number;
	shares: number;
	/** in the portfolio's currency */
	value: number;
}

export function dividendView(app: Database.Database, market: Database.Database, portfolioId: number, today = israelDate()) {
	const v = portfolioView(app, market, portfolioId, today);
	if (!v) return null;
	const pc = v.portfolio.currency;
	const m = marketView(market);
	const year = today.slice(0, 4);
	const yearAgo = new Date(Date.parse(today + 'T12:00:00Z') - 365 * 86_400_000).toISOString().slice(0, 10);
	const divs = market.prepare(`select ex_date as date, amount from market_corporate_actions where security_id = ? and kind = 'dividend' and amount > 0 order by ex_date`);
	const nextQ = market.prepare(`select min(date) as d from ref_security_events where security_id = ? and kind = 'dividend' and date > ?`);
	const events = app.prepare(`select kind, date, qty from position_events e where position_id = ? and kind in ('buy', 'sell', 'opening') and cancelled_at is null
		and not exists (select 1 from position_events r where r.reverses_event_id = e.id and r.cancelled_at is null) order by date, id`);
	const recordedQ = app.prepare(`select coalesce(sum(amount), 0) as s from cash_events where portfolio_id = ? and position_id = ? and kind = 'dividend' and cancelled_at is null and substr(date, 1, 4) = ?`);

	const rows = v.positions
		.filter((p) => p.qty > 0 || (p.closedAt ?? '') >= `${year}-01-01`)
		.map((p) => {
			const all = divs.all(p.securityId) as { date: string; amount: number }[];
			const scale = splitScale(market, p.securityId);
			const f = unitFactor(p.priceUnit);
			const ev = events.all(p.id) as { kind: string; date: string; qty: number | null }[];
			// the shares held at the end of the day before an ex-date, in today's split scale
			const heldBefore = (d: string) => ev.filter((e) => e.date < d).reduce((n, e) => n + (e.kind === 'sell' ? -1 : 1) * (e.qty ?? 0), 0) * scale(d);
			const payments: DivPayment[] = [];
			for (const d of all) {
				if (d.date.slice(0, 4) !== year || d.date > today) continue;
				const shares = heldBefore(d.date);
				if (shares <= 1e-9) continue;
				payments.push({ date: d.date, perShare: d.amount, shares, value: shares * d.amount * f * m.conv(p.currency, pc, d.date) });
			}
			const sinceBuy = ev.length ? ev[0].date : null;
			let sinceBuyValue = 0;
			for (const d of all) {
				if (!sinceBuy || d.date <= sinceBuy || d.date > today) continue;
				const shares = heldBefore(d.date);
				if (shares > 1e-9) sinceBuyValue += shares * d.amount * f * m.conv(p.currency, pc, d.date);
			}
			// the last 12 months a share, how many payments, the yields
			const ttmList = all.filter((d) => d.date > yearAgo && d.date <= today);
			const ttm = ttmList.reduce((n, d) => n + d.amount, 0);
			const price = p.lastPrice;
			const yieldNow = price && ttm ? ttm / price : null;
			const yieldOnCost = p.avgPrice && ttm ? ttm / p.avgPrice : null;
			// yearly sums: the years in a row it grew; a cut
			const byYear = new Map<string, number>();
			for (const d of all) byYear.set(d.date.slice(0, 4), (byYear.get(d.date.slice(0, 4)) ?? 0) + d.amount);
			const full = [...byYear.entries()].filter(([y]) => y < year).sort((a, b) => a[0].localeCompare(b[0]));
			let growth = 0;
			for (let i = full.length - 1; i > 0; i--) {
				if (full[i][1] > full[i - 1][1] * 1.001) growth++;
				else break;
			}
			const last = all.at(-1);
			const prev = all.at(-2);
			const cut = (!!last && !!prev && last.amount < prev.amount * 0.8 && last.date > yearAgo) || (full.length >= 2 && full.at(-1)![1] < full.at(-2)![1] * 0.9);
			// the next ex-date: announced, or the last one + the usual gap between payments
			let next = (nextQ.get(p.securityId, today) as { d: string | null }).d;
			let guessed = false;
			if (!next && last && ttmList.length) {
				const gap = ttmList.length >= 4 ? 91 : ttmList.length >= 2 ? 182 : 365;
				let d = Date.parse(last.date + 'T12:00:00Z') + gap * 86_400_000;
				while (d <= Date.parse(today + 'T12:00:00Z')) d += gap * 86_400_000;
				next = new Date(d).toISOString().slice(0, 10);
				guessed = true;
			}
			const nextValue = next && last && p.qty > 0 ? p.qty * last.amount * f * m.conv(p.currency, pc, today) : null;
			const received = payments.reduce((n, x) => n + x.value, 0);
			const cost = p.qty > 0 && p.avgPrice ? p.qty * p.avgPrice * f * m.conv(p.currency, pc, today) : null;
			const priceReturn = p.avgPrice && price ? (price / p.avgPrice - 1) * 100 : null;
			return {
				positionId: p.id,
				securityId: p.securityId,
				symbol: p.symbol,
				name: p.name,
				qty: p.qty,
				priceUnit: p.priceUnit,
				received,
				payments,
				recorded: (recordedQ.get(portfolioId, p.id, year) as { s: number }).s,
				ttm,
				payments12: ttmList.length,
				yieldNow: yieldNow === null ? null : Math.round(yieldNow * 10000) / 100,
				yieldOnCost: yieldOnCost === null ? null : Math.round(yieldOnCost * 10000) / 100,
				annualIncome: p.qty > 0 ? p.qty * ttm * f * m.conv(p.currency, pc, today) : 0,
				growthYears: growth,
				cut,
				next,
				nextGuessed: guessed,
				nextValue,
				priceReturn: priceReturn === null ? null : Math.round(priceReturn * 10) / 10,
				// the price and the dividends received since the purchase, against what was paid
				totalReturn: priceReturn !== null && cost ? Math.round((priceReturn + (sinceBuyValue / cost) * 100) * 10) / 10 : null,
				dividendsSinceBuy: sinceBuyValue
			};
		})
		.filter((r) => r.ttm > 0 || r.received > 0 || r.recorded > 0);
	const income = rows.reduce((n, r) => n + r.annualIncome, 0);
	const soon = rows
		.filter((r) => r.next && r.qty > 0)
		.map((r) => ({ symbol: r.symbol, securityId: r.securityId, date: r.next!, guessed: r.nextGuessed, value: r.nextValue }))
		.sort((a, b) => a.date.localeCompare(b.date))
		.slice(0, 8);
	return {
		year,
		currency: pc,
		rows: rows.sort((a, b) => b.received - a.received || b.annualIncome - a.annualIncome),
		received: rows.reduce((n, r) => n + r.received, 0),
		recorded: rows.reduce((n, r) => n + r.recorded, 0),
		income,
		/** the expected yearly dividends over the value of the positions */
		portfolioYield: v.summary.held > 0 ? Math.round((income / v.summary.held) * 10000) / 100 : null,
		soon
	};
}

/**
 * Owner 28.11.2026: a security's dividend history — each year's total a share with the change against the year before,
 * the number of payments, the years in a row it grew, the cuts; the payments of the last two years. The current year
 * is marked as not complete yet. Amounts in the price's unit, split-adjusted by the provider.
 */
export function dividendHistory(market: Database.Database, securityId: number, today = israelDate()) {
	const all = market.prepare(`select ex_date as date, amount from market_corporate_actions where security_id = ? and kind = 'dividend' and amount > 0 order by ex_date`).all(securityId) as { date: string; amount: number }[];
	const year = today.slice(0, 4);
	const by = new Map<string, { total: number; n: number }>();
	for (const d of all) {
		const y = d.date.slice(0, 4);
		const e = by.get(y) ?? { total: 0, n: 0 };
		e.total += d.amount;
		e.n++;
		by.set(y, e);
	}
	const years = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([y, e], i, arr) => {
		const prev = i > 0 ? arr[i - 1][1].total : null;
		return { year: y, total: Math.round(e.total * 10000) / 10000, payments: e.n, partial: y === year, change: prev ? Math.round((e.total / prev - 1) * 1000) / 10 : null };
	});
	const full = years.filter((y) => !y.partial);
	let growth = 0;
	for (let i = full.length - 1; i > 0; i--) {
		if (full[i].total > full[i - 1].total * 1.001) growth++;
		else break;
	}
	const cuts = full.filter((y) => y.change !== null && y.change < -10).map((y) => y.year);
	// the 5 and 10 years' average yearly growth of the dividend (full years)
	const cagr = (n: number) => {
		if (full.length <= n) return null;
		const a = full[full.length - 1 - n].total;
		const b = full[full.length - 1].total;
		return a > 0 ? Math.round(((b / a) ** (1 / n) - 1) * 1000) / 10 : null;
	};
	const lastClose = (market.prepare('select close from market_prices_daily where security_id = ? order by date desc limit 1').get(securityId) as { close: number } | undefined)?.close ?? null;
	const yearAgo = new Date(Date.parse(today + 'T12:00:00Z') - 365 * 86_400_000).toISOString().slice(0, 10);
	const ttm = all.filter((d) => d.date > yearAgo && d.date <= today).reduce((n, d) => n + d.amount, 0);
	return {
		years: years.slice(-15),
		payments: all.filter((d) => d.date.slice(0, 4) >= String(Number(year) - 1)).reverse(),
		growthYears: growth,
		cuts,
		cagr5: cagr(5),
		cagr10: cagr(10),
		ttm,
		yieldNow: lastClose && ttm ? Math.round((ttm / lastClose) * 10000) / 100 : null
	};
}
