import { describe, expect, it } from 'vitest';
import { moveTo, orderOf } from './sortable.js';

describe('block order (section 13)', () => {
	it('moves a block and keeps a saved order across new and removed blocks', () => {
		expect(moveTo(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
		expect(orderOf(['tags', 'gone', 'calibration'], ['calibration', 'own', 'mode', 'tags'])).toEqual(['tags', 'calibration', 'own', 'mode']);
		expect(orderOf('junk', ['a', 'b'])).toEqual(['a', 'b']);
	});
});
