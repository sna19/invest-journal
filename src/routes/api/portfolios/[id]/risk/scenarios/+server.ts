import { error, json } from '@sveltejs/kit';
import { getApp } from '#lib/server/db.js';
import { body } from '#lib/server/respond.js';

/** T-023: the saved «Что если?» scenarios of a portfolio — GET the list, POST { name, data }, DELETE ?id= */
export function GET({ params }) {
	const rows = getApp()
		.sqlite.prepare('select id, name, data, created_at as createdAt from risk_scenarios where portfolio_id = ? order by id desc')
		.all(Number(params.id)) as { id: number; name: string; data: string; createdAt: string }[];
	return json({ items: rows.map((r) => ({ ...r, data: JSON.parse(r.data) })) });
}

export async function POST({ params, request }) {
	const b = await body(request);
	const name = String(b.name ?? '').trim().slice(0, 100);
	if (!name) error(400, 'нужно название');
	const data = JSON.stringify(b.data ?? {});
	if (data.length > 4000) error(400, 'слишком большой сценарий');
	const app = getApp().sqlite;
	if (!app.prepare('select 1 from portfolios where id = ?').get(Number(params.id))) error(404, 'нет такого портфеля');
	const id = Number(app.prepare('insert into risk_scenarios (portfolio_id, name, data) values (?, ?, ?)').run(Number(params.id), name, data).lastInsertRowid);
	return json({ id }, { status: 201 });
}

export function DELETE({ params, url }) {
	getApp().sqlite.prepare('delete from risk_scenarios where id = ? and portfolio_id = ?').run(Number(url.searchParams.get('id')), Number(params.id));
	return json({ ok: true });
}
