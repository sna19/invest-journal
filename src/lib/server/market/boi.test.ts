import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { openMarket } from '../db.js';
import { checkFx, fxOn, loadFx, parseBoi, USD_ILS } from './boi.js';

const csv = readFileSync(join(import.meta.dirname, 'fixtures', 'boi-usd-ils.csv'));

describe('USD/ILS from the Bank of Israel (section 18)', () => {
	it('parses the CSV by column names', () => {
		const rows = parseBoi(csv.toString());
		expect(rows[0]).toEqual({ date: '2026-10-01', rate: 3.08 });
		expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.rate > 2 && r.rate < 5)).toBe(true);
	});

	it('refuses an absurd rate and a jump over 10%', () => {
		const { good, issues } = checkFx(
			[
				{ date: '2026-10-01', rate: 3.08 },
				{ date: '2026-10-02', rate: 308 },
				{ date: '2026-10-05', rate: 3.6 },
				{ date: '2026-10-06', rate: 3.1 }
			],
			3.05
		);
		expect(good.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-06']);
		expect(issues.map((i) => i.rule)).toEqual(['fx.bad_rate', 'fx.jump']);
	});

	it('loads, a rerun adds nothing; the rate on a weekend is Friday’s', async () => {
		const { db, sqlite } = openMarket(':memory:');
		const runId = (sqlite.prepare(`insert into ops_ingest_runs (job, provider_code) values ('fx', 'boi') returning id`).get() as { id: number }).id;
		const c = { db, sqlite, get: async () => csv, rawDir: mkdtempSync(join(tmpdir(), 'raw-')), runId, day: '2026-11-17' };
		const a = await loadFx(c, '2026-10-01', '2026-11-17');
		expect(a.added).toBeGreaterThan(20);
		const b = await loadFx(c, '2026-10-01', '2026-11-17');
		expect(b).toMatchObject({ added: 0, updated: 0 });
		const n = (sqlite.prepare('select count(*) as n from market_fx_daily where pair = ?').get(USD_ILS) as { n: number }).n;
		expect(n).toBe(a.added);
		// 2026-10-03 is a Saturday: the rate of Friday 2026-10-02
		expect(fxOn(sqlite, '2026-10-03')).toBe(3.06);
		expect(fxOn(sqlite, '2016-01-01')).toBeNull();
	});
});
