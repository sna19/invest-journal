import { error, json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { portfolioProtection, protectionOf } from '#lib/server/protection.js';

/** T-021: GET ?security=<id>[&portfolio=<id>] — the block «Защита» of a security; ?portfolio=<id> alone — the portfolio's line and its positions */
export function GET({ url }) {
	const sec = Number(url.searchParams.get('security'));
	const port = Number(url.searchParams.get('portfolio'));
	if (sec) return json(protectionOf(getApp().sqlite, getMarket().sqlite, sec, port ? { portfolioId: port } : {}));
	if (port) {
		const v = portfolioProtection(getApp().sqlite, getMarket().sqlite, port);
		if (!v) error(404, 'no such portfolio');
		return json(v);
	}
	error(400, 'security or portfolio');
}
