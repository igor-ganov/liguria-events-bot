import type { Lang } from '../domain/event.ts';

// Localisation data, in the same spirit as the dictionaries in `i18n.ts`: the
// non-English strings here are content the channel publishes, not code.
//
// A literal table rather than `toLocaleDateString`: the Workers runtime is not
// guaranteed to carry ICU data for every locale, and a heading that silently
// falls back to English on an Italian channel is worse than no heading.
const MONTHS: Readonly<Record<Lang, readonly string[]>> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};

const TODAY: Readonly<Record<Lang, string>> = {
  en: "What's on today",
  it: 'Cosa fare oggi',
  ru: 'Что сегодня',
};

/** "Cosa fare oggi — 25 agosto". */
export const digestHeading = (today: string, lang: Lang): string => {
  const [, , month = '', day = ''] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today) ?? [];
  const name = MONTHS[lang][Number(month) - 1];
  return name === undefined
    ? TODAY[lang]
    : `${TODAY[lang]} — ${Number(day)} ${name}`;
};
