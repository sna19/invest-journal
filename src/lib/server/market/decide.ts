import type Database from 'better-sqlite3';
import { recomputeFactors } from './prices.js';

/**
 * Stage 4 addition to stage 3 — a person looks at a jump of more than 50% (spec section 14: «ждёт подтверждения»).
 * «Цена верна» (valid): the refused row goes into the table, the issue is confirmed.
 * «Цена ошибочна» (invalid): the day stays out of the table for good, the issue is rejected.
 * Either way the decision is kept: later loads respect it and do not raise the same issue again.
 */
export function decideIssue(market: Database.Database, id: number, decision: 'valid' | 'invalid') {
	const q = market.prepare(`select id, security_id, date, rule, status, payload from ops_quality_issues where id = ?`).get(id) as
		| { id: number; security_id: number; date: string; rule: string; status: string; payload: string | null }
		| undefined;
	if (!q) return { error: 'нет такой проблемы' } as const;
	if (q.rule !== 'price.jump') return { error: 'решение принимается только по скачкам цены' } as const;
	if (q.status !== 'open') return { error: 'по этой проблеме уже решено' } as const;
	if (decision === 'valid') {
		if (!q.payload) return { error: 'строка цены не сохранилась — загрузите бумагу заново' } as const;
		const r = JSON.parse(q.payload) as { date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null };
		market.transaction(() => {
			market
				.prepare(
					`insert into market_prices_daily (security_id, date, open, high, low, close, volume, provider_code)
					 values (?, ?, ?, ?, ?, ?, ?, 'yahoo')
					 on conflict (security_id, date) do update set close = excluded.close, open = excluded.open, high = excluded.high, low = excluded.low`
				)
				.run(q.security_id, r.date, r.open, r.high, r.low, r.close, r.volume);
			market.prepare(`update ops_quality_issues set status = 'confirmed' where id = ?`).run(id);
		})();
		// a dividend factor uses the close before its ex-date — this day may be one
		recomputeFactors(market, q.security_id);
	} else {
		market.prepare(`update ops_quality_issues set status = 'rejected' where id = ?`).run(id);
	}
	return { ok: true, securityId: q.security_id, date: q.date } as const;
}
