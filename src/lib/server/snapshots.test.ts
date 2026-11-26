import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { addEntry, listEntries } from './diary.js';
import { addSnapshot, readPhoto, recordQuarterEntry, savePhoto } from './snapshots.js';
import { signalsBlock } from './reminders.js';

function setup() {
	const app = openApp(':memory:').sqlite;
	const market = openMarket(':memory:').sqlite;
	const sec = market.prepare(`insert into ref_securities (exchange_code, type, symbol, name_en, currency, price_unit, search) values ('NASDAQ', 'stock', ?, ?, 'USD', 'USD', ?) returning id`);
	const a = (sec.get('MPC', 'Marathon', 'mpc') as { id: number }).id;
	const b = (sec.get('UTL', 'Unitil', 'utl') as { id: number }).id;
	return { app, market, a, b };
}

describe('T-032 11в: snapshots', () => {
	it('an entry keeps a snapshot\'s numbers as they came; the feed returns them', () => {
		const s = setup();
		const id = addEntry(s.app, s.market, { body: 'Смотрю на график', links: [{ type: 'security', id: s.a }] })!;
		addSnapshot(s.app, id, { type: 'chart', params: { securityId: s.a, symbol: 'MPC', period: '1Y' }, data: { lines: [{ key: 'sec', label: 'MPC', points: [{ date: '2026-11-01', value: 100 }], main: true }], marks: [] } });
		const e = listEntries(s.app, s.market, {}).items[0];
		expect(e.snapshots).toMatchObject([{ type: 'chart', params: { symbol: 'MPC' }, data: { lines: [{ points: [{ value: 100 }] }] } }]);
		expect(() => addSnapshot(s.app, id, { type: 'video', data: {} })).toThrow(/Тип снимка/);
		expect(() => addSnapshot(s.app, id, { type: 'chart', data: { x: 'a'.repeat(700_000) } })).toThrow(/большой/);
		expect(() => addSnapshot(s.app, id, { type: 'photo', photoPath: 'u1/2026/nope.jpg' })).toThrow(/фото/);
	});

	it('the model\'s quarter: a system entry with the candidates\' snapshot, linked to the run, and «разбор квартала» at its end', () => {
		const s = setup();
		const cands = [
			{ id: s.a, symbol: 'MPC', name: 'Marathon', sector: 'energy', mean: 5.4, median: 3.3, worst: -2, up: 7, score: null },
			{ id: s.b, symbol: 'UTL', name: 'Unitil', sector: 'utilities', mean: 2.1, median: 1.8, worst: -1, up: 6, score: null }
		];
		const id = recordQuarterEntry(s.app, s.market, { variant: 'A', quarter: '2027-Q1', versionId: 3, params: { k: 10 }, years: 10, quarterEnd: '2027-03-31', candidates: cands })!;
		expect(recordQuarterEntry(s.app, s.market, { variant: 'A', quarter: '2027-Q1', versionId: 3, params: {}, years: 10, quarterEnd: '2027-03-31', candidates: cands })).toBeNull();
		const run = listEntries(s.app, s.market, { scope: { type: 'model_run', id: 'A|2027-Q1' } }).items;
		expect(run.map((e) => e.id)).toEqual([id]);
		expect(run[0].snapshots).toMatchObject([{ type: 'candidates', params: { variant: 'A', quarter: '2027-Q1', versionId: 3 }, data: { candidates: [{ symbol: 'MPC' }, { symbol: 'UTL' }] } }]);
		// the candidate's own feed — its security — has it across the quarters
		expect(listEntries(s.app, s.market, { scope: { type: 'security', id: String(s.b) } }).items.map((e) => e.id)).toEqual([id]);
		expect(signalsBlock(s.app, s.market, '2027-03-31').reminders.map((r) => r.title)).toEqual(['Разбор квартала: модель A 2027 Q1']);
	});

	it('a photo must be an image; another user\'s path or a way out of the folder is refused', () => {
		expect(() => savePhoto(new Uint8Array([1, 2, 3, 4]))).toThrow(/JPEG/);
		expect(readPhoto('../../etc/passwd')).toBeNull();
		expect(readPhoto('u2/2026/x.jpg')).toBeNull();
		expect(readPhoto('u1/../u2/2026/x.jpg')).toBeNull();
	});
});
