import { describe, expect, it } from 'vitest';
import { openApp } from './db.js';
import { overallStats } from './overall.js';

/**
 * Stage 6 criterion — the «Статистика» screen on a test set of 50 hypotheses, against numbers worked out by hand
 * (the expected values below are written from the set, not from the code):
 *
 *   group  source            type     conf  mode  status        n  hits  tags
 *   A      Собственная идея   opinion  55    sim   closed       10   5    —
 *   B      Barron's          rec      65    sim   closed        8   4    AI
 *   C      Barron's          target   75    real  closed       12   6    ai, Израиль
 *   D      WSJ               rec      85    sim   closed        5   4    банки
 *   E      Собственная идея   opinion  40    sim   closed        3   1    —
 *   F      WSJ               news     —     sim   closed        4   2    —
 *   G      Barron's          rec      90    sim   closed_early  3   3    —
 *   H      Barron's          rec      70    sim   cancelled     2   0    —
 *   I      Barron's          rec      60    sim   open          3   —    ai
 */
function fifty() {
	const { db, sqlite } = openApp(':memory:');
	const sid = (name: string) => (sqlite.prepare('select id from sources where name = ?').get(name) as { id: number }).id;
	const art = sqlite.prepare(`insert into articles (source_id, read_at) values (?, '2026-01-05') returning id`);
	const hyp = sqlite.prepare(
		`insert into hypotheses (article_id, security_id, symbol, security_name, exchange_code, currency, price_unit, signal_type, direction,
		   direction_source, thesis, invalidation, horizon_date, horizon_source, entry_date, benchmark_id, benchmark_symbol, status, outcome,
		   excess_pct, mode, confidence_pct, tags)
		 values (?, 1, 'X', 'X', 'NYSE', 'USD', 'USD', ?, 'long', 'article', 't', 'i', '2026-04-05', 'article', '2026-01-05', 1, 'SPX', ?, ?, ?, ?, ?, ?)`
	);
	let count = 0;
	const add = (source: string, type: string, conf: number | null, mode: string, status: string, n: number, hits: number, tags: string | null = null) => {
		const a = (art.get(sid(source)) as { id: number }).id;
		for (let i = 0; i < n; i++) {
			const closed = status !== 'open' && status !== 'cancelled';
			hyp.run(a, type, status, closed ? (i < hits ? 'hit' : 'miss') : null, closed ? (i < hits ? 3 : -3) : null, mode, conf, tags);
			count++;
		}
	};
	add('Собственная идея', 'opinion', 55, 'sim', 'closed', 10, 5);
	add("Barron's", 'recommendation', 65, 'sim', 'closed', 8, 4, 'AI');
	add("Barron's", 'target', 75, 'real', 'closed', 12, 6, 'ai, Израиль');
	add('WSJ', 'recommendation', 85, 'sim', 'closed', 5, 4, 'банки');
	add('Собственная идея', 'opinion', 40, 'sim', 'closed', 3, 1);
	add('WSJ', 'news', null, 'sim', 'closed', 4, 2);
	add("Barron's", 'recommendation', 90, 'sim', 'closed_early', 3, 3);
	add("Barron's", 'recommendation', 70, 'sim', 'cancelled', 2, 0);
	add("Barron's", 'recommendation', 60, 'sim', 'open', 3, 0, 'ai');
	return { db, count };
}

describe('«Статистика» on 50 hypotheses (stage 6 criterion)', () => {
	const { db, count } = fifty();
	const s = overallStats(db);

	it('the set is 50 hypotheses', () => expect(count).toBe(50));

	it('calibration: closed in term with a confidence; early, cancelled, open and no-confidence ones stay out', () => {
		const c = s.calibration;
		// A + B + C + D + E = 10 + 8 + 12 + 5 + 3 = 38 hypotheses, 5 + 4 + 6 + 4 + 1 = 20 hits
		expect(c.n).toBe(38);
		expect(c.hits).toBe(20);
		// (55·10 + 65·8 + 75·12 + 85·5 + 40·3) / 38 = 2515 / 38 = 66.18
		expect(c.meanConf!).toBeCloseTo(66.18, 2);
		expect(c.rate!).toBeCloseTo(20 / 38, 6);
		// Brier: A 5·0.45² + 5·0.55² = 2.525; B 4·0.35² + 4·0.65² = 2.18; C 6·0.25² + 6·0.75² = 3.75;
		// D 4·0.15² + 1·0.85² = 0.8125; E 1·0.6² + 2·0.4² = 0.68; sum 9.9475 / 38 = 0.26178
		expect(c.brier!).toBeCloseTo(0.26178, 4);
		expect(c.without).toBe(4); // F
		expect(c.buckets.map((b) => [b.label, b.n, b.hits, Math.round(b.meanConf)])).toEqual([
			['до 49%', 3, 1, 40],
			['50–59%', 10, 5, 55],
			['60–69%', 8, 4, 65],
			['70–79%', 12, 6, 75],
			['80–89%', 5, 4, 85]
		]);
		const b55 = c.buckets[1];
		// 5 of 10: Wilson 23.7–76.3%, «предварительно»
		expect(b55.ci![0]).toBeCloseTo(0.2366, 3);
		expect(b55.ci![1]).toBeCloseTo(0.7634, 3);
		expect(b55.level).toBe('prelim');
		expect(c.buckets[4].level).toBe('few');
	});

	it('own ideas against outside sources — by the rating rules (news apart)', () => {
		const [own, outside] = s.own;
		expect(own.score).toMatchObject({ n: 13, hits: 6, level: 'prelim' }); // A + E
		expect(outside.score).toMatchObject({ n: 25, hits: 14 }); // B + C + D
		expect(outside.news).toMatchObject({ n: 4, hits: 2 }); // F
		expect(outside.open).toBe(3); // I
	});

	it('simulation against real money', () => {
		const [sim, real] = s.mode;
		expect(real.score).toMatchObject({ n: 12, hits: 6 }); // C
		expect(sim.score).toMatchObject({ n: 26, hits: 14 }); // A + B + D + E
	});

	it('tags: case does not split a tag; shown from 10 closed, sorted by the lower bound; the rest are gathering', () => {
		// AI = B + C (20 closed, 10 hits, I open), Израиль = C (12, 6) — 10/20 has the higher lower bound (29.9% > 25.4%)
		expect(s.tags.shown.map((t) => [t.label, t.score.n, t.score.hits, t.open])).toEqual([
			['AI', 20, 10, 3],
			['Израиль', 12, 6, 0]
		]);
		expect(s.tags.gathering).toEqual([{ label: 'банки', closed: 5, open: 0 }]);
	});

	it('without default terms the filter applies', () => {
		expect(overallStats(db, { noDefault: true }).calibration.n).toBe(38);
	});
});
