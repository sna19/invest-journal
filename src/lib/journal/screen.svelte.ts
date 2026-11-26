import { tx } from '../i18n.js';

/**
 * T-032 Д-11: what the open screen is about — «+» writes an entry linked to it. A screen sets its links while it is
 * shown (a portfolio, a hypothesis, a model run); the security's card and the sector page are read from the address.
 */
export interface ScreenLink {
	type: string;
	id: string;
	label: string;
}
export const screen = $state<{ links: ScreenLink[] }>({ links: [] });

export function setScreenLinks(links: ScreenLink[]) {
	screen.links = links;
	return () => {
		if (screen.links === links) screen.links = [];
	};
}

export const KIND_LABEL: Record<string, [string, string]> = {
	note: ['Заметка', 'Note'],
	observation: ['Наблюдение', 'Observation'],
	decision: ['Решение', 'Decision'],
	conclusion: ['Вывод', 'Conclusion']
};

export const GROUP_LABEL: Record<string, [string, string]> = {
	stocks: ['Акции', 'Stocks'],
	etf: ['ETF', 'ETF'],
	indices: ['Индексы', 'Indices'],
	sectors: ['Секторы', 'Sectors'],
	portfolios: ['Портфели', 'Portfolios'],
	candidates: ['Кандидаты', 'Candidates'],
	strategies: ['Стратегии', 'Strategies'],
	hypotheses: ['Гипотезы', 'Hypotheses'],
	decisions: ['Решения', 'Decisions'],
	risks: ['Риски', 'Risks'],
	comparisons: ['Сравнения', 'Comparisons'],
	personal: ['Мои теги', 'My tags']
};

/** where a link leads */
export function hrefOf(type: string, id: string): string | null {
	if (type === 'security') return `/security/${id}`;
	if (type === 'position') return `/position/${id}`;
	if (type === 'portfolio') return `/portfolio?p=${id}`;
	if (type === 'sector') return `/sector?sector=${encodeURIComponent(id)}`;
	if (type === 'industry') return `/sector?industry=${encodeURIComponent(id)}`;
	if (type === 'hypothesis') return `/?open=${id}`;
	if (type === 'source') return `/sources/${id}`;
	if (type === 'model_run') return '/model';
	return null;
}

export const kindText = (k: string) => tx(...(KIND_LABEL[k] ?? [k, k]));

/** the composer of an entry — one for the whole app, opened by «+», «Ответить» or a screen's «Записать» */
/** T-032 11в: a snapshot the entry will keep — its numbers frozen as the screen showed them */
export interface SnapshotDraft {
	type: 'chart' | 'compare' | 'candidates' | 'portfolio' | 'scenario' | 'stats' | 'path' | 'photo';
	params: Record<string, unknown>;
	data: Record<string, unknown>;
	photoPath?: string;
}
export const composer = $state<{ open: boolean; links: ScreenLink[]; parentId: number | null; kind: string | null; snapshots: SnapshotDraft[] }>({ open: false, links: [], parentId: null, kind: null, snapshots: [] });
/** grows on every saved entry: the feeds on the screen reload */
export const journalVersion = $state({ n: 0 });

export function openComposer(o: { links?: ScreenLink[]; parentId?: number | null; kind?: string | null; snapshot?: SnapshotDraft } = {}) {
	composer.snapshots = o.snapshot ? [o.snapshot] : [];
	composer.links = o.links ?? screen.links;
	composer.parentId = o.parentId ?? null;
	composer.kind = o.kind ?? null;
	composer.open = true;
}
