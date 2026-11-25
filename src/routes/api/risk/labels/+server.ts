import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { queueSecurity } from '#lib/server/jobs.js';
import { riskView } from '#lib/server/risk.js';
import { whatIf } from '#lib/risk.js';

/**
 * GET ?ids=1,2,…[&portfolio=…] — T-023 (4): «снижает риск / нейтрально / дублирует …» of each security bought for 5%
 * of the portfolio from the cash — for the model's candidates, the security card and the «Купил» form. The
 * portfolio: the one asked, else the largest real one.
 */
export function GET({ url }) {
	const app = getApp().sqlite;
	const market = getMarket().sqlite;
	const ids = (url.searchParams.get('ids') ?? '')
		.split(',')
		.map(Number)
		.filter((x) => Number.isInteger(x) && x > 0)
		.slice(0, 12);
	let pid = Number(url.searchParams.get('portfolio')) || null;
	if (!pid) {
		const ports = app.prepare(`select id from portfolios where kind = 'real' and archived_at is null and auto_source_id is null order by sort_order, id`).all() as { id: number }[];
		let best = -1;
		for (const p of ports) {
			const v = riskView(app, market, p.id, { years: 2 });
			if (v && v.value > best && v.now.held > 0) (best = v.value), (pid = p.id);
		}
	}
	if (!pid || !ids.length) return json({ portfolio: null, items: {} });
	const items: Record<number, { label: string; twin: string | null; corr: number | null; loading: boolean } | null> = {};
	// in groups of three: the covariance grows with every security
	for (let k = 0; k < ids.length; k += 3) {
		const part = ids.slice(k, k + 3);
		const r = riskView(app, market, pid, { years: 2, add: part });
		if (!r) continue;
		for (const id of r.loading) queueSecurity(id);
		for (const id of part) {
			if (r.securities.find((s) => s.id === id)?.role === 'held') {
				items[id] = { label: 'held', twin: null, corr: null, loading: false };
				continue;
			}
			if (r.loading.includes(id)) {
				items[id] = { label: 'loading', twin: null, corr: null, loading: true };
				continue;
			}
			const w = whatIf(r, [id], 0.05);
			items[id] = { label: w.label, twin: w.twin?.symbol ?? null, corr: w.twin ? Math.round(w.twin.corr * 100) / 100 : null, loading: false };
		}
	}
	const name = (app.prepare('select name from portfolios where id = ?').get(pid) as { name: string } | undefined)?.name ?? null;
	return json({ portfolio: { id: pid, name }, items });
}
