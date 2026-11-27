import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { counterfactual, disposition, limits, reviews, speculation, workRisk } from '#lib/server/portfolioRisk.js';
import { portfolioView } from '#lib/server/portfolio.js';

/** T-016: the portfolio's risk and review — the job's industry, the speculation budget, «А если бы в индекс», the disposition effect, the position review */
export function GET({ params, url }) {
	const app = getApp().sqlite;
	const market = getMarket().sqlite;
	const id = Number(params.id);
	// T-019: the sale form asks only for the review (the disposition reminder)
	if (url.searchParams.get('only') === 'reviews') return json({ reviews: reviews(app, market, id) });
	const v = portfolioView(app, market, id);
	if (!v) return json({ message: 'Нет такого портфеля' }, { status: 404 });
	const s = speculation(app, market, id);
	const L = limits(app);
	const total = v.summary.value;
	return json({
		limits: L,
		work: workRisk(app, market, id),
		speculation: { ...s, sharePct: total > 0 ? Math.round((s.value / total) * 1000) / 10 : null, lossPct: total > 0 ? Math.round((s.loss / total) * 1000) / 10 : null },
		counterfactual: counterfactual(app, market, id),
		disposition: disposition(app, market, id),
		reviews: reviews(app, market, id)
	});
}
