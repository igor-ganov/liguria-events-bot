import type { Lang } from '../domain/event.ts';

/**
 * What the bot and the channel say about themselves.
 *
 * Kept here rather than typed into BotFather once and forgotten: this is the
 * first thing anybody reads before deciding whether to press Start, and the
 * only copy of it should be one a deploy can re-apply.
 *
 * Localisation data, as in `i18n.ts` — content, not code.
 */
export const BOT_NAME = 'Dove Go — eventi in Italia';

/** Under the name, on the profile card. Telegram allows 120 characters. */
export const SHORT_DESCRIPTION: Readonly<Record<Lang, string>> = {
  en: "What's on in Italy: concerts, exhibitions, theatre and festivals. Search by city and date, save what you like.",
  it: 'Cosa fare in Italia: concerti, mostre, teatro e sagre. Cerca per città e data, salva quello che ti piace.',
  ru: 'Что происходит в Италии: концерты, выставки, театр, фестивали. Поиск по городу и дате.',
};

/** The empty-chat screen, read before pressing Start. Up to 512 characters. */
export const DESCRIPTION: Readonly<Record<Lang, string>> = {
  en: "Events across Italy, collected every hour from the places that announce them.\n\nAsk what's on in your city today, this weekend or on any date. Filter by category, keep the ones you want, and get a reminder before they start.\n\nEverything is also on dovego.it",
  it: "Eventi in tutta Italia, raccolti ogni ora dai siti che li annunciano.\n\nChiedi cosa c'è nella tua città oggi, questo weekend o in una data qualsiasi. Filtra per categoria, salva quelli che ti interessano e ricevi un promemoria prima che inizino.\n\nTutto anche su dovego.it",
  ru: 'События по всей Италии, собираются каждый час с сайтов, которые их публикуют.\n\nСпросите, что происходит в вашем городе сегодня, в выходные или в любую дату. Фильтр по категориям, избранное и напоминание перед началом.\n\nВсё это есть и на dovego.it',
};

/** The channel's own description, on its profile card. */
export const CHANNEL_DESCRIPTION =
  "Cosa fare in Italia, ogni giorno. Concerti, mostre, teatro, sagre e mercatini — raccolti automaticamente e pubblicati in un digest quotidiano.\n\nCerca per città e data su dovego.it";
