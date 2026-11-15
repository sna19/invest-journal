/**
 * Spec sections 2, 6 and 17 — the hypothesis form: field rules shared by the form (errors as you type) and the
 * server (the same rules again, the client is never trusted).
 */

export const SIGNAL_TYPES = [
	{ id: 'recommendation', label: 'Рекомендация', hint: 'Источник прямо говорит «покупать» или «продавать»' },
	{ id: 'target', label: 'Целевая цена', hint: 'Названа цена, обычно со сроком' },
	{ id: 'opinion', label: 'Мнение', hint: 'Ясная позиция по бумаге без прямого совета' },
	{ id: 'news', label: 'Новость', hint: 'Факт без оценки — направление толкуете вы' }
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number]['id'];

/** Horizon choices; «none» — the article names no term: 3 months, marked «по умолчанию» (section 17). */
export const HORIZONS = [
	{ id: 'none', label: 'Не назван', months: 3 },
	{ id: '1', label: '1 мес', months: 1 },
	{ id: '3', label: '3 мес', months: 3 },
	{ id: '6', label: '6 мес', months: 6 },
	{ id: '12', label: '12 мес', months: 12 },
	{ id: 'date', label: 'Дата', months: 0 }
] as const;
export type HorizonChoice = (typeof HORIZONS)[number]['id'];
export const DEFAULT_MONTHS = 3;

export interface HypothesisInput {
	url?: string | null;
	sourceId?: number | null;
	/** reuse an article saved a moment ago («Сохранить и добавить ещё по этой статье») */
	articleId?: number | null;
	articleTitle?: string | null;
	author?: string | null;
	securityId?: number | null;
	signalType?: string | null;
	direction?: string | null;
	directionSource?: string | null;
	thesis?: string | null;
	confidencePct?: number | string | null;
	invalidation?: string | null;
	mode?: string | null;
	horizon?: string | null;
	/** with horizon «date» */
	horizonDate?: string | null;
	targetPrice?: number | string | null;
	amount?: number | string | null;
	tags?: string | null;
}

export type Errors = Partial<Record<keyof HypothesisInput | 'form', string>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The date in Israel: a hypothesis is written «in the day of reading» there (section 17). */
export function israelDate(d = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
}

/** 2026-11-30 + 3 months = 2027-02-28: the end of a shorter month is clamped. */
export function addMonths(date: string, months: number): string {
	const [y, m, d] = date.split('-').map(Number);
	const total = y * 12 + (m - 1) + months;
	const ny = Math.floor(total / 12);
	const nm = (total % 12) + 1;
	const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
	return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** «news» always has the direction of the owner's reading, not of the article (section 17). */
export function directionSourceFor(signalType: string | null | undefined, chosen: string | null | undefined): 'article' | 'mine' {
	if (signalType === 'news') return 'mine';
	return chosen === 'mine' ? 'mine' : 'article';
}

/** Horizon date and its source from the form's choice. */
export function horizonFor(choice: string | null | undefined, date: string | null | undefined, today: string) {
	const h = HORIZONS.find((x) => x.id === choice) ?? HORIZONS[0];
	if (h.id === 'date') return { horizonDate: date ?? '', horizonSource: 'article' as const };
	return { horizonDate: addMonths(today, h.months), horizonSource: h.id === 'none' ? ('default' as const) : ('article' as const) };
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.')));

export function normalizeUrl(raw: string | null | undefined): string | null {
	const s = raw?.trim();
	if (!s) return null;
	try {
		const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
		return u.toString();
	} catch {
		return null;
	}
}

/** Field errors. `partial` — while typing: only fields that already have something are judged. */
export function validate(i: HypothesisInput, today: string, partial = false): Errors {
	const e: Errors = {};
	const need = (k: keyof HypothesisInput, v: unknown, msg: string) => {
		if ((v === null || v === undefined || v === '') && !partial) e[k] = msg;
	};
	if (i.url && !normalizeUrl(i.url)) e.url = 'Это не похоже на ссылку';
	need('sourceId', i.sourceId, 'Выберите источник');
	need('securityId', i.securityId, 'Выберите бумагу из списка');
	need('signalType', i.signalType, 'Выберите тип сигнала');
	if (i.signalType && !SIGNAL_TYPES.some((t) => t.id === i.signalType)) e.signalType = 'Неизвестный тип сигнала';
	need('direction', i.direction, 'Рост или падение?');
	if (i.direction && i.direction !== 'long' && i.direction !== 'short') e.direction = 'Рост или падение?';
	const thesis = i.thesis?.trim() ?? '';
	need('thesis', thesis, 'Одна фраза: что утверждает источник');
	if (thesis.length > 300) e.thesis = 'Тезис — одной фразой, до 300 знаков';
	const inv = i.invalidation?.trim() ?? '';
	need('invalidation', inv, 'Когда вы признаете, что гипотеза не сработала?');
	if (inv.length > 300) e.invalidation = 'До 300 знаков';
	const c = num(i.confidencePct);
	if (c !== null && (!Number.isInteger(c) || c < 1 || c > 99)) e.confidencePct = 'Целое число от 1 до 99 или пусто';
	if (i.mode && i.mode !== 'sim' && i.mode !== 'real') e.mode = 'Симуляция или реальные деньги';
	if (i.horizon === 'date') {
		const d = i.horizonDate ?? '';
		if (!DATE.test(d)) {
			if (!partial || d) e.horizonDate = 'Укажите дату';
		} else if (d <= today) e.horizonDate = 'Дата должна быть позже сегодняшней';
		else if (d > addMonths(today, 60)) e.horizonDate = 'Не дальше пяти лет';
	}
	const tp = num(i.targetPrice);
	if (tp !== null && (!Number.isFinite(tp) || tp <= 0)) e.targetPrice = 'Положительное число';
	const am = num(i.amount);
	if (am !== null && (!Number.isFinite(am) || am <= 0)) e.amount = 'Положительное число';
	if ((i.tags?.length ?? 0) > 200) e.tags = 'До 200 знаков';
	return e;
}

export const toNumber = num;

/** «рост, Barron's» → [«рост», «barron's»]: lower case, no repeats. */
export function parseTags(raw: string | null | undefined): string[] {
	return [...new Set((raw ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
