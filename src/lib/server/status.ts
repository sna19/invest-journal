import type Database from 'better-sqlite3';
import { ring, ringSecurities } from './market/rings.js';

/**
 * Spec sections 5 and 14 — what the «Данные» block shows: the last run of each job, how many securities and
 * price rows, the history queue, open quality issues, the «Нет данных» list; and whether the daily job is late.
 */
const JOBS = ['prices', 'history', 'hypotheses', 'listings', 'gaps', 'backup-app', 'backup-market'];

export function dataStatus(market: Database.Database, app: Database.Database, now = new Date()) {
	const last = market.prepare(
		`select job, provider_code as provider, started_at as startedAt, finished_at as finishedAt, status, rows_received as received,
		        rows_added as added, rows_updated as updated, error
		   from ops_ingest_runs where job = ? order by id desc limit 1`
	);
	const jobs = JOBS.map((j) => last.get(j)).filter(Boolean) as { job: string; finishedAt: string | null; status: string }[];
	const one = (sql: string, ...a: unknown[]) => (market.prepare(sql).get(...a) as { n: number }).n;
	const ids = ringSecurities(market, app);

	// «Нет данных» (section 5): a security of the ring without a price for three trading days, or unknown to the provider
	const noData: { id: number; symbol: string; exchange: string; lastDate: string | null; why: string }[] = [];
	const third = market.prepare(`select date from ref_trading_days where exchange_code = ? order by date desc limit 1 offset 2`);
	const info = market.prepare(
		`select s.id, s.symbol, s.exchange_code as exchange, s.price_status as ps, case e.country when 'IL' then 'TASE' else 'US' end as cal,
		        (select max(date) from market_prices_daily p where p.security_id = s.id) as lastDate
		   from ref_securities s join ref_exchanges e on e.code = s.exchange_code where s.id = ?`
	);
	for (const id of ids) {
		const s = info.get(id) as { id: number; symbol: string; exchange: string; ps: string | null; cal: string; lastDate: string | null };
		if (s.ps === 'none') {
			noData.push({ id, symbol: s.symbol, exchange: s.exchange, lastDate: null, why: 'нет у поставщика цен' });
			continue;
		}
		const t = (third.get(s.cal) as { date: string } | undefined)?.date;
		if (s.lastDate && t && s.lastDate < t) noData.push({ id, symbol: s.symbol, exchange: s.exchange, lastDate: s.lastDate, why: 'нет цены три торговых дня' });
	}

	const lastPrices = market
		.prepare(`select max(finished_at) as at from ops_ingest_runs where job = 'prices' and status in ('ok', 'suspicious')`)
		.get() as { at: string | null };
	const lateHours = lastPrices.at ? (now.getTime() - Date.parse(lastPrices.at)) / 3600000 : null;

	return {
		ring: ring(market),
		jobs,
		securities: one(`select count(*) as n from ref_securities where active = 1`),
		ringSize: ids.length,
		withPrices: one(`select count(distinct security_id) as n from market_prices_daily`),
		priceRows: one(`select count(*) as n from market_prices_daily`),
		queue: {
			queued: one(`select count(*) as n from ops_ingest_tasks where status in ('queued', 'running')`),
			failed: one(`select count(*) as n from ops_ingest_tasks where status = 'failed'`)
		},
		issues: {
			open: one(`select count(*) as n from ops_quality_issues where status = 'open'`),
			// jumps first: they wait for a person and may hold a hypothesis
			recent: market
				.prepare(
					`select q.id, q.rule, q.detail, q.date, s.symbol, s.exchange_code as exchange from ops_quality_issues q
					   left join ref_securities s on s.id = q.security_id
					  where q.status = 'open' order by q.rule = 'price.jump' desc, q.date desc limit 50`
				)
				.all()
		},
		noData,
		lastPricesAt: lastPrices.at,
		/** the daily job has not worked for two days — a banner on the main screen */
		late: lateHours === null ? false : lateHours > 48
	};
}
