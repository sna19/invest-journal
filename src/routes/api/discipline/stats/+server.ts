import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { disciplineStats } from '#lib/server/discipline.js';

/** T-015: the «Дисциплина» block of «Статистика» */
export function GET() {
	return json(disciplineStats(getApp().sqlite, getMarket().sqlite));
}
