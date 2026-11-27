import { describe, expect, it } from 'vitest';
import { TableSort } from './tablesort.svelte.js';

describe('owner 27.11.2026: a tap on a header sorts', () => {
	const rows = [
		{ s: 'B', v: 2 },
		{ s: 'A', v: null },
		{ s: 'C', v: 5 }
	];
	const get = (r: (typeof rows)[number], k: 's' | 'v') => r[k];
	it('first tap — biggest first, second — turned over, third — the own order; empties last', () => {
		const t = new TableSort<'s' | 'v'>();
		expect(t.rows(rows, get)).toBe(rows);
		t.by('v');
		expect(t.rows(rows, get).map((r) => r.v)).toEqual([5, 2, null]);
		t.by('v');
		expect(t.rows(rows, get).map((r) => r.v)).toEqual([2, 5, null]);
		t.by('v');
		expect(t.key).toBeNull();
		t.by('s', false);
		expect(t.rows(rows, get).map((r) => r.s)).toEqual(['A', 'B', 'C']);
	});
});
