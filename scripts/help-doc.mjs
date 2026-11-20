// T-007: every help text in one file, docs/HELP.md, for rewriting the texts in one go (spec section 8).
// The texts themselves stay in help/<key>.md; after changing them run `npm run help:doc`.
// A test checks that docs/HELP.md matches the files.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where each topic's «?» stands — for whoever rewrites the texts. */
/** @type {Record<string, string>} */
export const WHERE = {
	'hypothesis.list': 'Экран «Гипотезы», заголовок',
	'hypothesis.signal_type': 'Форма «Новая гипотеза», поле «Тип сигнала»',
	'hypothesis.horizon': 'Форма, поле «Срок»',
	'hypothesis.default_horizon': 'Форма, подсказка «3 месяца по умолчанию»',
	'hypothesis.invalidation': 'Форма, поле «Я был неправ, если…»',
	'hypothesis.confidence': 'Форма, поле «Уверенность»',
	'hypothesis.mode': 'Форма, переключатель режима',
	'result.excess': 'Список гипотез (над строками) и карточка гипотезы, «Превышение»',
	'result.locked': 'Карточка гипотезы, «Зафиксировано при записи»',
	'result.prices': 'Список гипотез (строка «Цены на …») и карточка гипотезы',
	'source.usefulness': 'Экран «Источники», заголовок',
	'source.stats': 'Экран «Источники» («Как читать») и карточка источника',
	'source.threshold': 'Метка «мало данных» в таблице источников',
	'stats.screen': 'Экран «Статистика», заголовок',
	'stats.calibration': 'Статистика, блок «Калибровка»',
	'stats.own': 'Статистика, блок «Свои идеи и внешние источники»',
	'stats.mode': 'Статистика, блок «Симуляция и реальные деньги»',
	'stats.tags': 'Статистика, блок «По тегам»',
	'ticker.search': 'Поле выбора тикера в форме',
	'ticker.db': 'Экран «Тикеры», заголовок',
	'security.compare': 'Карточка бумаги, блок «С чем сравнить»',
	'portfolio.report': 'Экран «Отчёт» (Портфель → Отчёт), заголовок',
	'model.guide': 'Экран «Квартальная модель» (Ещё → Модель), заголовок',
	'model.variants': 'Экран модели, переключатель вариантов',
	'model.quarterly': 'Экран модели, заголовок «Кандидаты»',
	'security.leveraged': 'Карточка бумаги, раздел «ETF с плечом и на падение»',
	'model.costs': 'Экран модели: параметры «Издержки» и карточка «Издержки и оборот»',
	'model.score': 'Экран модели, вариант «В. Оценка»: «балл ≥ 2» и балл кандидата; карточка бумаги из модели',
	'model.placebo': 'Экран модели, строка «сигнал / неясно / похоже на случайность»',
	'model.chance': 'Экран модели, строка «случайно прошло бы»',
	'model.walk': 'Экран модели, блок «Проверка без подглядывания»',
	'model.param.k': 'Экран модели, параметр K',
	'model.param.years': 'Экран модели, параметр «Лет истории»',
	'model.param.count': 'Экран модели, параметр «Кандидатов»',
	'model.param.per_sector': 'Экран модели, параметр «Не больше из сектора»',
	'model.param.per_market': 'Экран модели, параметр «Не больше из рынка»',
	'model.param.min_price': 'Экран модели, параметр «Цена не ниже»',
	'model.param.min_turnover': 'Экран модели, параметр «Оборот в день»',
	'model.param.sort': 'Экран модели, параметр «Сортировка»',
	'model.param.market_cap': 'Экран модели, параметр «Капитализация»',
	'model.param.compare_with': 'Экран модели, параметр «Сравнивать» (вариант Б)',
	'account.users': 'Экран «Учётная запись» (Ещё → Учётная запись), заголовок',
	'portfolio.kinds': 'Экран «Портфель», заголовок',
	'portfolio.stages': 'Портфель, раздел «В портфеле»; карточка позиции',
	'portfolio.twr': 'Портфель, «Доходность»',
	'portfolio.fx': 'Портфель, строка курса; карточка позиции, «В шекелях»',
	'portfolio.source_auto': 'Портфель автоматический; карточка источника, «Автоматический портфель»',
	'portfolio.chart': 'Портфель, блок «Доходность» (график)',
	'portfolio.allocation': 'Портфель, блок «Распределение»',
	'security.chart': 'Карточка бумаги (график), заголовок',
	'portfolio.together': 'Экран «Всё вместе», заголовок',
	'portfolio.transfer': 'Портфель, окно «Перенос позиций»'
};

export function helpDoc(dir = join(root, 'help')) {
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.md'))
		.sort()
		.map((f) => {
			const text = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim();
			const [first, ...rest] = text.split('\n');
			return { key: f.slice(0, -3), title: first.replace(/^#+\s*/, '').trim(), body: rest.join('\n').trim() };
		});
	const parts = [
		'# Тексты справки — все темы',
		'',
		'Собрано из `help/*.md` командой `npm run help:doc`; править нужно сами файлы `help/<ключ>.md` (первая строка — заголовок), этот файл пересобирается.',
		'',
		`Тем: ${files.length}.`,
		'',
		...files.map((f) => `- \`${f.key}\` — ${f.title}`),
		''
	];
	for (const f of files) parts.push('---', '', `## \`${f.key}\` — ${f.title}`, '', `*Где:* ${WHERE[f.key] ?? '—'}`, '', f.body, '');
	return parts.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(join(root, 'docs', 'HELP.md'), helpDoc());
	console.log('docs/HELP.md written');
}
