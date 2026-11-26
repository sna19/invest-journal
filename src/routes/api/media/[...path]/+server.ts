import { error } from '@sveltejs/kit';
import { readPhoto } from '#lib/server/snapshots.js';

/** a photo of the diary — the current user's only */
export function GET({ params }) {
	const p = readPhoto(params.path);
	if (!p) error(404, 'нет такого фото');
	return new Response(p.bytes, { headers: { 'content-type': p.type, 'cache-control': 'private, max-age=31536000, immutable' } });
}
