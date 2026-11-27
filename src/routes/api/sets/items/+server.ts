import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { queueSecurities } from '#lib/server/jobs.js';
import { setItems } from '#lib/server/setItems.js';

const idsOf = (s: string | null) => [...new Set((s ?? '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0))];

/**
 * GET ?ids=1,2,…&portfolios=3,4 — a set's securities with price, the day, 1M / 3M / 1Y, sector, cap (owner 27.11.2026,
 * «наборы»); `portfolios` adds what those portfolios hold now, each item marked with the portfolios it comes from.
 */
export function GET({ url }) {
	const ids = idsOf(url.searchParams.get('ids'));
	const ports = idsOf(url.searchParams.get('portfolios'));
	const from = new Map<number, number[]>();
	if (ports.length) {
		const rows = getApp()
			.sqlite.prepare(`select distinct security_id as id, portfolio_id as p from positions where portfolio_id in (${ports.map(() => '?').join(',')}) and stage in ('holding', 'plan_sell')`)
			.all(...ports) as { id: number; p: number }[];
		for (const r of rows) from.set(r.id, [...(from.get(r.id) ?? []), r.p]);
	}
	const all = [...new Set([...ids, ...from.keys()])].slice(0, 40);
	const r = setItems(getMarket().sqlite, all.map((id) => ({ id })));
	queueSecurities(r.missing);
	return json({ items: r.items.map((x) => ({ ...x, portfolios: from.get(x.id) ?? [] })) });
}
