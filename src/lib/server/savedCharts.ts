import type Database from 'better-sqlite3';
import type { Errors } from '../hypothesis.js';
import { InputError } from './journal.js';

/**
 * Owner 27.11.2026: saved charts. A chart is a security and what was chosen on it: the period, the SMAs on, the lines
 * shown (sector, industry, indices, added shares), the shares added to compare (shown or not) and the shaded quarter.
 */
export interface ChartConfig {
	period: string;
	sma: string[];
	shown: number[];
	peers: number[];
	highlight: number | null;
}

const PERIODS = ['1M', '3M', '6M', '1Y', '5Y', '10Y'];
const ids = (x: unknown, max: number) => (Array.isArray(x) ? [...new Set(x.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max) : []);

export function cleanConfig(x: unknown): ChartConfig {
	const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
	const h = Number(o.highlight);
	return {
		period: PERIODS.includes(String(o.period)) ? String(o.period) : '1Y',
		sma: Array.isArray(o.sma) ? o.sma.map(String).filter((s) => ['20', '50', '200'].includes(s)) : [],
		shown: ids(o.shown, 20),
		peers: ids(o.peers, 12),
		highlight: h >= 1 && h <= 4 ? h : null
	};
}

const SELECT = `select c.id, c.name, c.security_id as securityId, c.config, c.created_at as createdAt, c.updated_at as updatedAt from saved_charts c`;
type Row = { id: number; name: string; securityId: number; config: string; createdAt: string; updatedAt: string };
const view = (market: Database.Database, r: Row) => {
	const config = cleanConfig(JSON.parse(r.config));
	const sym = market.prepare('select symbol from ref_securities where id = ?').pluck();
	return {
		...r,
		config,
		symbol: (sym.get(r.securityId) as string | undefined) ?? '?',
		peerSymbols: config.peers.map((id) => (sym.get(id) as string | undefined) ?? '?')
	};
};

export function listCharts(app: Database.Database, market: Database.Database) {
	return (app.prepare(`${SELECT} order by c.updated_at desc`).all() as Row[]).map((r) => view(market, r));
}

/** owner 27.11.2026: the saved charts a security takes part in — its own, or added to compare */
export function chartsWith(app: Database.Database, market: Database.Database, securityId: number) {
	return listCharts(app, market).filter((c) => c.securityId === securityId || c.config.peers.includes(securityId));
}

export function getChart(app: Database.Database, market: Database.Database, id: number) {
	const r = app.prepare(`${SELECT} where c.id = ?`).get(id) as Row | undefined;
	return r ? view(market, r) : null;
}

const nameOf = (x: unknown) => {
	const n = typeof x === 'string' ? x.trim().slice(0, 120) : '';
	if (!n) throw new InputError({ name: 'Название графика' } as Errors);
	return n;
};

export function createChart(app: Database.Database, market: Database.Database, input: { name?: unknown; securityId?: unknown; config?: unknown }) {
	const sid = Number(input.securityId);
	if (!market.prepare('select 1 from ref_securities where id = ?').get(sid)) throw new InputError({ securityId: 'Нет такой бумаги' } as Errors);
	const id = Number(app.prepare('insert into saved_charts (name, security_id, config) values (?, ?, ?)').run(nameOf(input.name), sid, JSON.stringify(cleanConfig(input.config))).lastInsertRowid);
	return getChart(app, market, id)!;
}

export function updateChart(app: Database.Database, market: Database.Database, id: number, input: { name?: unknown; config?: unknown }) {
	const cur = getChart(app, market, id);
	if (!cur) throw new InputError({ id: 'Нет такого графика' } as Errors);
	const name = input.name === undefined ? cur.name : nameOf(input.name);
	const config = input.config === undefined ? cur.config : cleanConfig(input.config);
	app.prepare(`update saved_charts set name = ?, config = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = ?`).run(name, JSON.stringify(config), id);
	return getChart(app, market, id)!;
}

export function deleteChart(app: Database.Database, id: number) {
	app.prepare('delete from saved_charts where id = ?').run(id);
}
