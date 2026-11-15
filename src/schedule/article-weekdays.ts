/**
 * The weekday an article names next to a date, made the weekday of that date.
 *
 * The model writes the article from the listing's dates and adds the weekday
 * itself, and it gets it wrong: Korn plays Assago on 21 November 2026, a
 * Saturday, and its article said "Sunday 21 November 2026" in three
 * languages. The date is the source's; the weekday is arithmetic. Only a date
 * inside the event's own span is corrected — a date outside it may be a past
 * edition, and nothing about it is ours to say.
 */
import { LANGS } from '../domain/event.ts';
import type { EventRecord, Lang, LocalizedText } from '../domain/event.ts';
import { weekdayOf } from './weekdays.ts';

type Names = readonly string[];

type Language = Readonly<{
  /** Every spelling of each weekday, Sunday first; [0] is the one written. */
  days: readonly Names[];
  months: Names;
  /** The case a Russian weekday is in decides the form it is replaced by. */
  formOf: (word: string, preposition: string) => number;
  formsOf: (day: number) => Names;
  prepositionFor: (preposition: string, day: number) => string;
}>;

const plain = (days: readonly Names[], months: Names): Language => ({
  days,
  months,
  formOf: () => 0,
  formsOf: (day) => days[day] ?? [],
  prepositionFor: (preposition) => preposition,
});

const ITALIAN = plain(
  [
    ['domenica'], ['lunedì', 'lunedi'], ['martedì', 'martedi'], ['mercoledì', 'mercoledi'],
    ['giovedì', 'giovedi'], ['venerdì', 'venerdi'], ['sabato'],
  ],
  ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
);

const ENGLISH = plain(
  [['sunday'], ['monday'], ['tuesday'], ['wednesday'], ['thursday'], ['friday'], ['saturday']],
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
);

/** Nominative, accusative, genitive. */
const RUSSIAN_FORMS: readonly Names[] = [
  ['воскресенье', 'воскресенье', 'воскресенья'],
  ['понедельник', 'понедельник', 'понедельника'],
  ['вторник', 'вторник', 'вторника'],
  ['среда', 'среду', 'среды'],
  ['четверг', 'четверг', 'четверга'],
  ['пятница', 'пятницу', 'пятницы'],
  ['суббота', 'субботу', 'субботы'],
];

const RUSSIAN: Language = {
  days: RUSSIAN_FORMS,
  months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  formOf: (word, preposition) => {
    const forms = RUSSIAN_FORMS.find((names) => names.includes(word)) ?? [];
    const form = forms.lastIndexOf(word);
    return form === 2 ? 2 : preposition === '' ? 0 : 1;
  },
  formsOf: (day) => RUSSIAN_FORMS[day] ?? [],
  prepositionFor: (preposition, day) =>
    preposition === '' ? '' : `${preposition.slice(0, 1)}${day === 2 ? 'о' : ''}`,
};

const LANGUAGES: Readonly<Record<Lang, Language>> = { it: ITALIAN, en: ENGLISH, ru: RUSSIAN };

const alternation = (names: Names): string => names.toSorted((a, b) => b.length - a.length).join('|');

const patternOf = (language: Language): RegExp =>
  new RegExp(
    `(?<!\\p{L})(?:([вВ]о?)\\s+)?(${alternation(language.days.flat())})(?!\\p{L})('?\\s*,?\\s*)` +
      `(\\d{1,2})((?:°|º|st|nd|rd|th)?\\s+)(${alternation(language.months)})(?!\\p{L})(?:(\\s+)(\\d{4}))?`,
    'giu',
  );

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** The date a day and month name inside the span: the stated year, or the
 *  year of the span that puts it inside. */
const dateInSpan = (record: EventRecord, month: number, day: number, year: string | undefined): string | undefined => {
  const end = record.endDate ?? record.startDate;
  const years = year === undefined ? [record.startDate, end].map((one) => Number(one.slice(0, 4))) : [Number(year)];
  return years
    .map((one) => iso(one, month, day))
    .find((date) => !Number.isNaN(Date.parse(date)) && date >= record.startDate && date <= end);
};

const capitalLike = (model: string, word: string): string =>
  model.slice(0, 1) === model.slice(0, 1).toUpperCase() ? `${word.slice(0, 1).toUpperCase()}${word.slice(1)}` : word;

const dayOfWord = (language: Language, word: string): number =>
  language.days.findIndex((names) => names.includes(word.toLowerCase()));

const fixedIn = (record: EventRecord, language: Language) => (text: string): string =>
  text.replace(patternOf(language), (whole: string, ...groups: readonly unknown[]) => {
    const [preposition = '', word = '', gap = '', day = '', suffix = '', month = '', space = '', year] =
      groups.slice(0, 8).map((group) => (typeof group === 'string' ? group : undefined));
    const monthIndex = language.months.indexOf(month.toLowerCase()) + 1;
    const date = dateInSpan(record, monthIndex, Number(day), year);
    if (date === undefined || dayOfWord(language, word) === weekdayOf(date)) return whole;
    const real = weekdayOf(date);
    const form = language.formOf(word.toLowerCase(), preposition);
    const name = capitalLike(word, language.formsOf(real)[form] ?? word);
    const lead = preposition === '' ? '' : `${language.prepositionFor(preposition, real)} `;
    return `${lead}${name}${gap}${day}${suffix}${month}${year === undefined ? '' : `${space}${year}`}`;
  });

/** Every article with each dated weekday inside the span made the real one. */
export const withTrueWeekdays = (record: EventRecord): EventRecord => {
  const fix = (lang: Lang): string => fixedIn(record, LANGUAGES[lang])(record.descriptions[lang]);
  const descriptions: LocalizedText = { en: fix('en'), it: fix('it'), ru: fix('ru') };
  const same = LANGS.every((lang) => descriptions[lang] === record.descriptions[lang]);
  return same ? record : { ...record, descriptions };
};
