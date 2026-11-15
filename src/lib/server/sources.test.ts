import { describe, expect, it } from 'vitest';
import { openApp } from './db.js';
import { sourceCard, sourceTable } from './sources.js';

/** A test journal: sources with closed hypotheses inserted directly (as the jobs would leave them). */
function journal() {
	const { db, sqlite } = openApp(':memory:');
	const src = sqlite.prepare(`insert into sources (name) values (?) returning id`);
	const art = sqlite.prepare(`insert into articles (source_id, author, read_at) values (?, ?, '2026-01-05') returning id`);
	const hyp = sqlite.prepare(
		`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction,
		   direction_source, thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol, status, outcome, excess_pct, mode)
		 values (?, 1, 'X', 'X', 'NYSE', 'USD', 'USD', ?, 'long', 'article', 't', 'i', ?, ?, '2026-01-05', 1, 'SPX', ?, ?, ?, ?)`
	);
	const add = (name: string, hits: number, n: number, o: { type?: string; status?: string; author?: string; horizon?: string; horizonSource?: string; mode?: string } = {}) => {
		const s = (sqlite.prepare('select id from sources where name = ?').get(name) as { id: number } | undefined)?.id ?? (src.get(name) as { id: number }).id;
		const a = (art.get(s, o.author ?? 'Аналитик') as { id: number }).id;
		for (let i = 0; i < n; i++)
			hyp.run(a, o.type ?? 'recommendation', o.horizon ?? '2026-04-05', o.horizonSource ?? 'article', o.status ?? 'closed', i < hits ? 'hit' : 'miss', i < hits ? 4 : -2, o.mode ?? 'sim');
		return s;
	};
	return { db, sqlite, add };
}

describe('the «Источники» table (stage 4 criteria)', () => {
	it('7 of 10 → 40–89%; 9 closed → few data; 2 of 2 below 20 of 30; news does not change the rating', () => {
		const j = journal();
		j.add('Семь из десяти', 7, 10);
		j.add('Девять', 6, 9);
		j.add('Два из двух', 2, 2);
		j.add('Двадцать из тридцати', 20, 30);
		const before = sourceTable(j.db).find((r) => r.name === 'Семь из десяти')!.score;
		j.add('Семь из десяти', 0, 6, { type: 'news' });
		j.add('Семь из десяти', 3, 3, { status: 'closed_early' });
		j.add('Семь из десяти', 0, 2, { status: 'cancelled' });
		j.add('Семь из десяти', 0, 4, { status: 'open' });
		const t = sourceTable(j.db);
		const by = (name: string) => t.find((r) => r.name === name)!;

		const seven = by('Семь из десяти');
		expect(Math.round(seven.score.ci![0] * 100)).toBe(40);
		expect(Math.round(seven.score.ci![1] * 100)).toBe(89);
		expect(seven.score).toEqual(before); // news, early closes, cancelled and open ones leave it as it was
		expect(seven.news).toMatchObject({ n: 6, hits: 0 });
		expect(seven.early).toMatchObject({ n: 3, hits: 3 });
		expect(seven.open).toBe(4);
		expect(seven.articles).toBe(4); // cancelled-only article not counted

		expect(by('Девять').score).toMatchObject({ n: 9, hits: 6, level: 'few' });
		expect(by('Семь из десяти').score.level).toBe('prelim');
		expect(by('Двадцать из тридцати').score.level).toBe('firm');

		const order = t.map((r) => r.name);
		expect(order.indexOf('Двадцать из тридцати')).toBeLessThan(order.indexOf('Два из двух'));
		// sources set up in advance with no hypotheses come last
		expect(order.slice(-5).sort()).toEqual(["Barron's", 'Globes', 'TheMarker', 'WSJ', 'Собственная идея'].sort());
	});
});

describe('the source card', () => {
	it('breaks down by type, author, term and mode; filter without default terms', () => {
		const j = journal();
		const id = j.add('Издание', 3, 4, { author: 'Morgan Stanley' });
		j.add('Издание', 1, 2, { author: 'Goldman', type: 'target', horizon: '2026-12-05' });
		j.add('Издание', 0, 2, { type: 'news', horizonSource: 'default', mode: 'real' });
		const c = sourceCard(j.db, id)!;
		expect(c.score).toMatchObject({ n: 6, hits: 4 });
		expect(c.byType.map((t) => [t.label, t.score.n, t.rated])).toEqual([
			['Рекомендация', 4, true],
			['Целевая цена', 2, true],
			['Новость', 2, false]
		]);
		expect(c.byAuthor.map((a) => a.label).sort()).toEqual(['Goldman', 'Morgan Stanley', 'Аналитик']);
		expect(Object.fromEntries(c.byHorizon.map((h) => [h.key, h.score.n + h.news.n]))).toEqual({ short: 6, long: 2 });
		expect(c.byMode.map((m) => m.label).sort()).toEqual(['Реальные деньги', 'Симуляция']);
		expect(c.articles).toHaveLength(3);
		const f = sourceCard(j.db, id, { noDefault: true })!;
		expect(f.news.n).toBe(0);
		expect(f.articles).toHaveLength(2);
		expect(sourceCard(j.db, 9999)).toBeNull();
	});
});
