import { error, redirect } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';

/** T-030: a position opens as its security's card, with its block «Моя позиция» first — old links come here */
export function load({ params }) {
	const r = getApp().sqlite.prepare('select security_id as sid from positions where id = ?').get(Number(params.id)) as { sid: number } | undefined;
	if (!r) error(404, 'нет такой позиции');
	redirect(302, `/security/${r.sid}?position=${params.id}`);
}
