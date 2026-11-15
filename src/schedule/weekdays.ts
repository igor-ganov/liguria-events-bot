/**
 * Calendar arithmetic on 'YYYY-MM-DD' days and the weekday words of the two
 * languages the sources are written in. Every day is read at noon UTC, so no
 * time zone or daylight-saving shift can move it to its neighbour.
 */

/** 0 = Sunday … 6 = Saturday: the numbering of Date.getUTCDay. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DAY_MS = 86_400_000;

const noonOf = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);

export const weekdayOf = (iso: string): number => new Date(noonOf(iso)).getUTCDay();

export const addDays = (iso: string, days: number): string =>
  new Date(noonOf(iso) + days * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number =>
  Math.round((noonOf(to) - noonOf(from)) / DAY_MS);

/** Every day from `from` to `to`, both included. */
export const daysFrom = (from: string, to: string): readonly string[] =>
  Array.from({ length: Math.max(0, daysBetween(from, to) + 1) }, (_, i) => addDays(from, i));

/** Lower case, accents dropped: "Giovedì" and "giovedi" are one word. */
export const fold = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** A weekday word, Italian or English, singular or plural, in folded text. */
export const WEEKDAY_WORD =
  '(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabat[oi]|domenic(?:a|he)|(?:mon|tues|wednes|thurs|fri|satur|sun)days?)';

const BY_PREFIX: ReadonlyArray<readonly [string, Weekday]> = [
  ['lun', 1], ['mon', 1], ['mar', 2], ['tue', 2], ['mer', 3], ['wed', 3],
  ['gio', 4], ['thu', 4], ['ven', 5], ['fri', 5], ['sab', 6], ['sat', 6],
  ['dom', 0], ['sun', 0],
];

/** The weekday a word names; the word is one WEEKDAY_WORD matched. */
export const weekdayNamed = (word: string): Weekday | undefined =>
  BY_PREFIX.find(([prefix]) => word.startsWith(prefix))?.[1];

/** The days from one weekday to another, wrapping past Sunday. */
export const weekdayRange = (from: Weekday, to: Weekday): readonly number[] =>
  Array.from({ length: ((to - from + 7) % 7) + 1 }, (_, i) => (from + i) % 7);
