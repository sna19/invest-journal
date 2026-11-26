import { json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { deleteRule } from '#lib/server/discipline.js';

export function DELETE({ params }) {
	return json({ items: deleteRule(getApp().sqlite, Number(params.id)) });
}
