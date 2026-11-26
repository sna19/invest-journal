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
	valuePc: number;
	currency: string;
	unrealizedPc: number;
	profile: AllocProfile | null;
}

export type Metric = 'security' | 'sector' | 'industry' | 'country' | 'size' | 'type' | 'market' | 'currency' | 'result';
export const METRICS: Metric[] = ['security', 'sector', 'industry', 'country', 'size', 'type', 'market', 'currency', 'result'];

type Tx = (ru: string, en: string) => string;

export const METRIC_LABEL = (t: Tx): Record<Metric, string> => ({
	security: t('Бумаги', 'Securities'),
	sector: t('Секторы', 'Sectors'),
	industry: t('Отрасли', 'Industries'),
	country: t('Страны', 'Countries'),
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

export interface AllocRow {
	key: string;
	label: string;
	value: number;
	pct: number;
	/** grey rows: cash, «others», «no data» — not a category of their own */
	muted: boolean;
}

/** at most this many coloured rows; the rest fold into «others» (the palette has eight hues) */
export const MAX_ROWS = 8;

export function allocate(metric: Metric, positions: AllocPosition[], cash: number, t: Tx): { rows: AllocRow[]; total: number; unknown: number } {
	const held = positions.filter((p) => p.valuePc > 0);
	const cashV = Math.max(0, cash);
	const total = held.reduce((n, p) => n + p.valuePc, 0) + cashV;
	const sums = new Map<string, { label: string; value: number; muted: boolean }>();
	const add = (key: string, label: string, value: number, muted = false) => {
		if (!(value > 0)) return;
		const e = sums.get(key) ?? { label, value: 0, muted };
		e.value += value;
		sums.set(key, e);
	};
	const NO = ['none', t('Нет данных', 'No data')] as const;
	const FUNDS = ['funds', t('Фонды (ETF)', 'Funds (ETF)')] as const;
	const isFund = (p: AllocPosition) => p.profile?.kind === 'etf' || (p.profile?.kind !== 'stock' && p.profile?.type === 'etf');
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
	// cash: its own grey row, but in «currencies» it is shekels or dollars like the rest
	if (metric !== 'currency') add('cash', t('Деньги', 'Cash'), cashV, true);
	else add('ils', t('₪ шекель', '₪ shekel'), cashV);

	const all = [...sums.entries()].map(([key, e]) => ({ key, ...e }));
	const coloured = all.filter((r) => !r.muted).sort((a, b) => b.value - a.value);
	const grey = all.filter((r) => r.muted).sort((a, b) => b.value - a.value);
	let top = coloured;
	if (coloured.length > MAX_ROWS) {
		top = coloured.slice(0, MAX_ROWS - 1);
		const rest = coloured.slice(MAX_ROWS - 1).reduce((n, r) => n + r.value, 0);
		grey.unshift({ key: 'others', label: t('Остальные', 'Others'), value: rest, muted: true });
	}
	const rows = [...top, ...grey].map((r) => ({ ...r, pct: total > 0 ? (r.value / total) * 100 : 0 }));
	return { rows, total, unknown };
}

export const sectorName = (k: string, t: Tx) => {
	const n = SECTORS[k];
	return n ? t(n[0], n[1]) : k.replace(/_/g, ' ');
};
