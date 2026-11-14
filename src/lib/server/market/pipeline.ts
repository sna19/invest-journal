import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { MarketDb } from '../db.js';
import { exchanges, ingestRuns, providerSymbols, qualityIssues, rawFiles, securities, securitySymbols } from '../schema/market.js';
import type { Fetcher, ListingAdapter, ListingRow, RawPayload } from './types.js';

/**
 * Spec section 14 — the five steps, the same for every provider:
 * 1 get (with retries, in the fetcher) → 2 keep the raw answer in /raw → 3 parse to the common shape →
 * 4 check (bad rows go to ops_quality_issues) → 5 merge by the provider's key (a rerun adds no rows).
 * «Temporary table» of step 3 is the parsed array: a listing run is one file of ~15 thousand rows.
 */

export interface RunSummary {
	runId: number;
	provider: string;
	status: 'ok' | 'suspicious' | 'error';
	received: number;
	added: number;
	updated: number;
	deactivated: number;
	issues: number;
	error?: string;
}

export const searchText = (r: { symbol: string; nameEn: string; nameHe?: string | null }) =>
	[r.symbol, r.nameEn, r.nameHe].filter(Boolean).join(' ').toLowerCase();

/** Step 2: compressed copy of each answer, so the base can be rebuilt without asking the provider again. */
export function saveRaw(db: MarketDb, rawDir: string, provider: string, runId: number, day: string, payloads: RawPayload[]) {
	const dir = join(rawDir, provider, day);
	mkdirSync(dir, { recursive: true });
	for (const p of payloads) {
		const rel = join(provider, day, `run${runId}-${p.name}.gz`);
		const gz = gzipSync(p.body);
		writeFileSync(join(rawDir, rel), gz);
		db.insert(rawFiles)
			.values({ runId, providerCode: provider, path: rel, sha256: createHash('sha256').update(p.body).digest('hex'), bytes: gz.length })
			.run();
	}
}

/** Step 4: rules for a listing row. Returns the good rows and the problems. */
export function checkListings(rows: ListingRow[], known: Set<string>) {
	const good: ListingRow[] = [];
	const issues: { rule: string; detail: string }[] = [];
	const seen = new Set<string>();
	for (const r of rows) {
		const where = `${r.exchangeCode}:${r.symbol} (${r.providerSymbol})`;
		if (!r.symbol?.trim() || /\s/.test(r.symbol)) issues.push({ rule: 'listing.bad_symbol', detail: where });
		else if (!r.nameEn?.trim()) issues.push({ rule: 'listing.no_name', detail: where });
		else if (!known.has(r.exchangeCode)) issues.push({ rule: 'listing.unknown_exchange', detail: where });
		else if (!['USD', 'ILS', 'ILA'].includes(r.priceUnit)) issues.push({ rule: 'listing.bad_price_unit', detail: `${where} ${r.priceUnit}` });
		else if (seen.has(r.providerSymbol)) issues.push({ rule: 'listing.duplicate', detail: where });
		else {
			seen.add(r.providerSymbol);
			good.push(r);
		}
	}
	return { good, issues };
}

/** A run whose row count differs from the last good one more than twofold is suspicious (spec section 14). */
export function isSuspicious(count: number, previous: number | undefined) {
	return previous !== undefined && previous > 0 && (count < previous / 2 || count > previous * 2);
}

export async function runListings(
	db: MarketDb,
	adapter: ListingAdapter,
	opts: { get: Fetcher; rawDir: string; now?: Date }
): Promise<RunSummary> {
	const now = opts.now ?? new Date();
	const day = now.toISOString().slice(0, 10);
	const provider = adapter.code;
	const { id: runId } = db.insert(ingestRuns).values({ job: 'listings', providerCode: provider }).returning({ id: ingestRuns.id }).get();
	const summary: RunSummary = { runId, provider, status: 'ok', received: 0, added: 0, updated: 0, deactivated: 0, issues: 0 };
	const finish = () => {
		db.update(ingestRuns)
			.set({
				finishedAt: new Date().toISOString(),
				status: summary.status,
				rowsReceived: summary.received,
				rowsAdded: summary.added,
				rowsUpdated: summary.updated + summary.deactivated,
				error: summary.error ?? null
			})
			.where(eq(ingestRuns.id, runId))
			.run();
		return summary;
	};

	try {
		const payloads = await adapter.fetchListings(opts.get);
		saveRaw(db, opts.rawDir, provider, runId, day, payloads);
		const parsed = adapter.parseListings(payloads);
		const known = new Set(db.select({ code: exchanges.code }).from(exchanges).all().map((e) => e.code));
		const { good, issues } = checkListings(parsed, known);
		summary.received = good.length;
		summary.issues = issues.length;
		const previous = db
			.select({ n: ingestRuns.rowsReceived })
			.from(ingestRuns)
			.where(and(eq(ingestRuns.job, 'listings'), eq(ingestRuns.providerCode, provider), eq(ingestRuns.status, 'ok')))
			.orderBy(desc(ingestRuns.id))
			.limit(1)
			.get()?.n;
		const suspicious = isSuspicious(good.length, previous) || good.length === 0;
		if (suspicious) summary.status = 'suspicious';

		db.transaction((tx) => {
			for (const i of issues) tx.insert(qualityIssues).values({ runId, rule: i.rule, detail: i.detail }).run();
			merge(tx as unknown as MarketDb, provider, good, day, summary, !suspicious);
		});
	} catch (e) {
		summary.status = 'error';
		summary.error = String((e as Error).message ?? e);
	}
	return finish();
}

/** Step 5: insert new securities, update changed ones, mark the missing ones inactive (never delete). */
function merge(db: MarketDb, provider: string, rows: ListingRow[], day: string, s: RunSummary, deactivate: boolean) {
	const existing = new Map(
		db
			.select({ key: providerSymbols.providerSymbol, sec: securities })
			.from(providerSymbols)
			.innerJoin(securities, eq(securities.id, providerSymbols.securityId))
			.where(eq(providerSymbols.providerCode, provider))
			.all()
			.map((r) => [r.key, r.sec])
	);
	const stamp = new Date().toISOString();
	const setYahoo = (securityId: number, symbol: string) => {
		// a symbol that moved to another venue: the Yahoo name follows the active security
		db.delete(providerSymbols).where(and(eq(providerSymbols.providerCode, 'yahoo'), eq(providerSymbols.providerSymbol, symbol))).run();
		db.insert(providerSymbols)
			.values({ securityId, providerCode: 'yahoo', providerSymbol: symbol })
			.onConflictDoUpdate({ target: [providerSymbols.securityId, providerSymbols.providerCode], set: { providerSymbol: symbol } })
			.run();
	};

	for (const r of rows) {
		const old = existing.get(r.providerSymbol);
		existing.delete(r.providerSymbol);
		const fields = {
			exchangeCode: r.exchangeCode,
			type: r.type,
			symbol: r.symbol,
			nameEn: r.nameEn,
			nameHe: r.nameHe ?? null,
			isin: r.isin ?? null,
			currency: r.currency,
			priceUnit: r.priceUnit,
			search: searchText(r)
		};
		if (!old) {
			const { id } = db
				.insert(securities)
				.values({ ...fields, listedAt: day })
				.returning({ id: securities.id })
				.get();
			db.insert(providerSymbols).values({ securityId: id, providerCode: provider, providerSymbol: r.providerSymbol }).run();
			db.insert(securitySymbols).values({ securityId: id, symbol: r.symbol, validFrom: day }).run();
			setYahoo(id, r.yahooSymbol);
			s.added++;
			continue;
		}
		const changed =
			!old.active ||
			(Object.keys(fields) as (keyof typeof fields)[]).some((k) => (old[k] ?? null) !== (fields[k] ?? null));
		if (!changed) continue;
		db.update(securities)
			.set({ ...fields, active: true, delistedAt: null, updatedAt: stamp })
			.where(eq(securities.id, old.id))
			.run();
		if (old.symbol !== r.symbol) {
			// the ticker changed: close the old one in the history, open the new one, move the Yahoo name
			db.update(securitySymbols)
				.set({ validTo: day })
				.where(and(eq(securitySymbols.securityId, old.id), sql`${securitySymbols.validTo} is null`))
				.run();
			db.insert(securitySymbols)
				.values({ securityId: old.id, symbol: r.symbol, validFrom: day })
				.onConflictDoUpdate({ target: [securitySymbols.securityId, securitySymbols.validFrom], set: { symbol: r.symbol, validTo: null } })
				.run();
			setYahoo(old.id, r.yahooSymbol);
		}
		s.updated++;
	}

	if (!deactivate) return;
	// gone from the list: inactive, but kept — hypotheses may point to it
	for (const sec of existing.values()) {
		if (!sec.active) continue;
		db.update(securities).set({ active: false, delistedAt: day, updatedAt: stamp }).where(eq(securities.id, sec.id)).run();
		s.deactivated++;
	}
}
