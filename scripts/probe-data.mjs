#!/usr/bin/env node
// Stage 0 — checks the data sources from the NAS (no dependencies, Node 22).
// Usage: node scripts/probe-data.mjs [--burst]
//   lists:  Nasdaq Trader (NASDAQ, NYSE, NYSE American, NYSE Arca) and the TASE site's search index
//   prices: one year of daily closes for 3 US + 3 TASE securities and 2 indices (Yahoo chart API)
//   --burst: 10 years for 300 random US symbols, 6 at a time — speed and rate limits

const UA = { 'User-Agent': 'Mozilla/5.0' };
const TASE = { ...UA, Origin: 'https://market.tase.co.il', Referer: 'https://market.tase.co.il/', Accept: 'application/json' };

/** GET with three retries (2, 4, 8 s): the TASE site sometimes answers 403 at random (Incapsula). 404 is final. */
async function get(url, headers = UA) {
	for (let attempt = 0; ; attempt++) {
		const r = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) }).catch((e) => ({ ok: false, status: e.name }));
		if (r.ok) return r;
		if (r.status === 404 || attempt === 3) throw new Error(`${r.status} ${url}`);
		await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
	}
}

function pipeTable(text) {
	const lines = text.trim().split('\n').filter((l) => !l.startsWith('File Creation Time'));
	const head = lines[0].split('|');
	return lines.slice(1).map((l) => Object.fromEntries(l.split('|').map((v, i) => [head[i], v])));
}

// warrants, rights, units, preferred shares and notes are not stocks for the journal
const NOT_STOCK = /\b(warrants?|rights?|units?|preferred|notes due|debentures)\b|%/i;

async function usLists() {
	const nasdaq = pipeTable(await (await get('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt')).text());
	const other = pipeTable(await (await get('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt')).text());
	const keep = (r) => r['Test Issue'] === 'N' && !NOT_STOCK.test(r['Security Name']);
	const byExchange = { NASDAQ: nasdaq.filter(keep) };
	const names = { N: 'NYSE', A: 'NYSE American', P: 'NYSE Arca', Z: 'Cboe BZX' };
	for (const r of other.filter(keep)) (byExchange[names[r.Exchange] ?? r.Exchange] ??= []).push(r);
	const count = Object.fromEntries(Object.entries(byExchange).map(([k, v]) => [k, `${v.length} (ETF ${v.filter((r) => r.ETF === 'Y').length})`]));
	return { raw: { nasdaq: nasdaq.length, other: other.length }, kept: count };
}

async function taseList() {
	const url = (lang) => `https://api.tase.co.il/api/content/searchentities?lang=${lang}`;
	const en = await (await get(url(1), TASE)).json();
	const he = new Map((await (await get(url(0), TASE)).json()).filter((e) => e.Type === 1).map((e) => [e.Id, e.Name]));
	// Type 1 = traded security; SubType 1 shares, 42 equity ETF, 44 foreign equity ETF
	const kinds = { 1: 'shares', 42: 'etf', 44: 'foreign etf' };
	const sec = en.filter((e) => e.Type === 1 && kinds[e.SubType]);
	const count = {};
	for (const e of sec) count[kinds[e.SubType]] = (count[kinds[e.SubType]] ?? 0) + 1;
	const find = (smb) => sec.find((e) => e.Smb === smb);
	const sample = ['TEVA', 'LUMI', 'NICE'].map((s) => find(s)).map((e) => `${e.Smb} ${e.Name} / ${he.get(e.Id)} ${e.ISIN}`);
	return { entities: en.length, kept: count, sample };
}

/** Yahoo symbol: US as is ('.' → '-'), TASE symbol with '.' → '-' and '.TA' */
async function prices(symbol, range = '1y') {
	const r = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=div%2Csplit`);
	const res = (await r.json()).chart.result?.[0];
	if (!res) return { symbol, rows: 0 };
	const close = res.indicators.quote[0].close;
	const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
	return {
		symbol,
		currency: res.meta.currency,
		rows: res.timestamp.length,
		from: day(res.timestamp[0]),
		to: day(res.timestamp.at(-1)),
		empty: close.filter((c) => c == null).length,
		last: close.at(-1),
		events: Object.keys(res.events ?? {})
	};
}

async function burst(n = 300, parallel = 6) {
	const other = pipeTable(await (await get('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt')).text());
	const syms = other.sort(() => Math.random() - 0.5).slice(0, n).map((r) => r['ACT Symbol'].replace('.', '-'));
	const t0 = Date.now();
	const out = { ok: 0, rows: 0, errors: {} };
	let i = 0;
	await Promise.all(
		Array.from({ length: parallel }, async () => {
			while (i < syms.length) {
				const s = syms[i++];
				try {
					const p = await prices(s, '10y');
					out.ok++;
					out.rows += p.rows;
				} catch (e) {
					const code = String(e.message).split(' ')[0];
					out.errors[code] = (out.errors[code] ?? 0) + 1;
				}
			}
		})
	);
	const sec = (Date.now() - t0) / 1000;
	return { ...out, seconds: sec, perSecond: +(n / sec).toFixed(1) };
}

const log = (title, v) => console.log(`\n## ${title}\n${JSON.stringify(v, null, 2)}`);
log('US lists (Nasdaq Trader)', await usLists());
log('TASE list (api.tase.co.il searchentities)', await taseList());
const syms = ['AAPL', 'AMAT', 'TEVA', 'TEVA.TA', 'LUMI.TA', 'NICE.TA', '^GSPC', '^TA125.TA'];
log('Prices, 1 year (Yahoo chart API)', await Promise.all(syms.map((s) => prices(s))));
if (process.argv.includes('--burst')) log('Burst: 10 years × 300 US symbols, 6 parallel', await burst());
