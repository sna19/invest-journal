import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as appSchema from './schema/app.js';
import * as marketSchema from './schema/market.js';
import { seedMarket } from './seed.js';

/** Volumes (spec section 10): databases in /data, backups in /backups, raw provider answers in /raw. */
export const dataDir = resolve(process.env.DATA_DIR ?? 'data');
export const backupDir = resolve(process.env.BACKUP_DIR ?? join(dataDir, 'backups'));
export const rawDir = resolve(process.env.RAW_DIR ?? join(dataDir, 'raw'));
const migrationsDir = resolve(process.env.MIGRATIONS_DIR ?? 'drizzle');

export type AppDb = BetterSQLite3Database<typeof appSchema>;
export type MarketDb = BetterSQLite3Database<typeof marketSchema>;

function open<S extends Record<string, unknown>>(path: string, schema: S, folder: string) {
	const sqlite = new Database(path);
	// WAL is required: a long history load must not block the app (spec section 14)
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	const db = drizzle(sqlite, { schema, casing: 'snake_case' });
	const journal = join(folder, 'meta', '_journal.json');
	if (!existsSync(journal)) throw new Error(`migrations not found in ${folder} (cwd ${process.cwd()}); set MIGRATIONS_DIR`);
	if (path !== ':memory:') backupBeforeMigrations(sqlite, journal, path);
	migrate(db, { migrationsFolder: folder });
	return { sqlite, db };
}

/** The journal is the value: copy a file before a schema change touches it. */
function backupBeforeMigrations(sqlite: Database.Database, journal: string, path: string) {
	const total = JSON.parse(readFileSync(journal, 'utf8')).entries.length as number;
	const has = sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
	if (!has) return; // a new, empty database
	const { n } = sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number };
	if (n >= total) return;
	mkdirSync(backupDir, { recursive: true });
	const name = path.split(/[/\\]/).pop()!.replace(/\.db$/, '');
	const file = join(backupDir, `${name}-pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
	sqlite.prepare('VACUUM INTO ?').run(file);
	console.log(`backup before ${total - n} migration(s): ${file}`);
}

export function openApp(path: string) {
	return open(path, appSchema, join(migrationsDir, 'app')) as { sqlite: Database.Database; db: AppDb };
}

export function openMarket(path: string) {
	const m = open(path, marketSchema, join(migrationsDir, 'market')) as { sqlite: Database.Database; db: MarketDb };
	seedMarket(m.db);
	return m;
}

/**
 * One line per volume: who the process is, who owns the folder, whether it can write there. The usual
 * failure on the NAS is a volume the container user (1026:100) cannot write to — say so in the log.
 */
export function volumeReport(): { ok: boolean; lines: string[] } {
	const who = `uid ${process.getuid?.()} gid ${process.getgid?.()}`;
	let ok = true;
	const lines = [dataDir, backupDir, rawDir].map((dir) => {
		try {
			mkdirSync(dir, { recursive: true });
			const st = statSync(dir);
			let writable = true;
			try {
				accessSync(dir, constants.W_OK);
			} catch {
				writable = false;
				ok = false;
			}
			return `${dir}: owner ${st.uid}:${st.gid} mode ${(st.mode & 0o777).toString(8)} — ${writable ? 'writable' : 'NOT writable'} for ${who}`;
		} catch (e) {
			ok = false;
			return `${dir}: ${(e as Error).message} (${who})`;
		}
	});
	return { ok, lines };
}

let app: ReturnType<typeof openApp> | undefined;
let market: ReturnType<typeof openMarket> | undefined;

function ensureDir() {
	mkdirSync(dataDir, { recursive: true });
}

export function getApp() {
	if (!app) {
		ensureDir();
		app = openApp(join(dataDir, 'app.db'));
	}
	return app;
}

export function getMarket() {
	if (!market) {
		ensureDir();
		market = openMarket(join(dataDir, 'market.db'));
	}
	return market;
}

export const getAppDb = (): AppDb => getApp().db;
export const getMarketDb = (): MarketDb => getMarket().db;
