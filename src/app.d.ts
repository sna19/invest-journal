// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	const __BUILD_TIME__: string;
	namespace App {
		// interface Error {}
		interface Locals {
			user: import('#lib/server/auth.js').User | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
