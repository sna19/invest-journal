/// <reference lib="webworker" />
import { self } from '$app/service-worker';
import { immutable, assets } from '$app/manifest';

// The app shell opens without network; data come from /api and are not cached yet (stage 2 adds the draft queue).
const abs = (p: string) => '/' + p.replace(/^\//, '');
// not '/': without a login it redirects to /login (users, 19.11.2026)
const SHELL = [...immutable.map((f) => abs(f.path)), ...assets.map((f) => abs(f.path))];
// Immutable file names carry content hashes, so their list identifies the build.
let h = 0;
for (const ch of SHELL.join('|')) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
const CACHE = `shell-${(h >>> 0).toString(36)}`;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((c) => c.addAll(SHELL))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/health') return;

	if (req.mode === 'navigate') {
		// Network only: the Caddy lock and the app's own login pass through to the browser.
		event.respondWith(fetch(req));
		return;
	}

	event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
});
