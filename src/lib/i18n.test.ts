import { describe, expect, it, vi } from 'vitest';

let data: { lang: string } = { lang: 'en' };
vi.mock('$app/state', () => ({ page: { get data() { return data; } } }));
vi.mock('$app/navigation', () => ({ invalidateAll: async () => {} }));

const { tl, tx, loc } = await import('./i18n.js');
const { STAGE_LABEL, CASH_LABEL } = await import('./portfolio.js');

describe('English for texts that come as data', () => {
	it('looks up exact texts and patterns, nested ones too', () => {
		data = { lang: 'en' };
		expect(tl('Выберите источник')).toBe('Choose a source');
		expect(tl('до 49%')).toBe('up to 49%');
		expect(tl('После изменения продажа больше, чем было: На 2026-11-10 в позиции 5, а продаётся 7')).toBe(
			'After the change more is sold than was held: On 2026-11-10 the position holds 5, but 7 is being sold'
		);
		expect(tl('не в словаре')).toBe('не в словаре');
		expect(tl(null)).toBe('');
	});

	it('stays Russian for a Russian user', () => {
		data = { lang: 'ru' };
		expect(tl('Выберите источник')).toBe('Выберите источник');
		expect(tx('Портфель', 'Portfolio')).toBe('Портфель');
		expect(loc()).toBe('ru-RU');
	});

	it('label maps answer in the page language', () => {
		data = { lang: 'en' };
		expect(STAGE_LABEL.holding).toBe('Holding');
		expect(Object.values(CASH_LABEL)).toContain('Dividend');
		data = { lang: 'ru' };
		expect(STAGE_LABEL.holding).toBe('В портфеле');
	});
});
