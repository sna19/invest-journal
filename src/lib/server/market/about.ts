import type Database from 'better-sqlite3';
import { fetchGet, session, type ProfileGet } from './profiles.js';
import { securitiesForPrices } from './prices.js';

/**
 * «О компании» (owner 26.11.2026: «для каждой бумаги я хотел бы знать что это за фирма и что она делает»). Yahoo's
 * profile has a business summary for a company and a fund, the site, the staff and the seat. It comes with the weekly
 * profiles of the followed securities and, for any other, when its card is opened; it is kept 90 days. The summary is
 * English; it is translated into Russian once (Google's public translation endpoint) and the translation is kept — if
 * that fails, the card shows the original and a link to translate it.
 */

export interface About {
	summary: string | null;
	website: string | null;
	employees: number | null;
	city: string | null;
	country: string | null;
	fundFamily: string | null;
}

export function parseAbout(body: string): About | null {
	const r = JSON.parse(body)?.quoteSummary?.result?.[0];
	if (!r) return null;
	const a = r.assetProfile ?? {};
	const summary = typeof a.longBusinessSummary === 'string' && a.longBusinessSummary.trim() ? a.longBusinessSummary.trim() : null;
	const site = typeof a.website === 'string' && /^https?:\/\//.test(a.website) ? a.website : null;
	return {
		summary,
		website: site,
		employees: typeof a.fullTimeEmployees === 'number' ? a.fullTimeEmployees : null,
		city: a.city ?? null,
		country: a.country ?? null,
		fundFamily: r.fundProfile?.family ?? null
	};
}

export function saveAbout(market: Database.Database, id: number, a: About | null, now = new Date()) {
	const old = market.prepare('select summary, summary_ru as ru from ref_security_about where security_id = ?').get(id) as { summary: string | null; ru: string | null } | undefined;
	// the translation stays while the text is the same
	const ru = old && old.summary === a?.summary ? old.ru : null;
	market
		.prepare(
			`insert into ref_security_about (security_id, summary, summary_ru, website, employees, city, country, fund_family, fetched_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 on conflict (security_id) do update set summary = excluded.summary, summary_ru = excluded.summary_ru, website = excluded.website, employees = excluded.employees,
			   city = excluded.city, country = excluded.country, fund_family = excluded.fund_family, fetched_at = excluded.fetched_at`
		)
		.run(id, a?.summary ?? null, ru, a?.website ?? null, a?.employees ?? null, a?.city ?? null, a?.country ?? null, a?.fundFamily ?? null, now.toISOString());
}

/** one Yahoo session for a while: the cookie and the crumb serve many cards */
let yahoo: { cookie: string; crumb: string; at: number } | null = null;
async function yahooSession(get: ProfileGet) {
	if (!yahoo || Date.now() - yahoo.at > 30 * 60_000) yahoo = { ...(await session(get)), at: Date.now() };
	return yahoo;
}

export type Translate = (text: string) => Promise<string | null>;

/** Google's public endpoint (the one the translate widget uses); the text in parts of up to 1 800 letters by sentences */
export const googleTranslate: Translate = async (text) => {
	const parts: string[] = [];
	let cur = '';
	for (const s of text.split(/(?<=[.!?])\s+/)) {
		if ((cur + ' ' + s).length > 1800 && cur) (parts.push(cur), (cur = s));
		else cur = cur ? `${cur} ${s}` : s;
	}
	if (cur) parts.push(cur);
	const out: string[] = [];
	for (const p of parts) {
		const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(p)}`, {
			headers: { 'User-Agent': 'Mozilla/5.0' },
			signal: AbortSignal.timeout(15_000)
		});
		if (!r.ok) return null;
		const j = (await r.json()) as [[string, string][]];
		out.push(j[0].map((x) => x[0]).join(''));
	}
	return out.join(' ').trim() || null;
};

const DAY = 86_400_000;

/**
 * The «О компании» of a security: from the base when fresh, otherwise asked from Yahoo now; the Russian text is made
 * once. Errors leave what there is.
 */
export async function aboutOf(market: Database.Database, id: number, opts: { get?: ProfileGet; translate?: Translate; now?: Date } = {}) {
	const now = opts.now ?? new Date();
	const read = () =>
		market.prepare(`select summary, summary_ru as summaryRu, website, employees, city, country, fund_family as fundFamily, fetched_at as fetchedAt from ref_security_about where security_id = ?`).get(id) as
			| (About & { summaryRu: string | null; fetchedAt: string })
			| undefined;
	let row = read();
	if (!row || now.getTime() - Date.parse(row.fetchedAt) > 90 * DAY) {
		const sec = securitiesForPrices(market, [id])[0];
		if (sec) {
			try {
				const get = opts.get ?? fetchGet;
				const { cookie, crumb } = await yahooSession(get);
				const r = await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sec.yahoo)}?modules=assetProfile,fundProfile,price&crumb=${encodeURIComponent(crumb)}`, cookie);
				if (r.status === 401 || r.status === 403) yahoo = null;
				if (r.status === 200 || r.status === 404) saveAbout(market, id, r.status === 200 ? parseAbout(r.body) : null, now);
			} catch (e) {
				console.error(`about ${id}: ${e instanceof Error ? e.message : e}`);
			}
			row = read();
		}
	}
	if (row?.summary && !row.summaryRu) {
		try {
			const ru = await (opts.translate ?? googleTranslate)(row.summary);
			if (ru) market.prepare('update ref_security_about set summary_ru = ? where security_id = ?').run(ru, id);
			row = read();
		} catch (e) {
			console.error(`about ${id} translate: ${e instanceof Error ? e.message : e}`);
		}
	}
	return row ? { summary: row.summary, summaryRu: row.summaryRu, website: row.website, employees: row.employees, city: row.city, country: row.country, fundFamily: row.fundFamily, fetchedAt: row.fetchedAt } : null;
}
