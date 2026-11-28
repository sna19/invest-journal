/**
 * The portfolio's allocation (section 19, widened on the owner's request 19.11.2026): the value of the held
 * positions and the cash, grouped by a measure — security, sector, industry, country, company size, kind,
 * market, currency or result. A fund with known sector weights is split across sectors by them («look-through»).
 */

export interface AllocProfile {
	type: string;
	kind: 'stock' | 'etf' | 'none' | null;
	sector: string | null;
	industry: string | null;
	country: string | null;
	capUsd: number | null;
	fundCategory: string | null;
	sectorWeights: Record<string, number> | null;
	/** T-016: a fund's countries and industries looked through */
	countryWeights?: Record<string, number> | null;
	industryWeights?: Record<string, number> | null;
}

export interface AllocPosition {
	symbol: string;
	/** for the link from a slice's list to the card */
	securityId?: number;
	valuePc: number;
	currency: string;
	unrealizedPc: number;
	profile: AllocProfile | null;
}

export type Metric = 'security' | 'sector' | 'industry' | 'country' | 'region' | 'size' | 'type' | 'market' | 'currency' | 'result';
export const METRICS: Metric[] = ['security', 'sector', 'industry', 'country', 'region', 'size', 'type', 'market', 'currency', 'result'];
/** owner 28.11.2026: the measures that can look at the stocks only or the funds only */
export const SCOPED: Metric[] = ['sector', 'industry', 'country', 'region', 'size'];
export type Scope = 'all' | 'stock' | 'etf';

type Tx = (ru: string, en: string) => string;

export const METRIC_LABEL = (t: Tx): Record<Metric, string> => ({
	security: t('Бумаги', 'Securities'),
	sector: t('Секторы', 'Sectors'),
	industry: t('Отрасли', 'Industries'),
	country: t('Страны', 'Countries'),
	region: t('Регионы', 'Regions'),
	size: t('Размер компаний', 'Company size'),
	type: t('Акции и фонды', 'Stocks and funds'),
	market: t('Рынки', 'Markets'),
	currency: t('Валюты', 'Currencies'),
	result: t('Результат', 'Result')
});

export const SECTORS: Record<string, [string, string]> = {
	technology: ['Технологии', 'Technology'],
	financial_services: ['Финансы', 'Financial services'],
	healthcare: ['Здравоохранение', 'Healthcare'],
	consumer_cyclical: ['Товары не первой необходимости', 'Consumer cyclical'],
	consumer_defensive: ['Товары первой необходимости', 'Consumer defensive'],
	communication_services: ['Связь и медиа', 'Communication services'],
	industrials: ['Промышленность', 'Industrials'],
	energy: ['Энергетика', 'Energy'],
	basic_materials: ['Сырьё и материалы', 'Basic materials'],
	realestate: ['Недвижимость', 'Real estate'],
	utilities: ['Коммунальные услуги', 'Utilities']
};

const COUNTRIES: Record<string, string> = {
	'United States': 'США',
	Israel: 'Израиль',
	'United Kingdom': 'Великобритания',
	Ireland: 'Ирландия',
	Netherlands: 'Нидерланды',
	Germany: 'Германия',
	France: 'Франция',
	Switzerland: 'Швейцария',
	Canada: 'Канада',
	China: 'Китай',
	Taiwan: 'Тайвань',
	Japan: 'Япония',
	'South Korea': 'Южная Корея',
	India: 'Индия',
	Bermuda: 'Бермуды',
	Luxembourg: 'Люксембург',
	Denmark: 'Дания',
	Sweden: 'Швеция',
	Cyprus: 'Кипр',
	Poland: 'Польша',
	Spain: 'Испания',
	'Hong Kong': 'Гонконг',
	Peru: 'Перу',
	Brazil: 'Бразилия',
	Mexico: 'Мексика',
	Australia: 'Австралия',
	Italy: 'Италия',
	Turkey: 'Турция',
	'South Africa': 'ЮАР',
	Chile: 'Чили',
	Argentina: 'Аргентина',
	Vietnam: 'Вьетнам',
	Thailand: 'Таиланд',
	Indonesia: 'Индонезия',
	Singapore: 'Сингапур',
	Malaysia: 'Малайзия',
	'Saudi Arabia': 'Саудовская Аравия',
	Greece: 'Греция',
	Austria: 'Австрия',
	Belgium: 'Бельгия',
	Norway: 'Норвегия',
	Finland: 'Финляндия',
	'New Zealand': 'Новая Зеландия',
	Philippines: 'Филиппины',
	Qatar: 'Катар',
	'United Arab Emirates': 'ОАЭ',
	Kuwait: 'Кувейт',
	Colombia: 'Колумбия'
};

/** owner 28.11.2026: a country's part of the world — the «Регионы» measure */
const REGION: Record<string, string> = {
	'United States': 'na', Canada: 'na', Bermuda: 'na',
	Israel: 'il',
	'United Kingdom': 'eu', Ireland: 'eu', Netherlands: 'eu', Germany: 'eu', France: 'eu', Switzerland: 'eu', Luxembourg: 'eu', Denmark: 'eu', Sweden: 'eu', Cyprus: 'eu', Poland: 'eu', Spain: 'eu', Italy: 'eu', Greece: 'eu', Austria: 'eu', Belgium: 'eu', Norway: 'eu', Finland: 'eu', Portugal: 'eu',
	China: 'asia', Taiwan: 'asia', Japan: 'asia', 'South Korea': 'asia', India: 'asia', 'Hong Kong': 'asia', Vietnam: 'asia', Thailand: 'asia', Indonesia: 'asia', Singapore: 'asia', Malaysia: 'asia', Philippines: 'asia',
	Brazil: 'latam', Mexico: 'latam', Peru: 'latam', Chile: 'latam', Argentina: 'latam', Colombia: 'latam',
	Australia: 'oc', 'New Zealand': 'oc',
	'Saudi Arabia': 'me', Qatar: 'me', 'United Arab Emirates': 'me', Kuwait: 'me', Turkey: 'me',
	'South Africa': 'af'
};
const REGION_NAME: Record<string, [string, string]> = {
	na: ['Северная Америка', 'North America'],
	il: ['Израиль', 'Israel'],
	eu: ['Европа', 'Europe'],
	asia: ['Азия', 'Asia'],
	latam: ['Латинская Америка', 'Latin America'],
	oc: ['Австралия и Океания', 'Australia and Oceania'],
	me: ['Ближний Восток', 'Middle East'],
	af: ['Африка', 'Africa'],
	other: ['Другие страны', 'Other countries']
};

/** a security in a slice: what of its value is there, and whether it is a part of a fund split by its holdings */
export interface AllocMember {
	symbol: string;
	securityId?: number;
	value: number;
	/** the security's share that went into this slice (a fund split by sectors / countries); 1 — whole */
	part: number;
}

/** a country's name in the language (owner 28.11.2026: «Страны») */
export const countryName = (c: string, t: Tx) => t(COUNTRIES[c] ?? REGION_RU[c] ?? c, c);
const REGION_RU: Record<string, string> = {
	Europe: 'Европа',
	'Developed ex-US': 'Развитые без США',
	'Emerging markets': 'Развивающиеся рынки',
	'Asia ex-Japan': 'Азия без Японии',
	'Latin America': 'Латинская Америка',
	World: 'Весь мир',
	Portugal: 'Португалия'
};
export const REGION_LABEL = (r: string, t: Tx) => (r === 'region' ? t('Регионы', 'Regions') : t(...(REGION_NAME[r] ?? [r, r])));

export interface AllocRow {
	key: string;
	label: string;
	value: number;
	pct: number;
	/** grey rows: cash, «others», «no data» — not a category of their own */
	muted: boolean;
	members: AllocMember[];
}

/** at most this many coloured rows; the rest fold into «others» (the palette has eight hues) */
export const MAX_ROWS = 8;

export const isFund = (p: AllocPosition) => p.profile?.kind === 'etf' || (p.profile?.kind !== 'stock' && p.profile?.type === 'etf');

export function allocate(metric: Metric, positions: AllocPosition[], cash: number, t: Tx, scope: Scope = 'all'): { rows: AllocRow[]; total: number; unknown: number } {
	// owner 28.11.2026: a measure over the stocks only or the funds only — the cash is then out of it
	const scoped = SCOPED.includes(metric) && scope !== 'all';
	const held = positions.filter((p) => p.valuePc > 0 && (!scoped || (scope === 'etf') === isFund(p)));
	const cashV = scoped ? 0 : Math.max(0, cash);
	const total = held.reduce((n, p) => n + p.valuePc, 0) + cashV;
	const sums = new Map<string, { label: string; value: number; muted: boolean; members: Map<string, AllocMember> }>();
	let cur: AllocPosition | null = null;
	const add = (key: string, label: string, value: number, muted = false) => {
		if (!(value > 0)) return;
		const e = sums.get(key) ?? { label, value: 0, muted, members: new Map() };
		e.value += value;
		if (cur) {
			const m = e.members.get(cur.symbol) ?? { symbol: cur.symbol, securityId: cur.securityId, value: 0, part: 0 };
			m.value += value;
			m.part = cur.valuePc > 0 ? m.value / cur.valuePc : 1;
			e.members.set(cur.symbol, m);
		}
		sums.set(key, e);
	};
	const NO = ['none', t('Нет данных', 'No data')] as const;
	const FUNDS = ['funds', t('Фонды (ETF)', 'Funds (ETF)')] as const;
	let unknown = 0;
	/** a fund split by its weights; what they leave out — «прочее в фондах» */
	const spread = (value: number, w: Record<string, number>, key: (k: string) => [string, string]) => {
		let used = 0;
		for (const [k, x] of Object.entries(w)) {
			add(...key(k), value * x);
			used += x;
		}
		if (used < 0.995) add('other', t('Прочее в фондах', 'Other in funds'), value * (1 - used), true);
	};

	for (const p of held) {
		const pr = p.profile;
		cur = p;
		switch (metric) {
			case 'security':
				add(`s:${p.symbol}`, p.symbol, p.valuePc);
				break;
			case 'sector': {
				if (isFund(p)) {
					const w = pr?.sectorWeights;
					if (!w) {
						add('funds', t('Фонды без разбивки', 'Funds without a breakdown'), p.valuePc, true);
						if (!pr?.kind) unknown++;
						break;
					}
					let used = 0;
					for (const [k, x] of Object.entries(w)) {
						add(k, sectorName(k, t), p.valuePc * x);
						used += x;
					}
					// what the fund holds outside shares (cash, bonds) or leaves unlabelled
					if (used < 0.995) add('other', t('Прочее в фондах', 'Other in funds'), p.valuePc * (1 - used), true);
				} else if (pr?.sector) add(pr.sector, sectorName(pr.sector, t), p.valuePc);
				else {
					add(...NO, p.valuePc, true);
					unknown++;
				}
				break;
			}
			case 'industry':
				if (isFund(p) && pr?.industryWeights) spread(p.valuePc, pr.industryWeights, (k) => [`i:${k}`, k]);
				else if (isFund(p)) add(...FUNDS, p.valuePc, true);
				else if (pr?.industry) add(`i:${pr.industry}`, pr.industry, p.valuePc);
				else {
					add(...NO, p.valuePc, true);
					unknown++;
				}
				break;
			case 'country':
				if (isFund(p) && pr?.countryWeights) spread(p.valuePc, pr.countryWeights, (k) => [`c:${k}`, t(COUNTRIES[k] ?? k, k)]);
				else if (isFund(p)) add(...FUNDS, p.valuePc, true);
				else if (pr?.country) add(`c:${pr.country}`, t(COUNTRIES[pr.country] ?? pr.country, pr.country), p.valuePc);
				else {
					add(...NO, p.valuePc, true);
					unknown++;
				}
				break;
			case 'region': {
				const reg = (c: string): [string, string] => {
					const r = REGION[c] ?? 'other';
					return [`r:${r}`, t(...REGION_NAME[r])];
				};
				if (isFund(p) && pr?.countryWeights) spread(p.valuePc, pr.countryWeights, reg);
				else if (isFund(p)) add('funds', t('Фонды без разбивки', 'Funds without a breakdown'), p.valuePc, true);
				else if (pr?.country) add(...reg(pr.country), p.valuePc);
				else {
					add(...NO, p.valuePc, true);
					unknown++;
				}
				break;
			}
			case 'size': {
				const cap = pr?.capUsd ?? null;
				if (isFund(p)) add(...FUNDS, p.valuePc, true);
				else if (cap === null) {
					add(...NO, p.valuePc, true);
					unknown++;
				} else if (cap >= 200e9) add('mega', t('Сверхкрупные (от 200 млрд $)', 'Mega (over $200B)'), p.valuePc);
				else if (cap >= 10e9) add('large', t('Крупные (10–200 млрд $)', 'Large ($10–200B)'), p.valuePc);
				else if (cap >= 2e9) add('mid', t('Средние (2–10 млрд $)', 'Mid ($2–10B)'), p.valuePc);
				else add('small', t('Малые (до 2 млрд $)', 'Small (under $2B)'), p.valuePc);
				break;
			}
			case 'type':
				if (isFund(p)) add('etf', t('Фонды (ETF)', 'Funds (ETF)'), p.valuePc);
				else add('stock', t('Акции', 'Stocks'), p.valuePc);
				break;
			case 'market':
				if (p.currency === 'USD') add('us', t('США', 'US'), p.valuePc);
				else add('il', t('Израиль', 'Israel'), p.valuePc);
				break;
			case 'currency':
				if (p.currency === 'USD') add('usd', t('$ доллар', '$ dollar'), p.valuePc);
				else add('ils', t('₪ шекель', '₪ shekel'), p.valuePc);
				break;
			case 'result':
				if (p.unrealizedPc >= 0) add('up', t('В плюсе', 'In profit'), p.valuePc);
				else add('down', t('В минусе', 'At a loss'), p.valuePc);
				break;
		}
	}
	cur = null;
	// cash: its own grey row, but in «currencies» it is shekels or dollars like the rest
	if (metric !== 'currency') add('cash', t('Деньги', 'Cash'), cashV, true);
	else add('ils', t('₪ шекель', '₪ shekel'), cashV);

	const all = [...sums.entries()].map(([key, e]) => ({ key, label: e.label, value: e.value, muted: e.muted, members: [...e.members.values()].sort((a, b) => b.value - a.value) }));
	const coloured = all.filter((r) => !r.muted).sort((a, b) => b.value - a.value);
	const grey = all.filter((r) => r.muted).sort((a, b) => b.value - a.value);
	let top = coloured;
	if (coloured.length > MAX_ROWS) {
		top = coloured.slice(0, MAX_ROWS - 1);
		const folded = coloured.slice(MAX_ROWS - 1);
		const rest = folded.reduce((n, r) => n + r.value, 0);
		// «others» lists who is in it, merged by security
		const mem = new Map<string, AllocMember>();
		for (const r of folded) for (const m of r.members) {
			const x = mem.get(m.symbol) ?? { ...m, value: 0, part: 0 };
			x.value += m.value;
			x.part += m.part;
			mem.set(m.symbol, x);
		}
		grey.unshift({ key: 'others', label: t('Остальные', 'Others'), value: rest, muted: true, members: [...mem.values()].sort((a, b) => b.value - a.value) });
	}
	const rows = [...top, ...grey].map((r) => ({ ...r, pct: total > 0 ? (r.value / total) * 100 : 0 }));
	return { rows, total, unknown };
}

export const sectorName = (k: string, t: Tx) => {
	const n = SECTORS[k];
	return n ? t(n[0], n[1]) : k.replace(/_/g, ' ');
};
