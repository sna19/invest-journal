import type Database from 'better-sqlite3';
import { israelDate, type Errors } from '../hypothesis.js';
import { whatIf } from '../risk.js';
import type { AppDb } from './db.js';
import { InputError, createHypothesis } from './journal.js';
import { getSetting, realPortfolios, riskView, setSetting } from './risk.js';
import { liquidity, nextQuarter, runModel, universe } from './model/quarterly.js';
import { readParams } from './model/service.js';
import { scoresOf, type Score } from './score.js';
import { flagsFor } from './path.js';
import { barsOf, portfolioProtection, protectionOf, type Protection } from './protection.js';
import { checkPurchase } from './portfolioRisk.js';
import { liveSignals } from './reminders.js';
import { addEntry } from './diary.js';
import { planOf } from './discipline.js';
import { marketView, portfolioView, setAuto } from './portfolio.js';

/**
 * T-035 «Сигналы» (owner, 27.11.2026: «превратить это в систему… сигналы покупки или продажи… начнём с единиц»). The
 * tools the app has — the quant score, the trend, the path marks, the calendar, the limits, the models, the
 * protective plan — put into rules: once a week a few ideas to buy, each with its plan; every day what to sell, what to
 * review and what to place at the broker. Every idea is a hypothesis of the source «Сигналы» with a virtual
 * portfolio, so the journal says on future prices whether the system works; the first 3 months — simulation only.
 */

export interface SignalSettings {
	/** the week's run: the weekday (0 — Sunday) and the hour, Israel time */
	weekday: number;
	hour: number;
	maxIdeas: number;
	markets: ('US' | 'IL')[];
	minTurnoverUsd: number;
	minPriceUsd: number;
	/** no report within this many days */
	reportDays: number;
	/** a position over this % of its portfolio asks for a review */
	maxWeightPct: number;
	/** the months an idea is given (its hypothesis' horizon) */
	horizonMonths: number;
	/** an idea's target at least this many risks above the price (a resistance near — a weak trade) */
	minR: number;
}
export const SDEFAULTS: SignalSettings = { weekday: 0, hour: 20, maxIdeas: 5, markets: ['US', 'IL'], minTurnoverUsd: 1_000_000, minPriceUsd: 5, reportDays: 7, maxWeightPct: 15, horizonMonths: 3, minR: 1.5 };
const LIM: Record<Exclude<keyof SignalSettings, 'markets'>, [number, number]> = {
	weekday: [0, 6],
	hour: [0, 23],
	maxIdeas: [1, 20],
	minTurnoverUsd: [0, 1e9],
	minPriceUsd: [0, 1000],
	reportDays: [0, 30],
	maxWeightPct: [3, 100],
	horizonMonths: [1, 12],
	minR: [0, 5]
};
export function readSignalSettings(app: Database.Database): SignalSettings {
	const raw = getSetting(app, 'signals');
	return raw ? cleanSignalSettings(JSON.parse(raw)) : { ...SDEFAULTS };
}
export function cleanSignalSettings(input: Record<string, unknown>, base: SignalSettings = SDEFAULTS): SignalSettings {
	const out = { ...base };
	for (const [k, [lo, hi]] of Object.entries(LIM) as [keyof typeof LIM, [number, number]][]) {
		if (input[k] === undefined || input[k] === '') continue;
		const x = Number(input[k]);
		if (Number.isFinite(x) && x >= lo && x <= hi) out[k] = k === 'minTurnoverUsd' || k === 'minPriceUsd' || k === 'minR' ? x : Math.round(x);
	}
	if (Array.isArray(input.markets)) {
		const m = (input.markets as unknown[]).filter((x): x is 'US' | 'IL' => x === 'US' || x === 'IL');
		if (m.length) out.markets = [...new Set(m)];
	}
	return out;
}
export function writeSignalSettings(app: Database.Database, input: Record<string, unknown>) {
	const s = cleanSignalSettings(input, readSignalSettings(app));
	setSetting(app, 'signals', JSON.stringify(s));
	return s;
}

export const IDEAS_SOURCE = 'Сигналы';

export interface IdeaData {
	symbol: string;
	name: string;
	market: 'US' | 'IL';
	sector: string | null;
	total: number;
	grades: Record<string, string | null>;
	reasons: string[];
	plan: {
		price: number;
		priceUnit: string;
		recommended: 'fixed' | 'trail';
		stop: number;
		limit: number;
		trailPct: number;
		target: number;
		targetR: number;
		qty: number | null;
		amount: number | null;
		portfolio: string | null;
		maxLoss: number | null;
		maxLossPct: number | null;
		currency: string | null;
	};
}

/** the securities the user holds or plans to buy — not ideas again */
function ownIds(app: Database.Database) {
	return new Set((app.prepare(`select security_id as id from positions s join portfolios p on p.id = s.portfolio_id where s.stage <> 'closed' and p.kind = 'real' and p.auto_source_id is null`).all() as { id: number }[]).map((r) => r.id));
}

/** the run of the week: the funnel, the ranking, the plans */
export function findIdeas(app: Database.Database, market: Database.Database, today = israelDate()) {
	const st = readSignalSettings(app);
	const u = universe(market);
	const own = ownIds(app);
	const funnel: Record<string, number> = {};
	// 1. liquid shares of the chosen markets, not held
	const liquid = u.stocks.filter((s) => {
		if (!st.markets.includes(s.market) || own.has(s.id)) return false;
		const l = liquidity(s, u.lastMonth, u.usdIls);
		return l.turnoverUsd >= st.minTurnoverUsd && l.priceUsd >= st.minPriceUsd;
	});
	funnel.liquid = liquid.length;
	// 2. the quant score green (so the price is over its SMA200 too)
	const scored = scoresOf(market, liquid.map((s) => s.id));
	// …and the trend known: a share without 200 days of history is not an idea (the rule «only above SMA200»)
	let pool = scored.filter((x) => x.color === 'green' && x.total !== null && x.trend?.above === true);
	funnel.green = pool.length;
	// 3. no «fading» or «stuck» mark
	const flags = flagsFor(app, market, pool.map((x) => x.id));
	pool = pool.filter((x) => !(flags[x.id] ?? []).some((f) => f === 'fading' || f === 'stuck'));
	funnel.noMarks = pool.length;
	// 4. no report in the next days (the calendar of T-013)
	const end = new Date(Date.parse(today + 'T12:00:00Z') + st.reportDays * 86_400_000).toISOString().slice(0, 10);
	const report = market.prepare(`select 1 from ref_security_events where security_id = ? and kind = 'earnings' and date >= ? and date <= ? limit 1`);
	pool = pool.filter((x) => !report.get(x.id, today, end));
	funnel.noReport = pool.length;
	// the ranking: the score, a bonus when a quarterly model (A or B) has it among its candidates of the next quarter
	const q = nextQuarter().quarter;
	const models = new Map<number, string[]>();
	for (const v of ['A', 'B'] as const) {
		try {
			for (const c of runModel(u, v, q, readParams(app, v)).candidates) models.set(c.id, [...(models.get(c.id) ?? []), v]);
		} catch {
			/* the model has no data yet */
		}
	}
	const rank = (x: Score) => x.total! + 0.05 * (models.get(x.id)?.length ?? 0);
	pool.sort((a, b) => rank(b) - rank(a));
	// 5. the limits (the job's industry, …) and «duplicates what is held» — for the best few only (they are slower)
	const ports = realPortfolios(app);
	const main = ports[0] ?? null;
	const head = pool.slice(0, st.maxIdeas * 4);
	let risk: ReturnType<typeof riskView> | null = null;
	try {
		risk = ports.length ? riskView(app, market, ports.length > 1 ? 'all' : ports[0].id, { years: 2, add: head.map((x) => x.id) }) : null;
	} catch {
		risk = null;
	}
	const chosen: { s: Score; plan: Protection | null; reasons: string[] }[] = [];
	let limited = 0;
	let dup = 0;
	let weak = 0;
	for (const x of head) {
		if (chosen.length >= st.maxIdeas) break;
		const sec = u.stocks.find((s) => s.id === x.id)!;
		const port = ports.find((p) => p.currency === (sec.market === 'IL' ? 'ILS' : 'USD')) ?? main;
		const plan = protectionOf(app, market, x.id, port ? { portfolioId: port.id } : {}).items[0] ?? null;
		// the target too near (a resistance just above): little to win for the risk
		if (plan && plan.f.targetR < st.minR) {
			weak++;
			continue;
		}
		if (port && plan?.size) {
			const warns = checkPurchase(app, market, port.id, x.id, plan.size.amount * (plan.size.portfolioCurrency === (sec.market === 'IL' ? 'ILS' : 'USD') ? 1 : sec.market === 'IL' ? 1 / u.usdIls : u.usdIls), 'own');
			if (warns.length) {
				limited++;
				continue;
			}
		}
		if (risk && risk.now.held > 0 && !risk.loading.includes(x.id)) {
			const w = whatIf(risk, [x.id], 0.05);
			if (w.label === 'duplicates') {
				dup++;
				continue;
			}
		}
		const g = x.factors;
		const reasons = [
			`Квант-оценка ${Math.round(x.total! * 100)}: качество ${g.quality.grade ?? '—'}, рост ${g.growth.grade ?? '—'}, оценка ${g.valuation.grade ?? '—'}, моментум ${g.momentum.grade ?? '—'}`,
			`Цена выше средней за 200 дней на ${Math.round((x.trend!.price / x.trend!.sma200 - 1) * 100)}%`,
			...(models.has(x.id) ? [`Квартальная модель ${models.get(x.id)!.join(' и ')}: кандидат Q${q}`] : []),
			`Отчёта в ближайшие ${st.reportDays} дн. нет`
		];
		chosen.push({ s: x, plan, reasons });
	}
	funnel.room = funnel.noReport - weak;
	funnel.limits = funnel.room - limited;
	funnel.notDuplicate = funnel.limits - dup;
	return { settings: st, funnel, ideas: chosen.map((c, i) => ({ rank: i + 1, ...c })) };
}

const versionOf = (app: Database.Database, sourceId: number, st: SignalSettings) => {
	const params = JSON.stringify({ funnel: ['liquid', 'green', 'no_fading_stuck', 'no_report', 'limits', 'not_duplicate'], rank: 'score+0.05×models', ...st });
	return (
		(app.prepare(`select id from model_versions where variant = 'S' and params = ?`).get(params) as { id: number } | undefined)?.id ??
		Number(app.prepare(`insert into model_versions (variant, params, source_id) values ('S', ?, ?)`).run(params, sourceId).lastInsertRowid)
	);
};

/** the week's run: the ideas stored, each a hypothesis of «Сигналы» (simulation) bought by its virtual portfolio */
export function runIdeas(db: AppDb, app: Database.Database, market: Database.Database, now = new Date(), force = false) {
	const today = israelDate(now);
	const st = readSignalSettings(app);
	const last = (app.prepare('select max(run) as r from signal_ideas').get() as { r: string | null }).r;
	if (!force && last && Date.parse(today) - Date.parse(last) < 6 * 86_400_000) return { run: today, recorded: 0, skipped: 'already this week' };
	const r = findIdeas(app, market, today);
	if (!r.ideas.length) return { run: today, recorded: 0, skipped: 'no idea passed', funnel: r.funnel };
	const sourceId =
		(app.prepare('select id from sources where name = ?').get(IDEAS_SOURCE) as { id: number } | undefined)?.id ??
		Number(app.prepare(`insert into sources (name, kind, market, notes) values (?, 'model', 'any', 'T-035: идеи недели — воронка квант-оценки, тренда, меток, календаря и лимитов')`).run(IDEAS_SOURCE).lastInsertRowid);
	const versionId = versionOf(app, sourceId, st);
	const [y, m, d] = today.split('-').map(Number);
	const horizon = new Date(Date.UTC(y, m - 1 + st.horizonMonths, d)).toISOString().slice(0, 10);
	const sym = market.prepare('select symbol, name_en as name, price_unit as unit from ref_securities where id = ?');
	app.transaction(() => {
		for (const i of r.ideas) {
			const s = sym.get(i.s.id) as { symbol: string; name: string; unit: string };
			const p = i.plan;
			const data: IdeaData = {
				symbol: s.symbol,
				name: s.name,
				market: (i.s.market ?? 'US') as 'US' | 'IL',
				sector: i.s.sector,
				total: i.s.total!,
				grades: Object.fromEntries(Object.entries(i.s.factors).map(([k, f]) => [k, f.grade])),
				reasons: i.reasons,
				plan: {
					price: p?.price ?? 0,
					priceUnit: p?.priceUnit ?? s.unit,
					recommended: p?.recommended ?? 'fixed',
					stop: p?.f.stop ?? 0,
					limit: p?.f.limit ?? 0,
					trailPct: p?.f.trailPct ?? 0,
					target: p?.f.target ?? 0,
					targetR: p?.f.targetR ?? 0,
					qty: p?.size?.qty ?? null,
					amount: p?.size?.amount ?? null,
					portfolio: p?.size?.portfolio ?? null,
					maxLoss: p?.maxLoss?.fixed ?? null,
					maxLossPct: p?.maxLoss?.pctFixed ?? null,
					currency: p?.maxLoss?.currency ?? null
				}
			};
			const h = createHypothesis(
				db,
				market,
				{
					sourceId,
					securityId: i.s.id,
					signalType: 'recommendation',
					direction: 'long',
					directionSource: 'article',
					thesis: `Идея недели ${today}: ${i.reasons.join('; ')}. План: стоп ${data.plan.stop}, цель ${data.plan.target}`,
					invalidation: `Цена ниже стопа ${data.plan.stop} или бумага не обгонит рынок за ${st.horizonMonths} мес.`,
					mode: 'sim',
					horizon: 'date',
					horizonDate: horizon,
					tags: `сигналы, ${today}`
				},
				now,
				{ modelVersionId: versionId }
			) as { id?: number } | number | undefined;
			const hid = typeof h === 'number' ? h : (h?.id ?? null);
			app.prepare('insert into signal_ideas (run, security_id, rank, score, data, hypothesis_id) values (?, ?, ?, ?, ?, ?)').run(today, i.s.id, i.rank, i.s.total!, JSON.stringify(data), hid);
		}
		app.prepare(`insert or ignore into model_quarters (variant, quarter, version_id, hypotheses) values ('S', ?, ?, ?)`).run(today, versionId, r.ideas.length);
	})();
	setAuto(app, market, sourceId, true, now);
	return { run: today, recorded: r.ideas.length, skipped: null, funnel: r.funnel };
}

/** the latest run's ideas with what the owner did */
export function lastIdeas(app: Database.Database) {
	const run = (app.prepare('select max(run) as r from signal_ideas').get() as { r: string | null }).r;
	if (!run) return { run: null, ideas: [] };
	const rows = app.prepare('select id, security_id as securityId, rank, score, data, status, reason, hypothesis_id as hypothesisId from signal_ideas where run = ? order by rank').all(run) as { id: number; securityId: number; rank: number; score: number; data: string; status: string; reason: string | null; hypothesisId: number | null }[];
	// owner 27.11.2026: «Хочу купить» / «Купил» pressed but the form closed without saving — the idea is not done
	const held = app.prepare(`select 1 from positions s join portfolios p on p.id = s.portfolio_id where s.security_id = ? and p.auto_source_id is null and s.stage in ('plan_buy', 'holding', 'plan_sell') limit 1`);
	return {
		run,
		ideas: rows.map((r) => {
			const unsaved = (r.status === 'wanted' || r.status === 'bought') && !held.get(r.securityId);
			return { ...r, status: unsaved ? 'new' : r.status, unsaved, data: JSON.parse(r.data) as IdeaData };
		})
	};
}

/** «Хочу купить» / «Пропустить — почему» (the skipped ones are measured too: their hypotheses stay) */
export function markIdea(app: Database.Database, market: Database.Database, id: number, status: unknown, reason: unknown) {
	const st = status === 'skipped' || status === 'wanted' || status === 'bought' ? status : null;
	if (!st) throw new InputError({ status: 'Купил, хочу купить или пропустить' } as Errors);
	const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
	if (st === 'skipped' && !why) throw new InputError({ reason: 'Почему пропускаешь — одной строкой' } as Errors);
	const row = app.prepare('select security_id as sid, data from signal_ideas where id = ?').get(id) as { sid: number; data: string } | undefined;
	if (!row) throw new InputError({ id: 'Нет такой идеи' } as Errors);
	app.prepare('update signal_ideas set status = ?, reason = ? where id = ?').run(st, why || null, id);
	if (st === 'skipped')
		addEntry(app, market, { kind: 'observation', body: `<p>Пропустил идею недели ${(JSON.parse(row.data) as IdeaData).symbol}: ${why.replace(/</g, '&lt;')}</p>`, format: 'html', links: [{ type: 'security', id: String(row.sid), primary: true }] }, { origin: `idea:${id}` });
	return st;
}

// ── every day: sell, review, place at the broker ─────────────────────────────────────────────────────

export type SoftKind = 'score_red' | 'below_sma' | 'overweight' | 'deep_loss';

/**
 * The day's list: «Продать» — the hard rules (a stop or trailing level broken, a model's period over); «Пересмотреть»
 * — the target reached, the review date, a path mark, and the soft ones (the quant score red, the price under its
 * SMA200, the position too big a part of its portfolio); «Выставь у брокера» — positions without a stop, or with a
 * stop-limit but no target where one is advised.
 */
export function dayList(app: Database.Database, market: Database.Database, today = israelDate()) {
	const st = readSignalSettings(app);
	const live = liveSignals(app, market, today);
	const sell = live.filter((s) => s.kind === 'stop' || s.kind === 'model_end');
	const review = live.filter((s) => s.kind === 'target' || s.kind === 'review' || s.kind === 'path' || s.kind === 'no_stop');
	const snoozed = new Map((app.prepare('select key, until from signal_snoozes').all() as { key: string; until: string }[]).map((x) => [x.key, x.until]));
	const soft: { kind: SoftKind; key: string; positionId: number; securityId: number; symbol: string; portfolio: string; detail: string }[] = [];
	const protect: Protection[] = [];
	for (const port of realPortfolios(app)) {
		const pp = portfolioProtection(app, market, port.id, today);
		if (!pp) continue;
		const ids = pp.items.map((x) => x.securityId);
		const scores = new Map(scoresOf(market, ids).map((x) => [x.id, x]));
		for (const it of pp.items) {
			if (!it.position) continue;
			const sc = scores.get(it.securityId);
			const add = (kind: SoftKind, detail: string) => {
				const key = `${kind}|${it.position!.id}|0`;
				const until = snoozed.get(key);
				if (until && today < until) return;
				soft.push({ kind, key, positionId: it.position!.id, securityId: it.securityId, symbol: it.symbol, portfolio: port.name, detail });
			};
			if (sc?.market && sc.color === 'red') add('score_red', `квант-оценка ${Math.round((sc.total ?? 0) * 100)}`);
			if (sc?.trend && !sc.trend.above && crossedDown(market, it.securityId)) add('below_sma', `цена ${sc.trend.price.toFixed(2)} ушла ниже SMA200 ${sc.trend.sma200} за последние 10 дней`);
			if (it.status === 'unprotected' || (it.order && it.order.type === 'fixed' && !it.order.takeProfit && it.recommended === 'fixed')) protect.push(it);
		}
	}
	// the weight: from the portfolio views (value of a position over the portfolio's value)
	for (const port of realPortfolios(app)) {
		const v = portfolioWeights(app, market, port.id, today);
		// over the set share and over two equal parts (8 positions — 25%): a portfolio of few positions is not «too big» everywhere
		const limit = Math.max(st.maxWeightPct, v.length ? 200 / v.length : 0);
		for (const w of v)
			if (w.weight > limit) {
				const key = `overweight|${w.positionId}|0`;
				const until = snoozed.get(key);
				if (until && today < until) continue;
				soft.push({ kind: 'overweight', key, positionId: w.positionId, securityId: w.securityId, symbol: w.symbol, portfolio: port.name, detail: `${w.weight.toFixed(1)}% портфеля при пороге ${Math.round(limit)}%` });
			}
		// owner 27.11.2026: a loss of 20% and more — the «Разбор просадки» in its card
		for (const w of v)
			if (w.loss !== null && w.loss <= -0.2) {
				const key = `deep_loss|${w.positionId}|0`;
				const until = snoozed.get(key);
				if (until && today < until) continue;
				soft.push({ kind: 'deep_loss', key, positionId: w.positionId, securityId: w.securityId, symbol: w.symbol, portfolio: port.name, detail: `${Math.round(w.loss * 100)}% от цены покупки — пройди разбор: купил бы сегодня?` });
			}
	}
	return { sell, review, soft, protect, want: wantList(app, market, live, today), settings: st };
}

/**
 * «Хочу купить» on «Сигналы»: every planned purchase of the real portfolios — the wanted price against the latest one,
 * the plan's stop and target, how long it waits, and what to do now: buy (the price came), drop it (the price fell under
 * the plan's stop before the purchase), decide (the plan's review date came, or it waits over 30 days), or wait.
 */
export function wantList(app: Database.Database, market: Database.Database, live: { kind: string; positionId: number }[], today = israelDate()) {
	const rows = app
		.prepare(
			`select s.id, s.security_id as securityId, s.symbol, s.security_name as name, s.price_unit as priceUnit, p.name as portfolio,
			        (select e.price from position_events e where e.position_id = s.id and e.kind = 'plan_buy' and e.cancelled_at is null order by e.id desc limit 1) as want,
			        (select e.amount from position_events e where e.position_id = s.id and e.kind = 'plan_buy' and e.cancelled_at is null order by e.id desc limit 1) as amount,
			        (select e.note from position_events e where e.position_id = s.id and e.kind = 'plan_buy' and e.cancelled_at is null order by e.id desc limit 1) as note,
			        (select min(e.date) from position_events e where e.position_id = s.id and e.kind = 'plan_buy' and e.cancelled_at is null) as since
			   from positions s join portfolios p on p.id = s.portfolio_id
			  where s.stage = 'plan_buy' and p.auto_source_id is null and p.archived_at is null
			  order by s.symbol`
		)
		.all() as { id: number; securityId: number; symbol: string; name: string; priceUnit: string; portfolio: string; want: number | null; amount: number | null; note: string | null; since: string | null }[];
	const m = marketView(market);
	return rows.map((r) => {
		const plan = planOf(app, r.id);
		const price = m.dayMove(r.securityId)?.now ?? m.last(r.securityId)?.close ?? null;
		const sig = live.filter((x) => x.positionId === r.id).map((x) => x.kind);
		const days = r.since ? Math.round((Date.parse(today) - Date.parse(r.since)) / 86_400_000) : null;
		const status = sig.includes('entry_broken') ? 'broken' : sig.includes('entry') ? 'buy' : sig.includes('decide') || (days !== null && days > 30) ? 'decide' : !plan?.stop ? 'no_plan' : 'wait';
		return {
			positionId: r.id,
			securityId: r.securityId,
			symbol: r.symbol,
			name: r.name,
			priceUnit: r.priceUnit,
			portfolio: r.portfolio,
			price,
			want: r.want,
			/** how far the price is above the wanted one, % (negative — under it) */
			toWant: price !== null && r.want ? (price / r.want - 1) * 100 : null,
			stop: plan?.stop ?? null,
			target: plan?.target ?? null,
			reviewDate: plan?.reviewDate ?? null,
			thesis: plan?.thesis ?? null,
			note: r.note,
			amount: r.amount,
			days,
			status
		};
	});
}

/** the price went under its 200-day average within the last 10 trading days (a crossing, not a long state) */
function crossedDown(market: Database.Database, id: number) {
	const b = barsOf(market, id, 212);
	if (b.length < 211) return false;
	const sma = (end: number) => b.slice(end - 200, end).reduce((a, x) => a + x.close, 0) / 200;
	for (let k = 1; k <= 10; k++) {
		const end = b.length - k;
		if (b[end - 1].close >= sma(end)) return true;
	}
	return false;
}

function portfolioWeights(app: Database.Database, market: Database.Database, id: number, today: string) {
	const v = portfolioView(app, market, id, today);
	return (v?.positions ?? []).filter((p) => p.qty > 0 && p.stage !== 'closed').map((p) => ({ positionId: p.id, securityId: p.securityId, symbol: p.symbol, weight: p.weight, loss: p.avgPrice && p.lastPrice ? p.lastPrice / p.avgPrice - 1 : null }));
}

/** «Держу — потому что…»: the reason into the diary, the soft signal quiet for 30 days */
export function keepPosition(app: Database.Database, market: Database.Database, key: unknown, reason: unknown, today = israelDate()) {
	const k = String(key ?? '');
	const m = /^(score_red|below_sma|overweight|deep_loss)\|(\d+)\|0$/.exec(k);
	if (!m) throw new InputError({ key: 'Нет такого сигнала' } as Errors);
	const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
	if (!why) throw new InputError({ reason: 'Почему держишь — одной строкой' } as Errors);
	const until = new Date(Date.parse(today + 'T12:00:00Z') + 30 * 86_400_000).toISOString().slice(0, 10);
	app.prepare(`insert into signal_snoozes (key, until, count) values (?, ?, 1) on conflict(key) do update set until = excluded.until, count = count + 1`).run(k, until);
	const pos = app.prepare('select security_id as sid, symbol from positions where id = ?').get(Number(m[2])) as { sid: number; symbol: string } | undefined;
	const what = { score_red: 'квант-оценка красная', below_sma: 'цена ниже SMA200', overweight: 'позиция слишком большая', deep_loss: 'глубокая просадка' }[m[1] as SoftKind];
	if (pos) addEntry(app, market, { kind: 'observation', body: `<p>Держу ${pos.symbol} (${what}): ${why.replace(/</g, '&lt;')}</p>`, format: 'html', links: [{ type: 'position', id: m[2], primary: true }, { type: 'security', id: String(pos.sid) }] }, { origin: `keep:${k}:${today}` });
	return until;
}
