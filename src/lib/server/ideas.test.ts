import { describe, expect, it } from 'vitest';
import { openApp, openMarket } from './db.js';
import { cleanSignalSettings, keepPosition, markIdea, readSignalSettings, SDEFAULTS, writeSignalSettings } from './ideas.js';

describe('T-035: signals', () => {
	it('the settings are kept within their limits; the defaults are the confirmed ones', () => {
		expect(SDEFAULTS).toMatchObject({ weekday: 0, hour: 20, maxIdeas: 5, markets: ['US', 'IL'] });
		expect(cleanSignalSettings({ maxIdeas: 50, hour: 25, markets: ['US', 'XX'] })).toMatchObject({ maxIdeas: 5, hour: 20, markets: ['US'] });
		const app = openApp(':memory:').sqlite;
		writeSignalSettings(app, { maxIdeas: 3, weekday: 6 });
		expect(readSignalSettings(app)).toMatchObject({ maxIdeas: 3, weekday: 6, hour: 20 });
	});

	it('a skip and a «keep» need a reason', () => {
		const app = openApp(':memory:').sqlite;
		const market = openMarket(':memory:').sqlite;
		app.prepare(`insert into signal_ideas (run, security_id, rank, score, data) values ('2026-11-29', 1, 1, 0.8, '{"symbol":"XYZ"}')`).run();
		expect(() => markIdea(app, market, 1, 'skipped', '')).toThrow();
		expect(markIdea(app, market, 1, 'wanted', '')).toBe('wanted');
		expect(() => keepPosition(app, market, 'score_red|5|0', '')).toThrow();
		expect(() => keepPosition(app, market, 'stop|5|0', 'x')).toThrow();
		expect(keepPosition(app, market, 'overweight|5|0', 'долгосрочная', '2026-11-27')).toBe('2026-12-27');
	});
});
