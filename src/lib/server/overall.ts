import { and, eq, ne } from 'drizzle-orm';
import { calibration, score, split, tagsOf, TAG_MIN, type Score } from '../stats.js';
import type { AppDb } from './db.js';
import { articles, hypotheses, sources } from './schema/app.js';
import type { StatsFilter } from './sources.js';

/**
 * Spec sections 7 and 9 — the «Статистика» screen: calibration, own ideas against outside sources,
 * simulation against real money, tags. Every comparison but the calibration uses the rating's rules
 * (section 17): closed in term, types with the direction from the source; news apart; cancelled never.
 */
function rows(db: AppDb, f: StatsFilter) {
	const where = [ne(hypotheses.status, 'cancelled')];
	if (f.noDefault) where.push(ne(hypotheses.horizonSource, 'default'));
	return db
		.select({
			status: hypotheses.status,
			signalType: hypotheses.signalType,
			outcome: hypotheses.outcome,
			excessPct: hypotheses.excessPct,
			confidencePct: hypotheses.confidencePct,
			mode: hypotheses.mode,
			tags: hypotheses.tags,
			own: sources.kind
		})
		.from(hypotheses)
		.innerJoin(articles, eq(articles.id, hypotheses.articleId))
		.innerJoin(sources, eq(sources.id, articles.sourceId))
		.where(and(...where))
		.all()
		.map((r) => ({ ...r, own: r.own === 'own' }));
}

type Row = ReturnType<typeof rows>[number];

export interface Side {
	key: string;
	label: string;
	score: Score;
	open: number;
	news: Score;
}

function side(key: string, label: string, list: Row[]): Side {
	const s = split(list);
	return { key, label, score: score(s.rated), news: score(s.news), open: list.filter((r) => r.status === 'open').length };
}

export function overallStats(db: AppDb, f: StatsFilter = {}) {
	const list = rows(db, f);

	// tags: one line per tag once it has TAG_MIN closed in the rating; the ones still gathering — names and counts
	const byTag = new Map<string, { label: string; rows: Row[] }>();
	for (const r of list)
		for (const t of tagsOf(r.tags)) {
			const k = t.toLocaleLowerCase('ru');
			const e = byTag.get(k) ?? { label: t, rows: [] };
			e.rows.push(r);
			byTag.set(k, e);
		}
	const tags = [...byTag.entries()].map(([k, e]) => side(k, e.label, e.rows));

	return {
		total: { closed: list.filter((r) => r.status === 'closed').length, open: list.filter((r) => r.status === 'open').length },
		calibration: calibration(list),
		own: [side('own', 'Собственные идеи', list.filter((r) => r.own)), side('outside', 'Внешние источники', list.filter((r) => !r.own))],
		mode: [side('sim', 'Симуляция', list.filter((r) => r.mode !== 'real')), side('real', 'Реальные деньги', list.filter((r) => r.mode === 'real'))],
		tags: {
			shown: tags.filter((t) => t.score.n >= TAG_MIN).sort((a, b) => b.score.lower - a.score.lower || b.score.n - a.score.n),
			gathering: tags
				.filter((t) => t.score.n < TAG_MIN)
				.map((t) => ({ label: t.label, closed: t.score.n, open: t.open }))
				.sort((a, b) => b.closed - a.closed || b.open - a.open || a.label.localeCompare(b.label))
		}
	};
}
