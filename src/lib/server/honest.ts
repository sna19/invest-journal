import type Database from 'better-sqlite3';
import { israelDate } from '../hypothesis.js';
import { benchmarkId, marketView } from './portfolio.js';

/**
 * T-032 11д «Честный разбор» (spec 23, Д-41 — Д-45): the decisions of a month or a quarter by their basis and type — how
 * many came true, the result against the market and how long they were held; the refusals and what the security did after
 * them; the pause from the first entry about a security to the decision; the weekly pick — entries whose security moved
 * far since they were written, and reminders snoozed three times or more.
 */

const r1 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY));
const avg = (xs: (number | null)[]) => {
	const v = xs.filter((x): x is number => x !== null);
	return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export function periodOf(kind: 'month' | 'quarter' | 'all', today = israelDate()) {
	const [y, m] = today.split('-').map(Number);
	if (kind === 'all') return { from: '0000-01-01', to: today, label: 'всё время' };
	if (kind === 'month') return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: today, label: `${String(m).padStart(2, '0')}.${y}` };
	const q = Math.ceil(m / 3);
	return { from: `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, to: today, label: `Q${q} ${y}` };
}

interface Dec {
	id: number;
	createdAt: string;
	type: string;
	basis: string;
	securityId: number;
	positionId: number | null;
	eventId: number | null;
	outcome: string | null;
	reviewDate: string | null;
	symbol?: string;
}

export function honestReview(app: Database.Database, market: Database.Database, period: { from: string; to: string; label: string }, today = israelDate()) {
	const m = marketView(market);
	const sym = market.prepare('select symbol, exchange_code as x from ref_securities where id = ?');
	const bench = (sid: number) => {
		const x = (sym.get(sid) as { x: string } | undefined)?.x;
		return benchmarkId(market, x === 'TASE' ? 'benchmark:TA125' : 'benchmark:SPX');
	};
	const priceOn = (sid: number, d: string) => m.price(sid, d.slice(0, 10));
	const now = (sid: number) => m.dayMove(sid)?.now ?? m.last(sid)?.close ?? null;
	const decs = (
		app
			.prepare(
				`select id, created_at as createdAt, type, basis, security_id as securityId, position_id as positionId, event_id as eventId, outcome, review_date as reviewDate
				   from decisions where cancelled_at is null and substr(created_at, 1, 10) between ? and ? order by created_at`
			)
			.all(period.from, period.to) as Dec[]
	).map((d) => ({ ...d, symbol: (sym.get(d.securityId) as { symbol: string } | undefined)?.symbol ?? `#${d.securityId}` }));
	const ev = app.prepare('select date, price from position_events where id = ?');
	const nextSale = app.prepare(
		`select e.date, e.price from decisions d join position_events e on e.id = d.event_id where d.position_id = ? and d.type in ('sell', 'trim') and d.cancelled_at is null and d.id > ? order by d.id limit 1`
	);

	// a purchase's result: from its price to the sale (or now), against the market over the same days
	const buys = decs
		.filter((d) => (d.type === 'buy' || d.type === 'add') && d.eventId)
		.map((d) => {
			const e = ev.get(d.eventId) as { date: string; price: number | null };
			const s = d.positionId ? (nextSale.get(d.positionId, d.id) as { date: string; price: number } | undefined) : undefined;
			const end = s?.date ?? today;
			const exit = s?.price ?? now(d.securityId);
			const ret = e?.price && exit ? (exit / e.price - 1) * 100 : null;
			const b = bench(d.securityId);
			const bRet = b ? (() => {
				const x = priceOn(b, e.date);
				const y = s ? priceOn(b, s.date) : now(b);
				return x && y ? (y / x - 1) * 100 : null;
			})() : null;
			// Д-43: the pause — from the first entry about the security to the decision, and the price over it
			const first = app
				.prepare(`select min(e.created_at) as at from journal_entries e join entry_links l on l.entry_id = e.id where l.object_type = 'security' and l.object_id = ? and e.created_at < ?`)
				.get(String(d.securityId), d.createdAt) as { at: string | null };
			const pauseDays = first.at ? days(first.at, d.createdAt) : null;
			const p0 = first.at ? priceOn(d.securityId, first.at) : null;
			const pausePct = p0 && e?.price ? (e.price / p0 - 1) * 100 : null;
			return { ...d, ret: r1(ret), excess: r1(ret !== null && bRet !== null ? ret - bRet : null), held: days(e?.date ?? d.createdAt, end), closed: !!s, pauseDays, pausePct: r1(pausePct) };
		});

	const group = (key: 'basis' | 'type') => {
		const keys = [...new Set(buys.map((d) => d[key]))];
		return keys.map((k) => {
			const xs = buys.filter((d) => d[key] === k);
			const judged = xs.filter((d) => d.outcome && d.outcome !== 'early');
			return {
				key: k,
				n: xs.length,
				cameTrue: judged.filter((d) => d.outcome === 'yes' || d.outcome === 'partly').length,
				judged: judged.length,
				avgExcess: avg(xs.map((d) => d.excess)),
				avgHeld: avg(xs.map((d) => d.held))
			};
		});
	};

	// Д-42: the refusals — what the security did from the decision to its date (or till now)
	const skips = decs
		.filter((d) => d.type === 'skip' || d.type === 'defer')
		.map((d) => {
			const end = d.reviewDate && d.reviewDate <= today ? d.reviewDate : today;
			const p0 = priceOn(d.securityId, d.createdAt);
			const p1 = end === today ? now(d.securityId) : priceOn(d.securityId, end);
			const ch = p0 && p1 ? (p1 / p0 - 1) * 100 : null;
			return { id: d.id, type: d.type, symbol: d.symbol, securityId: d.securityId, basis: d.basis, date: d.createdAt.slice(0, 10), until: end, changePct: r1(ch), verdict: ch === null || Math.abs(ch) < 0.5 ? null : ch < 0 ? 'avoided' : 'missed' };
		});

	const outcomes = ['yes', 'partly', 'no', 'early'].map((o) => ({ outcome: o, n: decs.filter((d) => d.outcome === o).length }));
	return {
		period,
		decisions: decs.length,
		byType: decs.reduce<Record<string, number>>((a, d) => ((a[d.type] = (a[d.type] ?? 0) + 1), a), {}),
		buys,
		byBasis: group('basis'),
		byKind: group('type'),
		outcomes,
		skips,
		pause: { n: buys.filter((b) => b.pauseDays !== null).length, avgDays: avg(buys.map((b) => b.pauseDays)), avgPct: avg(buys.map((b) => b.pausePct)) },
		weekly: weekly(app, market, today)
	};
}

/**
 * Д-45 the weekly pick: entries of the last 90 days whose security moved more than `pct` since they were written, and
 * reminders snoozed three times or more and still open.
 */
export function weekly(app: Database.Database, market: Database.Database, today = israelDate(), pct = 10) {
	const m = marketView(market);
	const since = new Date(Date.parse(today + 'T12:00:00Z') - 90 * DAY).toISOString();
	const rows = app
		.prepare(
			`select c.entry_id as entryId, c.object_id as sid, c.data, e.created_at as at, e.body_text as t from entry_context c join journal_entries e on e.id = c.entry_id
			  where c.object_type = 'security' and e.status = 'active' and e.created_at >= ? order by e.created_at desc`
		)
		.all(since) as { entryId: number; sid: string; data: string; at: string; t: string }[];
	const moved = rows
		.map((r) => {
			const then = JSON.parse(r.data) as { symbol: string; price: number | null };
			const nowP = m.dayMove(Number(r.sid))?.now ?? m.last(Number(r.sid))?.close ?? null;
			const ch = then.price && nowP ? (nowP / then.price - 1) * 100 : null;
			return { entryId: r.entryId, securityId: Number(r.sid), symbol: then.symbol, at: r.at, text: r.t.length > 140 ? r.t.slice(0, 137) + '…' : r.t, changePct: r1(ch) };
		})
		.filter((x) => x.changePct !== null && Math.abs(x.changePct) >= pct)
		.sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!));
	const snoozed = app.prepare(`select id, title, snoozes, next_due as nextDue, entry_id as entryId from reminders where state <> 'closed' and snoozes >= 3 order by snoozes desc`).all() as { id: number; title: string; snoozes: number; nextDue: string | null; entryId: number }[];
	return { pct, moved, snoozed };
}
