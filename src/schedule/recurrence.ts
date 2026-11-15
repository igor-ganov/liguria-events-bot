/**
 * The weekdays an event's own words say it is held on.
 *
 * A weekly club, a monthly market and a fortnightly meet-up are each listed
 * with one span ("5 October to 26 April"), and nothing in a span says the
 * event is only on Mondays. The text does: "ogni lunedì", "every other
 * Thursday", "l'ultima domenica del mese". This reads those phrases, and only
 * those: a weekday followed by a day number is a date, not a habit, and a text
 * that speaks of every day or of a closing day describes opening hours, which
 * are left to the run.
 */
import { WEEKDAY_WORD, fold, weekdayNamed, weekdayRange } from './weekdays.ts';
import type { Weekday } from './weekdays.ts';

/** Which occurrence of a weekday in its month: 1st … 4th, or -1 for the last. */
export type Nth = 1 | 2 | 3 | 4 | -1;

export type MonthlyRule = Readonly<{ day: Weekday; nth: Nth }>;

export type Recurrence =
  | Readonly<{ kind: 'weekly'; days: readonly number[]; every: 1 | 2 }>
  | Readonly<{ kind: 'monthly'; rules: readonly MonthlyRule[] }>;

const W = WEEKDAY_WORD;
/** Not followed by a day number: "sabato 21" is a date. A comma ends the
 *  phrase ("dal lunedì al venerdì, 9-13" is hours, not a date). */
const UNDATED = '(?!\\s*\\d)';

const DAILY = /\b(?:tutti i giorni|ogni giorno|every day|daily|7 giorni su 7)\b/;
const CLOSING = new RegExp(`\\b(?:chius[oia]|closed|tranne|except|eccetto|escluso)\\b[^.;\\n]{0,24}${W}`);

const LIST_TAIL = `(?:\\s*(?:,|\\be\\b|\\bed\\b|\\band\\b|&)\\s*(?:(?:il|la|i|le|on)\\s+)?${W}${UNDATED})*`;
const WEEKLY_LIST = new RegExp(
  `\\b(?:ogni|tutti i|tutte le|il|la|i|le|di|every|each|on)\\s+(${W}${UNDATED}${LIST_TAIL})`,
  'g',
);
const BARE_PLURAL = new RegExp(`\\b(?:mon|tues|wednes|thurs|fri|satur|sun)days\\b${UNDATED}`, 'g');
const WEEKDAY_RANGE = new RegExp(
  `\\b(?:dal|da|from)\\s+(${W})${UNDATED}\\s+(?:al|alla|a|to|till|until|through)\\s+(${W})${UNDATED}`,
  'g',
);
const WEEKEND = new RegExp(
  `\\b(?:(?:ogni|tutti i|nei|il|every|on|at)\\s+(?:fine settimana|weekends?)|weekends)\\b${UNDATED}`,
);
const ALTERNATE = new RegExp(
  `\\b(?:ogni altr[oa]|every other|every second)\\s+(${W})|\\b(${W})\\s+altern[ie]\\b`,
  'g',
);
const FORTNIGHTLY = /\b(?:settimane alterne|ogni due settimane|ogni 15 giorni|every two weeks|every 15 days|every fortnight|fortnightly|biweekly)\b/;

const NTH_WORDS: ReadonlyArray<readonly [RegExp, Nth]> = [
  [/^(?:prim|first)/, 1],
  [/^second/, 2],
  [/^(?:terz|third)/, 3],
  [/^(?:quart|fourth)/, 4],
  [/^(?:ultim|last)/, -1],
];
const NTH = '(prim[oa]|second[oa]?|terz[oa]|quart[oa]|ultim[oa]|first|third|fourth|last)';
const MONTHLY = new RegExp(
  `\\b(ogni|every|each|il|la|the|on the)\\s+${NTH}\\s+(${W})${UNDATED}(\\s+(?:del|di ogni|of the|of each|of every)\\s+(?:mese|month))?`,
  'g',
);

const weekdaysIn = (phrase: string): readonly Weekday[] =>
  [...phrase.matchAll(new RegExp(W, 'g'))].flatMap((match) => {
    const day = weekdayNamed(match[0]);
    return day === undefined ? [] : [day];
  });

const rangeDays = (from: string | undefined, to: string | undefined): readonly number[] => {
  const [start, end] = [weekdayNamed(from ?? ''), weekdayNamed(to ?? '')];
  return start === undefined || end === undefined ? [] : weekdayRange(start, end);
};

const weeklyDays = (text: string): readonly number[] => [
  ...[...text.matchAll(WEEKLY_LIST)].flatMap((match) =>
    match[0].startsWith('on ') && !/days\b/.test(match[1] ?? '') ? [] : weekdaysIn(match[1] ?? ''),
  ),
  ...[...text.matchAll(BARE_PLURAL)].flatMap((match) => weekdaysIn(match[0])),
  ...[...text.matchAll(WEEKDAY_RANGE)].flatMap((match) => rangeDays(match[1], match[2])),
  ...(WEEKEND.test(text) ? [6, 0] : []),
];

const alternateDays = (text: string): readonly number[] =>
  [...text.matchAll(ALTERNATE)].flatMap((match) => weekdaysIn(match[1] ?? match[2] ?? ''));

const nthOf = (word: string): Nth | undefined => NTH_WORDS.find(([pattern]) => pattern.test(word))?.[1];

const monthlyRules = (text: string): readonly MonthlyRule[] =>
  [...text.matchAll(MONTHLY)]
    .filter((match) => ['ogni', 'every', 'each'].includes(match[1] ?? '') || match[4] !== undefined)
    .flatMap((match) => {
      const [nth, day] = [nthOf(match[2] ?? ''), weekdayNamed(match[3] ?? '')];
      return nth === undefined || day === undefined ? [] : [{ day, nth }];
    });

const sortedUnique = (days: readonly number[]): readonly number[] => [...new Set(days)].toSorted();

const weeklyOf = (text: string): Recurrence | undefined => {
  const alternate = alternateDays(text);
  const every = alternate.length > 0 || FORTNIGHTLY.test(text) ? 2 : 1;
  const days = sortedUnique([...alternate, ...weeklyDays(text)]);
  return days.length === 0 ? undefined : { kind: 'weekly', days, every };
};

/** The recurrence a text states, or nothing when it states none — or two. */
export const recurrenceIn = (text: string): Recurrence | undefined => {
  const folded = fold(text);
  if (DAILY.test(folded) || CLOSING.test(folded)) return undefined;
  const rules = monthlyRules(folded);
  const weekly = weeklyOf(folded.replace(MONTHLY, ' '));
  return rules.length === 0 ? weekly : weekly === undefined ? { kind: 'monthly', rules } : undefined;
};
