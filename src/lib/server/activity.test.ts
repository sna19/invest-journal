import { describe, expect, it } from 'vitest';
import { activities, begin } from './activity.js';

describe('owner 27.11.2026: the background work is shown, not a frozen screen', () => {
	it('a job is busy with its progress until it ends, then «last» for a minute', () => {
		const a = begin('t', 'Пересчёт', 10);
		a.progress(4);
		expect(activities().busy).toEqual([expect.objectContaining({ key: 't', label: 'Пересчёт', done: 4, total: 10 })]);
		a.end();
		expect(activities().busy).toEqual([]);
		expect(activities().last?.label).toBe('Пересчёт');
	});
});
