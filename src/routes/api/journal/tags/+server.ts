import { json } from '@sveltejs/kit';
import { getApp, getMarket } from '#lib/server/db.js';
import { scopeOf, tagCloud } from '#lib/server/diary.js';

/** Д-13: the tags of a place (or of all entries) with their counts */
export function GET({ url }) {
	return json({ items: tagCloud(getApp().sqlite, getMarket().sqlite, scopeOf(url.searchParams.get('scope')), url.searchParams.get('inherit') !== '0') });
}
