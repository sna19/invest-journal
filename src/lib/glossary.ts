/**
 * The glossary of the ratios and terms (owner 27.11.2026: «словарь всех аббревиатур по алфавиту, к какой группе
 * относится, что показывает и как мне пользоваться»). One source for three places: the tap on a row of «Показатели»
 * (a short reminder under it), the searchable list at the bottom of the block, and the help topic «Показатели»
 * (the server appends the list to it).
 */
export type Pair = [ru: string, en: string];
export interface Term {
	id: string;
	term: Pair;
	/** other spellings to find it by (both languages, lower case not needed) */
	aka: string;
	group: Pair;
	what: Pair;
	how: Pair;
	/** where it is in the app, if not in «Показатели» */
	where?: Pair;
}

const G = {
	quality: ['Качество', 'Quality'] as Pair,
	growth: ['Рост', 'Growth'] as Pair,
	valuation: ['Оценка', 'Valuation'] as Pair,
	risk: ['Риск', 'Risk'] as Pair,
	income: ['Доход и владельцы', 'Income and holders'] as Pair,
	analysts: ['Аналитики', 'Analysts'] as Pair,
	fund: ['Фонд', 'Fund'] as Pair,
	chart: ['График', 'Chart'] as Pair,
	trade: ['Сделка', 'Trade'] as Pair,
	score: ['Квант-оценка', 'Quant score'] as Pair
};

export const TERMS: Term[] = [
	{
		id: 'atr',
		term: ['ATR (дневной размах)', 'ATR (daily range)'],
		aka: 'average true range размах atr14',
		group: G.risk,
		what: ['Средний размах цены за день за последние 14 дней, в % от цены: насколько бумага обычно ходит за день.', 'The price\'s average range of a day over the last 14 days, in % of the price: how far the share usually moves in a day.'],
		how: ['1–2% — спокойная, 3–5% — живая, больше 5% — резкая. Стоп ставят не ближе 2–3 ATR от цены, иначе его выбьет обычный шум; чем больше ATR, тем меньше штук в позиции при том же риске.', '1–2% calm, 3–5% lively, over 5% sharp. A stop goes no closer than 2–3 ATR from the price, or ordinary noise hits it; the bigger the ATR, the fewer shares for the same risk.']
	},
	{
		id: 'beta',
		term: ['Бета', 'Beta'],
		aka: 'beta β бета 3 года',
		group: G.risk,
		what: ['Во сколько раз бумага в среднем усиливает движение рынка (S&P 500). Бета 1,5: рынок −10% → бумага около −15%.', 'How many times the share amplifies the market\'s move (S&P 500) on average. Beta 1.5: market −10% → the share about −15%.'],
		how: ['Меньше 0,8 — тише рынка, 0,8–1,2 — как рынок, больше 1,5 — усилитель. Бета говорит о связи с рынком, а не о собственных колебаниях: у бумаги с бетой 0,5 могут быть огромные свои скачки — смотри и на волатильность.', 'Under 0.8 quieter than the market, 0.8–1.2 like it, over 1.5 an amplifier. Beta is the link to the market, not the share\'s own swings: a beta-0.5 share can still jump wildly on its own — look at the volatility too.']
	},
	{
		id: 'corr',
		term: ['Связь (корреляция)', 'Link (correlation)'],
		aka: 'correlation корреляция связь',
		group: G.risk,
		what: ['Насколько дневные движения бумаги совпадают с эталоном (сектор, индекс) за год: от −1 до 1.', 'How closely the share\'s daily moves match a reference (a sector, an index) over a year: from −1 to 1.'],
		how: ['Больше 0,7 — бумага повторяет эталон: купить её — почти то же, что купить сектор. Меньше 0,3 — идёт своим путём. Две позиции с высокой связью между собой — один риск, а не два.', 'Over 0.7 the share repeats the reference: buying it is almost buying the sector. Under 0.3 it goes its own way. Two positions highly linked to each other are one risk, not two.'],
		where: ['Карточка бумаги → «С чем сравнить» и кнопки под графиком', 'The security card → «Compare with» and the buttons under the chart']
	},
	{
		id: 'current_ratio',
		term: ['Текущая ликвидность (Current ratio)', 'Current ratio'],
		aka: 'current ratio ликвидность',
		group: G.quality,
		what: ['Оборотные активы / краткосрочные долги: хватит ли денег и того, что быстро станет деньгами, чтобы платить по счетам года.', 'Current assets / short-term debts: is there enough cash, and what soon turns into cash, to pay the year\'s bills.'],
		how: ['Больше 1,5 — спокойно, 1–1,5 — норма, меньше 1 — компания зависит от новых денег. У банков и страховщиков не применяется.', 'Over 1.5 calm, 1–1.5 normal, under 1 the company depends on new money. Not used for banks and insurers.']
	},
	{
		id: 'de',
		term: ['Долг / капитал (D/E)', 'Debt / equity (D/E)'],
		aka: 'debt to equity d/e долг',
		group: G.quality,
		what: ['Сколько долга приходится на рубль собственного капитала, в %.', 'How much debt per unit of own capital, in %.'],
		how: ['До 50% — мало, 50–150% — обычно, больше 200% — компания живёт в долг и чувствительна к ставкам. Сравнивай внутри сектора: у коммунальных компаний долг всегда выше. У банков не применяется.', 'Up to 50% little, 50–150% usual, over 200% the company lives on debt and feels the rates. Compare within the sector: utilities always carry more. Not used for banks.']
	},
	{
		id: 'div_yield',
		term: ['Дивидендная доходность', 'Dividend yield'],
		aka: 'dividend yield дивиденды',
		group: G.income,
		what: ['Дивиденды за год / цена акции.', 'The year\'s dividends / the share price.'],
		how: ['2–4% — обычно для зрелой компании. Очень высокая (больше 7–8%) часто значит, что цена упала и рынок ждёт урезания дивиденда — проверь долю прибыли на дивиденды.', '2–4% is usual for a mature company. Very high (over 7–8%) often means the price fell and the market expects a cut — check the payout ratio.']
	},
	{
		id: 'payout',
		term: ['Доля прибыли на дивиденды (Payout)', 'Payout ratio'],
		aka: 'payout ratio выплата',
		group: G.income,
		what: ['Какая часть прибыли уходит на дивиденды.', 'Which part of the profit goes to dividends.'],
		how: ['До 60% — дивиденд устойчив, 60–80% — на пределе, больше 100% — платят больше, чем зарабатывают: дивиденд под угрозой (кроме фондов недвижимости — у них своя норма).', 'Up to 60% the dividend is safe, 60–80% at the edge, over 100% they pay more than they earn: the dividend is at risk (except REITs — they have their own norm).']
	},
	{
		id: 'ebitda',
		term: ['EBITDA', 'EBITDA'],
		aka: 'ebitda',
		group: G.valuation,
		what: ['Прибыль до процентов, налогов и амортизации — сколько зарабатывает сам бизнес, без влияния долга и бухгалтерии.', 'Earnings before interest, taxes and depreciation — what the business itself earns, without the debt and the accounting.'],
		how: ['Сама по себе — для сравнения размеров; работает в паре EV/EBITDA.', 'By itself it compares sizes; it works in the pair EV/EBITDA.']
	},
	{
		id: 'eps',
		term: ['EPS (прибыль на акцию)', 'EPS (earnings per share)'],
		aka: 'eps earnings per share прибыль на акцию',
		group: G.growth,
		what: ['Чистая прибыль / число акций. Цена / EPS = P/E.', 'Net profit / number of shares. Price / EPS = P/E.'],
		how: ['Смотри не на число, а на рост из года в год и на то, превзошла ли компания прогноз в отчёте: после отчёта цена часто прыгает на 5–15%.', 'Look not at the number but at its growth year on year and whether the report beat the forecast: after a report the price often jumps 5–15%.']
	},
	{
		id: 'ev',
		term: ['EV (стоимость компании)', 'EV (enterprise value)'],
		aka: 'enterprise value ev',
		group: G.valuation,
		what: ['Капитализация + долг − деньги: сколько стоило бы купить компанию целиком вместе с её долгами.', 'Market cap + debt − cash: what buying the whole company with its debts would cost.'],
		how: ['Честнее капитализации для компаний с большим долгом; используется в EV/EBITDA.', 'Fairer than market cap for companies with big debt; used in EV/EBITDA.']
	},
	{
		id: 'ev_ebitda',
		term: ['EV/EBITDA', 'EV/EBITDA'],
		aka: 'ev ebitda',
		group: G.valuation,
		what: ['Сколько лет операционной прибыли стоит компания целиком, с долгом.', 'How many years of operating profit the whole company costs, debt included.'],
		how: ['Меньше 8 — дёшево, 8–15 — обычно, больше 20 — дорого (для быстрорастущих — норма). Лучший показатель для сырьевых, промышленных и закредитованных компаний. У банков не применяется.', 'Under 8 cheap, 8–15 usual, over 20 dear (normal for fast growers). The best one for commodity, industrial and indebted companies. Not used for banks.']
	},
	{
		id: 'iv',
		term: ['IV (подразумеваемая волатильность)', 'IV (implied volatility)'],
		aka: 'implied volatility iv опционы',
		group: G.risk,
		what: ['Волатильность, которую рынок ожидает в будущем, — вычисляется из цен опционов. Историческая волатильность — о прошлом, IV — ожидание.', 'The volatility the market expects ahead — derived from option prices. Historical volatility is the past, IV is the expectation.'],
		how: ['IV заметно выше исторической — рынок ждёт события (отчёт, решение суда): размер позиции меньше, стоп шире. В приложении IV нет — нет источника цен опционов; смотри у брокера в цепочке опционов.', 'IV well above the historical one — the market expects an event (a report, a ruling): a smaller position, a wider stop. The app has no IV — no source of option prices; see it at the broker in the option chain.'],
		where: ['Нет в приложении — у брокера', 'Not in the app — at the broker']
	},
	{
		id: 'insiders',
		term: ['У инсайдеров', 'Insiders'],
		aka: 'insiders инсайдеры',
		group: G.income,
		what: ['Доля акций у руководства и основателей.', 'The share of stock held by management and founders.'],
		how: ['5–20% — интересы совпадают с твоими. Покупки инсайдерами на свои деньги — сильный знак, продажи — слабый (их продают по многим причинам).', '5–20% — their interests match yours. Insiders buying with their own money is a strong sign, selling a weak one (they sell for many reasons).']
	},
	{
		id: 'institutions',
		term: ['У фондов', 'Institutions'],
		aka: 'institutions институциональные фонды',
		group: G.income,
		what: ['Доля акций у фондов, банков, пенсионных компаний.', 'The share of stock held by funds, banks, pension companies.'],
		how: ['60–80% — обычно для крупной американской компании. Очень мало — бумага малоизвестна; почти 100% — массовый выход фондов может обвалить цену.', '60–80% is usual for a big US company. Very little — the share is little known; almost 100% — funds leaving together can sink the price.']
	},
	{
		id: 'drawdown',
		term: ['Просадка', 'Drawdown'],
		aka: 'drawdown max drawdown просадка падение от максимума',
		group: G.risk,
		what: ['Насколько цена ниже своего максимума. «Сейчас» — от максимума года до последнего закрытия; «худшая» — самое глубокое падение за год от вершины до дна.', 'How far the price is under its high. «Now» — from the year\'s high to the last close; «worst» — the deepest fall within the year from a peak to a trough.'],
		how: ['Худшая просадка говорит, что придётся пережить, держа бумагу: если −40% для тебя невыносимо — бумага не для тебя или позиция слишком большая. Помни арифметику: после −50% нужно +100%, чтобы вернуться.', 'The worst drawdown tells what holding the share means living through: if −40% is unbearable for you, the share is not for you or the position is too big. Remember the arithmetic: after −50% it takes +100% to come back.']
	},
	{
		id: 'margin_gross',
		term: ['Валовая маржа', 'Gross margin'],
		aka: 'gross margin маржа',
		group: G.quality,
		what: ['(Выручка − себестоимость) / выручка: сколько остаётся с каждого доллара продаж после прямых затрат.', '(Revenue − cost of goods) / revenue: what stays from each dollar of sales after the direct costs.'],
		how: ['Больше 50% — у компании «ров» (бренд, технология), 20–40% — обычный бизнес, меньше 20% — торговля и сырьё. Падающая валовая маржа — первый признак давления конкурентов.', 'Over 50% the company has a moat (a brand, a technology), 20–40% an ordinary business, under 20% retail and commodities. A falling gross margin is the first sign of competitors\' pressure.']
	},
	{
		id: 'margin_net',
		term: ['Чистая маржа', 'Net margin'],
		aka: 'net margin profit margin маржа',
		group: G.quality,
		what: ['Чистая прибыль / выручка: сколько остаётся акционерам с каждого доллара продаж.', 'Net profit / revenue: what stays for shareholders from each dollar of sales.'],
		how: ['Больше 15% — сильный бизнес, 5–15% — обычный, меньше 5% или минус — тонкий лёд. Сравнивай внутри сектора.', 'Over 15% a strong business, 5–15% ordinary, under 5% or negative — thin ice. Compare within the sector.']
	},
	{
		id: 'margin_op',
		term: ['Операционная маржа', 'Operating margin'],
		aka: 'operating margin маржа',
		group: G.quality,
		what: ['Прибыль от основной деятельности / выручка — до процентов и налогов.', 'Profit from the core business / revenue — before interest and taxes.'],
		how: ['Честнее чистой: не зависит от разовых событий и налогов. Растёт год к году — бизнес масштабируется.', 'Fairer than the net one: it ignores one-offs and taxes. Rising year on year — the business scales.']
	},
	{
		id: 'oco',
		term: ['OCO (одна отменяет другую)', 'OCO (one cancels the other)'],
		aka: 'oco one cancels other',
		group: G.trade,
		what: ['Пара заявок у брокера — стоп ниже цены и тейк-профит выше: исполнилась одна — вторая отменяется.', 'A pair of orders at the broker — a stop under the price and a take-profit above it: one fills, the other is cancelled.'],
		how: ['Позволяет выставить и защиту, и цель сразу и не следить. Если брокер не умеет OCO — сначала стоп, цель держи в голове (сигнал «цель достигнута» напомнит).', 'Lets you place both the protection and the target at once and stop watching. If the broker has no OCO — the stop first, the target in mind (the signal «target reached» reminds you).'],
		where: ['Карточка позиции → «Защита»', 'The position card → «Protection»']
	},
	{
		id: 'pb',
		term: ['P/B (цена / балансовая стоимость)', 'P/B (price / book)'],
		aka: 'price to book pb p/b',
		group: G.valuation,
		what: ['Цена / собственный капитал по балансу на акцию.', 'Price / the balance-sheet equity per share.'],
		how: ['Главный показатель для банков и страховщиков: меньше 1 — дешевле балансовой стоимости, 1–2 — обычно. Для технологических компаний почти бесполезен: их ценность не на балансе.', 'The main one for banks and insurers: under 1 cheaper than book, 1–2 usual. Almost useless for tech: their value is not on the balance sheet.']
	},
	{
		id: 'pe',
		term: ['P/E (цена / прибыль)', 'P/E (price / earnings)'],
		aka: 'price earnings pe p/e',
		group: G.valuation,
		what: ['Цена / прибыль на акцию за последние 12 месяцев: сколько лет прибыли ты платишь.', 'Price / earnings per share over the last 12 months: how many years of profit you pay.'],
		how: ['У рынка США около 20. Меньше 12 — дёшево (или бизнес в беде), больше 30 — рынок ждёт быстрого роста. Сравнивай с сектором и с историей бумаги. Нет P/E — компания в убытке.', 'The US market is about 20. Under 12 cheap (or the business is in trouble), over 30 the market expects fast growth. Compare with the sector and the share\'s history. No P/E — the company loses money.']
	},
	{
		id: 'pe_fwd',
		term: ['P/E прогноз (Forward P/E)', 'Forward P/E'],
		aka: 'forward pe прогнозный',
		group: G.valuation,
		what: ['Цена / прибыль, которую аналитики ждут в следующие 12 месяцев.', 'Price / the profit analysts expect over the next 12 months.'],
		how: ['Ниже обычного P/E — прибыль ждут выше. Сильно ниже — проверь, не слишком ли оптимистичен прогноз.', 'Below the usual P/E — profit is expected to rise. Far below — check whether the forecast is too rosy.']
	},
	{
		id: 'peg',
		term: ['PEG', 'PEG'],
		aka: 'peg price earnings growth',
		group: G.valuation,
		what: ['P/E / ожидаемый рост прибыли в % в год: цена с поправкой на рост.', 'P/E / the expected profit growth in % a year: the price adjusted for growth.'],
		how: ['Около 1 — цена соответствует росту, меньше 1 — рост дёшев, больше 2 — дорого даже с учётом роста. Полезен для растущих компаний, где P/E высокий.', 'About 1 — the price matches the growth, under 1 — the growth is cheap, over 2 — dear even counting the growth. Useful for growers whose P/E is high.']
	},
	{
		id: 'ps',
		term: ['P/S (цена / выручка)', 'P/S (price / sales)'],
		aka: 'price to sales ps p/s',
		group: G.valuation,
		what: ['Капитализация / выручка за год.', 'Market cap / the year\'s revenue.'],
		how: ['Для компаний без прибыли. Меньше 2 — дёшево, 2–8 — обычно для технологий, больше 15 — рынок закладывает очень много будущего. Сравнивай при одинаковой марже.', 'For companies without profit. Under 2 cheap, 2–8 usual for tech, over 15 the market prices in a lot of future. Compare at similar margins.']
	},
	{
		id: 'r',
		term: ['R (риск сделки)', 'R (the trade\'s risk)'],
		aka: 'r риск 1r риска risk multiple',
		group: G.trade,
		what: ['Единица риска: расстояние от входа до стопа. Вход 100, стоп 92 → 1R = 8. «Цель 2 риска» = цель 116.', 'The unit of risk: the distance from the entry to the stop. Entry 100, stop 92 → 1R = 8. «Target 2 risks» = target 116.'],
		how: ['Цель меньше 1,5R — сделка не стоит риска; 2–3R — норма. При цели 2R достаточно быть правым в 4 сделках из 10, чтобы не терять.', 'A target under 1.5R is not worth the risk; 2–3R is normal. At a 2R target being right in 4 trades of 10 is enough not to lose.'],
		where: ['Сигналы → идеи недели; карточка позиции → «Защита»', 'Signals → the week\'s ideas; the position card → «Protection»']
	},
	{
		id: 'rating',
		term: ['Мнение аналитиков', 'Analysts\' opinion'],
		aka: 'recommendation rating рейтинг',
		group: G.analysts,
		what: ['Среднее мнение аналитиков: от «активно покупать» до «продавать».', 'The analysts\' average view: from «strong buy» to «sell».'],
		how: ['«Продавать» почти не говорят — «держать» часто значит «не нравится». Используй как проверку своего вывода, а не как причину покупки.', 'They almost never say «sell» — «hold» often means «don\'t like it». Use it to check your own conclusion, not as a reason to buy.']
	},
	{
		id: 'roa',
		term: ['ROA (рентабельность активов)', 'ROA (return on assets)'],
		aka: 'return on assets roa',
		group: G.quality,
		what: ['Прибыль / все активы: сколько бизнес зарабатывает на каждый доллар имущества.', 'Profit / all assets: what the business earns per dollar of property.'],
		how: ['Больше 8% — хорошо, у банков норма 1–1,5%. Честнее ROE, когда у компании большой долг.', 'Over 8% is good; for banks 1–1.5% is normal. Fairer than ROE when the company carries big debt.']
	},
	{
		id: 'roe',
		term: ['ROE (рентабельность капитала)', 'ROE (return on equity)'],
		aka: 'return on equity roe',
		group: G.quality,
		what: ['Прибыль / собственный капитал: сколько компания зарабатывает на деньги акционеров.', 'Profit / equity: what the company earns on the shareholders\' money.'],
		how: ['Больше 15% — сильный бизнес, 8–15% — обычный. Очень высокий ROE при большом долге — заслуга долга, а не бизнеса: смотри вместе с D/E.', 'Over 15% a strong business, 8–15% ordinary. A very high ROE with big debt comes from the debt, not the business: look with D/E.']
	},
	{
		id: 'growth_rev',
		term: ['Рост выручки', 'Revenue growth'],
		aka: 'revenue growth выручка',
		group: G.growth,
		what: ['Выручка последнего квартала против того же квартала год назад.', 'The last quarter\'s revenue against the same quarter a year ago.'],
		how: ['Больше 15% — быстрый рост, 5–15% — нормальный, меньше 0 — бизнес сжимается. Рост выручки без роста прибыли — тревожный знак.', 'Over 15% fast, 5–15% normal, under 0 the business shrinks. Revenue growing without profit growing is a warning.']
	},
	{
		id: 'growth_eps',
		term: ['Рост прибыли', 'Earnings growth'],
		aka: 'earnings growth прибыль',
		group: G.growth,
		what: ['Прибыль последнего квартала против того же квартала год назад.', 'The last quarter\'s profit against the same quarter a year ago.'],
		how: ['Устойчивый рост прибыли быстрее выручки — маржа растёт, бизнес масштабируется. Скачок в сотни процентов часто разовый — сверь с выручкой.', 'Profit steadily growing faster than revenue — the margin rises, the business scales. A jump of hundreds of percent is often one-off — check it against revenue.']
	},
	{
		id: 'score',
		term: ['Квант-оценка', 'Quant score'],
		aka: 'quant score квант оценка точка',
		group: G.score,
		what: ['Одна оценка из четырёх факторов — качество, рост, оценка, моментум — каждый в процентилях среди акций своего сектора. Зелёная ≥ 65, жёлтая 35–65, красная < 35.', 'One score from four factors — quality, growth, valuation, momentum — each in percentiles among the shares of its sector. Green ≥ 65, yellow 35–65, red < 35.'],
		how: ['Фильтр, а не приказ: зелёная — бумага сильнее соседей по сектору, стоит изучить. Цена ниже SMA200 не даёт подняться выше жёлтой. Тап по точке — разбор по метрикам.', 'A filter, not an order: green — the share is stronger than its sector peers, worth a look. A price under its SMA200 keeps it no higher than yellow. A tap on the dot — the breakdown by metrics.'],
		where: ['Точка рядом с тикером; карточка бумаги', 'The dot next to a ticker; the security card']
	},
	{
		id: 'short',
		term: ['Шорт, % акций (Short float)', 'Short, % of float'],
		aka: 'short float шорт',
		group: G.risk,
		what: ['Какая доля свободно торгуемых акций продана в шорт — ставки на падение.', 'Which part of the freely traded shares is sold short — bets on a fall.'],
		how: ['До 5% — обычно, 10–20% — многие видят проблему (разберись, какую), больше 20% — бумага может резко взлететь, когда шортисты закрываются, и так же резко упасть.', 'Up to 5% usual, 10–20% many see a problem (find out which), over 20% the share can soar when the shorts cover, and fall as hard.']
	},
	{
		id: 'sma',
		term: ['SMA / EMA (скользящие средние)', 'SMA / EMA (moving averages)'],
		aka: 'sma ema moving average скользящая средняя 200 50 20',
		group: G.chart,
		what: ['Средняя цена закрытия за N дней (SMA — простая, EMA — с большим весом последних дней). SMA200 — долгий тренд, SMA50 — средний, SMA20 — короткий.', 'The average close over N days (SMA — simple, EMA — more weight on recent days). SMA200 — the long trend, SMA50 — the middle one, SMA20 — the short one.'],
		how: ['Цена выше SMA200 — тренд вверх, покупать по тренду безопаснее; ниже — осторожно. Пересечение SMA200 вниз — сигнал пересмотреть позицию. Средние запаздывают: это подтверждение, а не прогноз.', 'Price above its SMA200 — an uptrend, buying with it is safer; under — careful. Crossing down through the SMA200 — review the position. Averages lag: a confirmation, not a forecast.'],
		where: ['Кнопки под графиком', 'The buttons under the chart']
	},
	{
		id: 'stop',
		term: ['Стоп-лосс / стоп-лимит', 'Stop-loss / stop-limit'],
		aka: 'stop loss limit стоп',
		group: G.trade,
		what: ['Заявка у брокера продать, если цена упадёт до уровня стопа. Стоп-лосс продаёт по любой цене, стоп-лимит — не ниже лимита (может не исполниться при обвале).', 'An order at the broker to sell if the price falls to the stop. A stop-loss sells at any price, a stop-limit not under its limit (may not fill in a crash).'],
		how: ['Ставь там, где тезис становится неверным (за уровнем или недавним минимумом, не ближе 2–3 ATR), сразу после покупки. Не отодвигай вниз, когда цена подходит.', 'Place it where the thesis turns wrong (beyond a level or a recent low, no closer than 2–3 ATR), right after buying. Never move it down when the price comes near.'],
		where: ['Карточка позиции → «Защита»', 'The position card → «Protection»']
	},
	{
		id: 'target_analysts',
		term: ['Цель аналитиков', 'Analysts\' target'],
		aka: 'price target цель',
		group: G.analysts,
		what: ['Средняя цена, которую аналитики ждут через 12 месяцев, и разброс от самой низкой до самой высокой.', 'The average price analysts expect in 12 months, and the range from the lowest to the highest.'],
		how: ['Широкий разброс — неопределённость. Цели догоняют цену, а не опережают: после роста их повышают. Это не твоя цель сделки.', 'A wide range is uncertainty. Targets follow the price rather than lead it: they get raised after a rise. Not your trade\'s target.']
	},
	{
		id: 'tp',
		term: ['Тейк-профит', 'Take-profit'],
		aka: 'take profit цель',
		group: G.trade,
		what: ['Заявка продать, когда цена дойдёт до цели.', 'An order to sell when the price reaches the target.'],
		how: ['Ставь на 2–3R, но не выше ближнего сопротивления (максимум 52 недель). Когда советуется трейлинг-стоп, цель не ставят — прибыль не ограничивают.', 'Place it at 2–3R, but not above the near resistance (the 52-week high). When a trailing stop is advised, no target — the profit is not capped.'],
		where: ['Карточка позиции → «Защита»', 'The position card → «Protection»']
	},
	{
		id: 'trail',
		term: ['Трейлинг-стоп', 'Trailing stop'],
		aka: 'trailing stop трейлинг',
		group: G.trade,
		what: ['Стоп, который идёт за ценой вверх на заданном расстоянии (в %) и никогда не опускается.', 'A stop that follows the price up at a set distance (in %) and never goes down.'],
		how: ['Для бумаг в сильном тренде: защищает прибыль, не ограничивая её. Расстояние — около 3 ATR, иначе выбьет шумом.', 'For shares in a strong trend: it guards the profit without capping it. The distance about 3 ATR, or noise knocks it out.'],
		where: ['Карточка позиции → «Защита»', 'The position card → «Protection»']
	},
	{
		id: 'vol',
		term: ['Волатильность (колебания, % в год)', 'Volatility (swings, % a year)'],
		aka: 'volatility волатильность колебания historical hv',
		group: G.risk,
		what: ['Историческая волатильность: разброс дневных изменений цены, приведённый к году. За год и за 3 месяца.', 'Historical volatility: the spread of daily price changes, scaled to a year. Over a year and over 3 months.'],
		how: ['Индекс S&P 500 — около 15%, обычная крупная акция — 15–25%, нервная — 30–50%, больше 60% — очень резкая. За 3 месяца выше, чем за год, — бумага сейчас качается сильнее обычного. Чем выше — тем меньше позиция и шире стоп.', 'The S&P 500 about 15%, a usual big share 15–25%, a nervous one 30–50%, over 60% very sharp. 3 months above the year — the share swings harder than usual now. The higher, the smaller the position and the wider the stop.']
	},
	{
		id: 'ytd',
		term: ['С начала года (YTD)', 'Year to date (YTD)'],
		aka: 'ytd year to date',
		group: G.fund,
		what: ['Доходность фонда с 1 января.', 'The fund\'s return since January 1.'],
		how: ['Сравнивай с эталоном за тот же срок; короткий срок мало что говорит — смотри и «3 года, в год».', 'Compare with its benchmark over the same time; a short span says little — look at «3 years, a year» too.']
	},
	{
		id: 'aum',
		term: ['Активы фонда (AUM)', 'Fund assets (AUM)'],
		aka: 'aum total assets активы',
		group: G.fund,
		what: ['Сколько денег в фонде.', 'How much money is in the fund.'],
		how: ['Меньше 100 млн $ — фонд могут закрыть, а спред бывает широким; миллиарды — ликвидно и надёжно.', 'Under $100M the fund may be closed and the spread can be wide; billions — liquid and solid.']
	}
];

const collator = (lang: 'ru' | 'en') => new Intl.Collator(lang === 'en' ? 'en' : 'ru', { sensitivity: 'base' });
/** the terms in alphabetical order of the language */
export function sortedTerms(lang: 'ru' | 'en') {
	const i = lang === 'en' ? 1 : 0;
	const c = collator(lang);
	return [...TERMS].sort((a, b) => c.compare(a.term[i], b.term[i]));
}
export const termById = (id: string) => TERMS.find((t) => t.id === id) ?? null;

/** the glossary as Markdown, for the help topic «Показатели» */
export function glossaryMd(lang: 'ru' | 'en') {
	const i = lang === 'en' ? 1 : 0;
	const head = lang === 'en' ? '## Glossary, A to Z' : '## Словарь от А до Я';
	const lead = lang === 'en' ? 'A tap on a ratio\'s name in «Ratios» shows its line from here; the search above the list in the block finds it by any spelling.' : 'Тап по названию показателя в блоке «Показатели» показывает его строку отсюда; поиск над списком внизу блока находит по любому написанию.';
	const howL = lang === 'en' ? 'How to use' : 'Как пользоваться';
	const whereL = lang === 'en' ? 'Where' : 'Где';
	const lines = sortedTerms(lang).map((t) => `- **${t.term[i]}** · _${t.group[i]}_ — ${t.what[i]} **${howL}:** ${t.how[i]}${t.where ? ` _${whereL}: ${t.where[i]}._` : ''}`);
	return `${head}\n\n${lead}\n\n${lines.join('\n')}`;
}
