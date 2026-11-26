import { json } from '@sveltejs/kit';
import { fail } from '#lib/server/respond.js';
import { savePhoto } from '#lib/server/snapshots.js';

/** T-032 Д-24: POST the bytes of a photo (made smaller in the browser) → { path } under data/media */
export async function POST({ request }) {
	try {
		return json({ path: savePhoto(new Uint8Array(await request.arrayBuffer())) }, { status: 201 });
	} catch (e) {
		return fail(e);
	}
}
