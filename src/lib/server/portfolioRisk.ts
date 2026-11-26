import type Database from 'better-sqlite3';
import { israelDate, type Errors } from '../hypothesis.js';
import { InputError } from './journal.js';
import { benchmarkId, listPortfolios, marketView, portfolioView } from './portfolio.js';
import { portfolioReport } from './report.js';
import { employerOf, getSetting, setSetting } from './risk.js';
import { addEntry } from './diary.js';
import { addReminder } from './reminders.js';

/**
 * T-016 «Риск портфеля и разбор позиций» (the review of 20.11.2026: a large share of the portfolio in one industry, the
 * same industry as the owner's job; country funds bought without a rule; positions held without a thesis). Here: what a
 * fund is made of (sectors, countries, industries — by hand, by rule, from the provider or from its top holdings), the
 * job's risk and the industry limit, the speculation budget, «А если бы в индекс», the disposition effect, the year's
 * result, and the position review.
 */

type W = Record<string, number>;
const r1 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x: number) => Math.round(x * 100) / 100;

// ── what a fund is made of ────────────────────────────────────────────────────────────────────────────────

/** country funds by their ticker (iShares and the like): the country is the fund */
const COUNTRY_ETF: Record<string, string> = {
	EPOL: 'Poland', EWP: 'Spain', EWH: 'Hong Kong', EPU: 'Peru', EWJ: 'Japan', EWG: 'Germany', EWU: 'United Kingdom', EWZ: 'Brazil', EWW: 'Mexico',
	EWC: 'Canada', EWA: 'Australia', EWT: 'Taiwan', EWY: 'South Korea', INDA: 'India', MCHI: 'China', FXI: 'China', EWI: 'Italy', EWQ: 'France',
	EWL: 'Switzerland', EWN: 'Netherlands', EWD: 'Sweden', EIS: 'Israel', TUR: 'Turkey', EZA: 'South Africa', ECH: 'Chile', ARGT: 'Argentina',
	VNM: 'Vietnam', THD: 'Thailand', EIDO: 'Indonesia', EWS: 'Singapore', EWM: 'Malaysia', KSA: 'Saudi Arabia', GREK: 'Greece', EWO: 'Austria', EWK: 'Belgium', NORW: 'Norway', EDEN: 'Denmark', EFNL: 'Finland', EIRL: 'Ireland', ENZL: 'New Zealand', EPHE: 'Philippines', QAT: 'Qatar', UAE: 'United Arab Emirates', KWT: 'Kuwait', COLO: 'Colombia'
};
/** a holding's country by its Yahoo suffix */
const SUFFIX: Record<string, string> = {
	WA: 'Poland', MC: 'Spain', HK: 'Hong Kong', L: 'United Kingdom', DE: 'Germany', F: 'Germany', PA: 'France', TA: 'Israel', T: 'Japan', KS: 'South Korea', KQ: 'South Korea',
	TW: 'Taiwan', TWO: 'Taiwan', AX: 'Australia', TO: 'Canada', V: 'Canada', SA: 'Brazil', MX: 'Mexico', SW: 'Switzerland', AS: 'Netherlands', MI: 'Italy', ST: 'Sweden',
	NS: 'India', BO: 'India', SS: 'China', SZ: 'China', JK: 'Indonesia', BK: 'Thailand', SI: 'Singapore', KL: 'Malaysia', IS: 'Turkey', JO: 'South Africa', SN: 'Chile',
	LM: 'Peru', CO: 'Denmark', OL: 'Norway', HE: 'Finland', BR: 'Belgium', VI: 'Austria', IR: 'Ireland', AT: 'Greece', NZ: 'New Zealand', SR: 'Saudi Arabia', QA: 'Qatar'
};
/** an industry fund is its industry (the funds of «С чем сравнить»), named as the provider names a company's industry */
const INDUSTRY_ETF: Record<string, string> = {
	SOXX: 'Semiconductors', SMH: 'Semiconductors', IBB: 'Biotechnology', XBI: 'Biotechnology', KRE: 'Banks - Regional', KBE: 'Banks - Diversified', IGV: 'Software - Application',
	ITA: 'Aerospace & Defense', XPH: 'Drug Manufacturers - General', IHI: 'Medical Devices', KIE: 'Insurance - Diversified', GDX: 'Gold', XOP: 'Oil & Gas E&P',
	OIH: 'Oil & Gas Equipment & Services', CRAK: 'Oil & Gas Refining & Marketing', SLX: 'Steel', COPX: 'Copper', ITB: 'Residential Construction', XRT: 'Specialty Retail',
	JETS: 'Airlines', TAN: 'Solar', URA: 'Uranium', FDN: 'Internet Content & Information', IYT: 'Integrated Freight & Logistics', IAI: 'Capital Markets', IYZ: 'Telecom Services', CARZ: 'Auto Manufacturers'
};
/** a provider's category of a fund that holds abroad — then «США» is not assumed */
const ABROAD = /foreign|emerging|europe|china|japan|pacific|latin|india|region|world|global|international|asia|diversified em/i;

export interface Composition {
	sectors: W | null;
	countries: W | null;
	industries: W | null;
	source: { sector: string | null; country: string | null; industry: string | null };
	holdings: { symbol: string; name: string; weight: number }[] | null;
}

/**
 * What a security is made of. A share is itself. A fund: set by hand first; then a rule (a country fund is its country,
 * an industry fund is its industry); then the provider's sector weights; then its top holdings — each holding's country
 * by its ticker or its profile, its industry and sector by its profile — scaled to the whole fund.
 */
export function composition(app: Database.Database, market: Database.Database, securityId: number): Composition {
	const s = market
		.prepare(
			`select s.symbol, s.type, s.exchange_code as x, p.kind, p.sector, p.industry, p.country, p.fund_category as cat, p.sector_weights as sw, p.holdings
			   from ref_securities s left join ref_security_profiles p on p.security_id = s.id where s.id = ?`
		)
		.get(securityId) as { symbol: string; type: string; x: string; kind: string | null; sector: string | null; industry: string | null; country: string | null; cat: string | null; sw: string | null; holdings: string | null } | undefined;
	const empty: Composition = { sectors: null, countries: null, industries: null, source: { sector: null, country: null, industry: null }, holdings: null };
	if (!s) return empty;
	const fund = s.kind === 'etf' || (s.kind !== 'stock' && s.type === 'etf');
	if (!fund)
		return {
			sectors: s.sector ? { [s.sector]: 1 } : null,
			countries: s.country ? { [s.country]: 1 } : s.x === 'TASE' ? { Israel: 1 } : null,
			industries: s.industry ? { [s.industry]: 1 } : null,
			source: { sector: s.sector ? 'stock' : null, country: s.country || s.x === 'TASE' ? 'stock' : null, industry: s.industry ? 'stock' : null },
			holdings: null
		};
	const over = new Map((app.prepare('select kind, weights from fund_overrides where security_id = ?').all(securityId) as { kind: string; weights: string }[]).map((r) => [r.kind, JSON.parse(r.weights) as W]));
	const holdings = s.holdings ? (JSON.parse(s.holdings) as { symbol: string; name: string; weight: number }[]) : null;
	// the top holdings, looked through: each one's country, sector and industry
	const hSec: W = {};
	const hCty: W = {};
	const hInd: W = {};
	if (holdings) {
		const prof = market.prepare(
			`select p.sector, p.industry, p.country from ref_securities r join ref_security_profiles p on p.security_id = r.id where r.symbol = ? and r.active = 1 order by r.exchange_code = 'TASE', r.id limit 1`
		);
		for (const h of holdings) {
			const [base, suf] = h.symbol.split('.');
			const pr = prof.get(suf === 'TA' ? base : h.symbol) as { sector: string | null; industry: string | null; country: string | null } | undefined;
			const cty = suf ? SUFFIX[suf] : (pr?.country ?? null);
			if (cty) hCty[cty] = (hCty[cty] ?? 0) + h.weight;
			if (pr?.sector) hSec[pr.sector] = (hSec[pr.sector] ?? 0) + h.weight;
			if (pr?.industry) hInd[pr.industry] = (hInd[pr.industry] ?? 0) + h.weight;
		}
	}
	// the top holdings stand for the whole fund: each share of theirs is scaled by all of them — the holdings without a
	// profile (cash, swaps, unknown tickers) stay unknown, not spread over the known ones
	const totalW = (holdings ?? []).reduce((n, h) => n + h.weight, 0);
	const scale = (w: W) => (totalW > 0 ? Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / totalW])) : null);
	const yahooSec = s.sw ? (JSON.parse(s.sw) as W) : null;
	const indRule = INDUSTRY_ETF[s.symbol];
	let sectors: W | null = null;
	let ss: string | null = null;
	if (over.get('sector')) (sectors = over.get('sector')!), (ss = 'manual');
	else if (yahooSec && Object.values(yahooSec).some((x) => x > 0)) (sectors = yahooSec), (ss = 'yahoo');
	else if (Object.keys(hSec).length) (sectors = scale(hSec)), (ss = 'holdings');
	let countries: W | null = null;
	let cs: string | null = null;
	if (over.get('country')) (countries = over.get('country')!), (cs = 'manual');
	else if (COUNTRY_ETF[s.symbol]) (countries = { [COUNTRY_ETF[s.symbol]]: 1 }), (cs = 'rule');
	else if (Object.keys(hCty).length) (countries = scale(hCty)), (cs = 'holdings');
	else if (s.x === 'TASE') (countries = null), (cs = null);
	else if (!ABROAD.test(s.cat ?? '')) (countries = { 'United States': 1 }), (cs = 'rule');
	let industries: W | null = null;
	let is: string | null = null;
	if (over.get('industry')) (industries = over.get('industry')!), (is = 'manual');
	else if (indRule) (industries = { [indRule]: 1 }), (is = 'rule');
	else if (Object.keys(hInd).length) (industries = scale(hInd)), (is = 'holdings');
	return { sectors, countries, industries, source: { sector: ss, country: cs, industry: is }, holdings };
}

/** a fund's composition set by hand (weights in %, summing to about 100); an empty list goes back to the provider */
export function setOverride(app: Database.Database, securityId: number, kind: unknown, weights: unknown) {
	if (kind !== 'sector' && kind !== 'country' && kind !== 'industry') throw new InputError({ kind: 'Секторы, страны или отрасли' } as Errors);
	const w = Object.fromEntries(Object.entries((weights ?? {}) as Record<string, unknown>).map(([k, v]) => [k.trim(), Number(v)]).filter(([k, v]) => k && Number.isFinite(v as number) && (v as number) > 0)) as W;
	if (!Object.keys(w).length) {
		app.prepare('delete from fund_overrides where security_id = ? and kind = ?').run(securityId, kind);
		return null;
	}
	const sum = Object.values(w).reduce((a, b) => a + b, 0);
	if (sum > 100.5) throw new InputError({ weights: `Сумма долей ${Math.round(sum)}% — больше 100%` } as Errors);
	const frac = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / 100]));
	app.prepare(`insert into fund_overrides (security_id, kind, weights) values (?, ?, ?) on conflict (security_id, kind) do update set weights = excluded.weights, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run(securityId, kind, JSON.stringify(frac));
	return frac;
}

// ── the job's risk, the speculation budget ────────────────────────────────────────────────────────────────

export interface Limits {
	industryPct: number;
	specPct: number;
	specLossPct: number;
}
export function limits(app: Database.Database): Limits {
	const n = (k: string, d: number) => {
		const v = Number(getSetting(app, k));
		return Number.isFinite(v) && v > 0 ? v : d;
	};
	return { industryPct: n('limit_industry_pct', 20), specPct: n('limit_spec_pct', 3), specLossPct: n('limit_spec_loss_pct', 1) };
}
export function setLimits(app: Database.Database, input: { industryPct?: unknown; specPct?: unknown; specLossPct?: unknown }) {
	for (const [k, v] of [
		['limit_industry_pct', input.industryPct],
		['limit_spec_pct', input.specPct],
		['limit_spec_loss_pct', input.specLossPct]
	] as const) {
		if (v === undefined) continue;
		const x = Number(v);
		if (!(x > 0 && x <= 100)) throw new InputError({ [k]: 'Процент от 0 до 100' } as Errors);
		setSetting(app, k, String(x));
	}
	return limits(app);
}

/** the job's industry: the employer's (semiconductors are one group: chips, equipment and materials) */
export function jobIndustry(app: Database.Database, market: Database.Database) {
	const e = employerOf(app, market);
	if (!e) return null;
	const p = market.prepare('select industry, sector from ref_security_profiles where security_id = ?').get(e.id) as { industry: string | null; sector: string | null } | undefined;
	if (!p?.industry) return { employer: e.symbol, label: null, match: () => false };
	const semis = /^Semiconductor/.test(p.industry);
	return { employer: e.symbol, label: semis ? 'Semiconductors' : p.industry, match: (ind: string) => (semis ? /^Semiconductor/.test(ind) : ind === p.industry) };
}

/** the share of a security in the job's industry: a share — all or nothing, a fund — by its industries */
function jobShare(app: Database.Database, market: Database.Database, securityId: number, match: (ind: string) => boolean) {
	const c = composition(app, market, securityId);
	if (!c.industries) return 0;
	return Object.entries(c.industries).reduce((n, [k, w]) => n + (match(k) ? w : 0), 0);
}

/**
 * A purchase from the form (T-016 3, 4): would it take the job's industry over its limit, or the speculation over its
 * budget? Returns the warnings — the purchase is not refused.
 */
export function checkPurchase(app: Database.Database, market: Database.Database, portfolioId: number, securityId: number, amountPc: number, kind: string | null) {
	const v = portfolioView(app, market, portfolioId);
	if (!v || !(amountPc > 0)) return [];
	const L = limits(app);
	const total = v.summary.value + Math.max(0, amountPc - Math.max(0, v.summary.cash));
	const out: { rule: 'industry' | 'spec'; text: string }[] = [];
	const job = jobIndustry(app, market);
	if (job?.label) {
		const now = v.positions.filter((p) => p.qty > 0).reduce((n, p) => n + p.valuePc * jobShare(app, market, p.securityId, job.match), 0);
		const add = amountPc * jobShare(app, market, securityId, job.match);
		const after = ((now + add) / total) * 100;
		if (add > 0 && after > L.industryPct) out.push({ rule: 'industry', text: `После покупки ${industryRu(job.label)} — ${Math.round(after)}% портфеля при лимите ${L.industryPct}%: это та же отрасль, что работа (${job.employer}).` });
	}
	if (kind === 'spec') {
		const s = speculation(app, market, portfolioId);
		const after = ((s.value + amountPc) / total) * 100;
		if (after > L.specPct) out.push({ rule: 'spec', text: `Спекуляции после покупки — ${r1(after)}% портфеля при бюджете ${L.specPct}% (правило 3).` });
	}
	return out;
}

const industryRu = (s: string) => (s === 'Semiconductors' ? 'полупроводники' : s);

/** the positions marked «Спекуляция» (the trade's kind, T-015): their share and what they may lose — to the stop or all */
export function speculation(app: Database.Database, market: Database.Database, portfolioId: number) {
	const v = portfolioView(app, market, portfolioId)!;
	const kindQ = app.prepare('select kind, stop from trade_plans where position_id = ? order by id desc limit 1');
	const rows = v.positions
		.filter((p) => p.qty > 0)
		.map((p) => ({ p, plan: kindQ.get(p.id) as { kind: string; stop: number | null } | undefined }))
		.filter((x) => x.plan?.kind === 'spec');
	const value = rows.reduce((n, x) => n + x.p.valuePc, 0);
	const loss = rows.reduce((n, x) => {
		const last = x.p.lastPrice;
		if (x.plan!.stop === null || !last) return n + x.p.valuePc;
		return n + x.p.valuePc * Math.max(0, 1 - x.plan!.stop / last);
	}, 0);
	return { value, loss, positions: rows.map((x) => ({ id: x.p.id, symbol: x.p.symbol, valuePc: r2(x.p.valuePc), stop: x.plan!.stop })) };
}

// ── «А если бы в индекс» ─────────────────────────────────────────────────────────────────────────────────

/**
 * The same money moves into the index: every purchase (and a carry-over) buys the index for the same sum on the same
 * day, every sale sells it; the cash is the same in both. The difference of what is held now is what the choice of the
 * securities gave over the index, in money and in percentage points of the sum bought.
 */
export function counterfactual(app: Database.Database, market: Database.Database, portfolioId: number, today = israelDate()) {
	const v = portfolioView(app, market, portfolioId, today);
	if (!v) return null;
	const pc = v.summary.currency;
	const m = marketView(market);
	const evs = app
		.prepare(
			`select e.id, e.kind, e.date, e.qty, e.price, e.fee, e.currency, s.price_unit as unit from position_events e join positions s on s.id = e.position_id
			  where s.portfolio_id = ? and e.kind in ('buy', 'sell', 'opening') and e.cancelled_at is null
			    and not exists (select 1 from position_events r where r.reverses_event_id = e.id and r.cancelled_at is null) order by e.date, e.id`
		)
		.all(portfolioId) as { id: number; kind: string; date: string; qty: number; price: number; fee: number | null; currency: string; unit: string }[];
	const indices = (pc === 'USD' ? [['benchmark:SPX', 'S&P 500', 'USD']] : [['benchmark:TA125', 'ТА-125', 'ILS'], ['benchmark:SPX', 'S&P 500', 'USD']]) as [string, string, string][];
	const f = (unit: string) => (unit === 'ILA' ? 0.01 : 1);
	let bought = 0;
	const flows = evs.map((e) => {
		const money = e.qty * e.price * f(e.unit) * m.conv(e.currency, pc, e.date);
		const fee = (e.fee ?? 0) * m.conv(e.currency, pc, e.date);
		const amount = e.kind === 'sell' ? -(money - fee) : money + fee;
		if (amount > 0) bought += amount;
		return { date: e.date, amount };
	});
	const out = indices
		.map(([key, label, cur]) => {
			const id = benchmarkId(market, key as 'benchmark:SPX' | 'benchmark:TA125');
			if (!id) return null;
			const at = (d: string) => {
				const p = m.price(id, d);
				return p ? p * m.conv(cur, pc, d) : null;
			};
			let units = 0;
			for (const x of flows) {
				const p = at(x.date);
				if (!p) return null;
				units += x.amount / p;
			}
			const nowP = at(today);
			if (!nowP) return null;
			const mirror = units * nowP;
			const held = v.summary.held;
			return { index: label, mirror: r2(mirror), held: r2(held), diff: r2(held - mirror), pp: bought > 0 ? r1(((held - mirror) / bought) * 100) : null };
		})
		.filter(Boolean);
	return { currency: pc, from: flows[0]?.date ?? null, bought: r2(bought), trades: flows.length, rows: out };
}

// ── the disposition effect, the year ─────────────────────────────────────────────────────────────────────

/**
 * Selling winners early and holding losers: the profit taken against the loss left open, how long the winners and the
 * losers were held, and how few positions make most of the open loss.
 */
export function disposition(app: Database.Database, market: Database.Database, portfolioId: number, today = israelDate()) {
	const v = portfolioView(app, market, portfolioId, today);
	const rep = portfolioReport(app, market, portfolioId, today);
	if (!v || !rep) return null;
	const realizedGain = rep.trades.filter((t) => t.profitPc > 0).reduce((n, t) => n + t.profitPc, 0);
	const realizedLoss = rep.trades.filter((t) => t.profitPc < 0).reduce((n, t) => n + t.profitPc, 0);
	const held = v.positions.filter((p) => p.qty > 0);
	const openLoss = held.filter((p) => p.unrealizedPc < 0).reduce((n, p) => n + p.unrealizedPc, 0);
	const openGain = held.filter((p) => p.unrealizedPc > 0).reduce((n, p) => n + p.unrealizedPc, 0);
	const losers = held.filter((p) => p.unrealizedPc < 0).sort((a, b) => a.unrealizedPc - b.unrealizedPc);
	let acc = 0;
	const few: string[] = [];
	for (const p of losers) {
		if (openLoss < 0 && acc / openLoss >= 0.75) break;
		acc += p.unrealizedPc;
		few.push(p.symbol);
	}
	const days = (from: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000));
	const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
	return {
		currency: v.summary.currency,
		realizedGain: r2(realizedGain),
		realizedLoss: r2(realizedLoss),
		openGain: r2(openGain),
		openLoss: r2(openLoss),
		soldWinnersDays: rep.summary.avgDaysWin,
		soldLosersDays: rep.summary.avgDaysLoss,
		heldWinnersDays: avg(held.filter((p) => p.unrealizedPc > 0).map((p) => days(p.openedAt))),
		heldLosersDays: avg(held.filter((p) => p.unrealizedPc < 0).map((p) => days(p.openedAt))),
		concentration: losers.length ? { n: few.length, of: losers.length, symbols: few, pct: openLoss < 0 ? Math.round((acc / openLoss) * 100) : 0 } : null
	};
}

/** the calendar year's realized result of the real portfolios — an estimate, not a tax calculation */
export function yearResult(app: Database.Database, market: Database.Database, year: number, today = israelDate()) {
	return listPortfolios(app)
		.filter((p) => p.kind === 'real' && !p.auto_source_id)
		.map((p) => {
			const rep = portfolioReport(app, market, p.id, today);
			const ts = (rep?.trades ?? []).filter((t) => t.sellDate.startsWith(String(year)));
			const cash = app
				.prepare(`select kind, sum(amount) as s from cash_events where portfolio_id = ? and kind in ('dividend', 'fee', 'tax') and cancelled_at is null and substr(date, 1, 4) = ? group by kind`)
				.all(p.id, String(year)) as { kind: string; s: number }[];
			const c = (k: string) => r2(cash.find((x) => x.kind === k)?.s ?? 0);
			return {
				portfolio: p.name,
				currency: p.currency,
				sales: ts.length,
				gain: r2(ts.filter((t) => t.profitPc > 0).reduce((n, t) => n + t.profitPc, 0)),
				loss: r2(ts.filter((t) => t.profitPc < 0).reduce((n, t) => n + t.profitPc, 0)),
				net: r2(ts.reduce((n, t) => n + t.profitPc, 0)),
				dividends: c('dividend'),
				fees: c('fee'),
				tax: c('tax')
			};
		});
}

/** in December — a reminder to look at the year's result before it closes (once a year) */
export function ensureYearReminder(app: Database.Database, market: Database.Database, today = israelDate()) {
	if (today.slice(5, 7) !== '12') return;
	const y = today.slice(0, 4);
	if (app.prepare('select 1 from journal_entries where origin = ?').get(`year:${y}`)) return;
	const id = addEntry(app, market, { kind: 'note', body: `<p>Итог ${y} года: реализованные прибыль и убыток — «Портфель» → «Итог года». Оценка, не налоговый расчёт.</p>`, format: 'html' }, { origin: `year:${y}` });
	if (id) addReminder(app, { entryId: id, condition: 'date', date: today, title: `Итог ${y} года по портфелям` });
}

// ── «Разбор позиций» ─────────────────────────────────────────────────────────────────────────────────────

/** the open positions of a portfolio with their latest review; «нет» to «купил бы сегодня» marks «держу без тезиса» */
export function reviews(app: Database.Database, market: Database.Database, portfolioId: number) {
	const v = portfolioView(app, market, portfolioId);
	if (!v) return null;
	const last = app.prepare('select date, thesis, would_buy as wouldBuy, exit_condition as exitCondition from position_reviews where position_id = ? order by id desc limit 1');
	const plan = app.prepare('select thesis, stop, target from trade_plans where position_id = ? order by id desc limit 1');
	const rows = v.positions
		.filter((p) => p.qty > 0)
		.map((p) => {
			const r = last.get(p.id) as { date: string; thesis: string | null; wouldBuy: number; exitCondition: string | null } | undefined;
			const pl = plan.get(p.id) as { thesis: string | null; stop: number | null; target: number | null } | undefined;
			return {
				positionId: p.id,
				securityId: p.securityId,
				symbol: p.symbol,
				weight: r1(p.weight ?? 0),
				unrealizedPct: r1(p.unrealizedPct),
				last: r ?? null,
				noThesis: r ? r.wouldBuy === 0 : false,
				suggest: { thesis: r?.thesis ?? pl?.thesis ?? '', exit: r?.exitCondition ?? [pl?.stop ? `стоп ${pl.stop}` : '', pl?.target ? `цель ${pl.target}` : ''].filter(Boolean).join(', ') }
			};
		});
	const dates = rows.map((x) => x.last?.date).filter((d): d is string => !!d);
	return { portfolio: v.portfolio.name, rows, lastFull: rows.length && dates.length === rows.length ? dates.sort()[0] : null };
}

/** one answer of the review — kept with its date, written to the diary; a whole review sets the next one in 3 months */
export function saveReview(app: Database.Database, market: Database.Database, positionId: number, input: { thesis?: unknown; wouldBuy?: unknown; exit?: unknown }, today = israelDate()) {
	const pos = app.prepare('select id, portfolio_id as p, symbol from positions where id = ?').get(positionId) as { id: number; p: number; symbol: string } | undefined;
	if (!pos) throw new InputError({ positionId: 'Нет такой позиции' } as Errors);
	const wb = input.wouldBuy === true || input.wouldBuy === 1 ? 1 : input.wouldBuy === false || input.wouldBuy === 0 ? 0 : null;
	if (wb === null) throw new InputError({ wouldBuy: 'Купил бы сегодня по этой цене — да или нет' } as Errors);
	const thesis = typeof input.thesis === 'string' ? input.thesis.trim().slice(0, 1000) : '';
	const exit = typeof input.exit === 'string' ? input.exit.trim().slice(0, 500) : '';
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	return app.transaction(() => {
		const entryId = addEntry(app, market, {
			kind: 'observation',
			format: 'html',
			body: `<p><b>Разбор позиции.</b> Тезис: ${thesis ? esc(thesis) : '—'}</p><p>Купил бы сегодня по этой цене: <b>${wb ? 'да' : 'нет — держу без тезиса'}</b></p><p>Условие выхода: ${exit ? esc(exit) : '—'}</p>`,
			links: [{ type: 'position', id: String(positionId), primary: true }]
		});
		app.prepare('insert into position_reviews (position_id, date, thesis, would_buy, exit_condition, entry_id) values (?, ?, ?, ?, ?, ?)').run(positionId, today, thesis || null, wb, exit || null, entryId);
		// the whole portfolio reviewed — the next review in three months (a reminder, once)
		const r = reviews(app, market, pos.p);
		if (r && r.rows.every((x) => x.last?.date === today)) {
			const title = `Разбор позиций: ${r.portfolio}`;
			const open = app.prepare(`select 1 from reminders where title = ? and state <> 'closed'`).get(title);
			if (!open && entryId) {
				const d = new Date(Date.parse(today + 'T12:00:00Z') + 91 * 86_400_000).toISOString().slice(0, 10);
				addReminder(app, { entryId, condition: 'date', date: d, title });
			}
		}
		return { entryId, noThesis: wb === 0 };
	})();
}

/** T-016 (3): the portfolio's share in the job's industry, looked through the funds — and «портфель + работа» */
export function workRisk(app: Database.Database, market: Database.Database, portfolioId: number) {
	const job = jobIndustry(app, market);
	const v = portfolioView(app, market, portfolioId);
	if (!v) return null;
	const L = limits(app);
	if (!job?.label) return { employer: job?.employer ?? null, industry: null, sharePct: null, limitPct: L.industryPct, positions: [] };
	const rows = v.positions
		.filter((p) => p.qty > 0)
		.map((p) => ({ symbol: p.symbol, share: jobShare(app, market, p.securityId, job.match), valuePc: p.valuePc }))
		.filter((x) => x.share > 0)
		.map((x) => ({ symbol: x.symbol, inIndustryPc: r2(x.valuePc * x.share), pct: r1(v.summary.value > 0 ? ((x.valuePc * x.share) / v.summary.value) * 100 : 0) }))
		.sort((a, b) => b.inIndustryPc - a.inIndustryPc);
	const sum = rows.reduce((n, x) => n + x.inIndustryPc, 0);
	return { employer: job.employer, industry: industryRu(job.label), sharePct: r1(v.summary.value > 0 ? (sum / v.summary.value) * 100 : 0), limitPct: L.industryPct, positions: rows };
}
