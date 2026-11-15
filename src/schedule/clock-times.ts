/**
 * The clock times a text names, told apart into the times something starts
 * and the times it ends.
 *
 * "dalle 18 alle 19.30" starts at 18:00; reading 19:30 as the start is how a
 * club meeting at six was published at half past seven. A bare hour is a time
 * only after a word that makes it one ("ore 21", "alle 18", "at 9") or with
 * am/pm: "dal 15 gennaio" and "12,50 euro" are not times.
 */
import { fold } from './weekdays.ts';

export type ClockRange = Readonly<{ start: string; end: string }>;

export type ClockTimes = Readonly<{
  starts: readonly string[];
  ends: readonly string[];
  /** Each "from … to …" the text states, in reading order. */
  ranges: readonly ClockRange[];
}>;

type Atom = Readonly<{ at: number; end: number; time: string }>;

const MONTH_AHEAD =
  '(?!\\s*(?:di\\s+)?(?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic|jan|may|jun|jul|aug|sep|oct|dec)[a-z]*)';
const MERIDIEM = '(?:\\s*([ap])\\.?\\s?m\\b\\.?)';
/** "at 5 euros", "alle 3 persone": a count, not an hour. */
const UNIT_AHEAD = '(?!\\s*(?:€|eur|euro|minut|min\\b|ore\\b|hours?|km|anni|years|%|person|people|posti))';

const CLOCK = new RegExp(`(?<![\\d.,/:])(\\d{1,2})[:.](\\d{2})${MERIDIEM}?(?!\\d|[.,/:]\\d)`, 'g');
const MERIDIEM_HOUR = new RegExp(`(?<![\\d.,/:])(\\d{1,2})()${MERIDIEM}`, 'g');
// "from" and "to" are left out: "from 3 to 29 November" is two days.
const CUED_HOUR = new RegExp(
  `(?<=\\b(?:ore|h|alle|dalle|at)\\s+)(\\d{1,2})()(?![\\d:.,/])${MONTH_AHEAD}${UNIT_AHEAD}`,
  'g',
);

const RANGE_GAP = /^\s*(?:-|–|—|alle(?:\s+ore)?|to|until|till)\s*$/;
const END_CUE = /(?:fino alle|until|till|entro le|by)\s+(?:ore\s+)?$/;

const pad = (value: number): string => String(value).padStart(2, '0');

const clockOf = (hour: number, minute: number, meridiem: string | undefined): string | undefined => {
  const shifted = meridiem === undefined ? hour : (hour % 12) + (meridiem === 'p' ? 12 : 0);
  return shifted > 23 || minute > 59 ? undefined : `${pad(shifted)}:${pad(minute)}`;
};

const atomsOf = (pattern: RegExp, text: string): readonly Atom[] =>
  [...text.matchAll(pattern)].flatMap((match) => {
    const time = clockOf(Number(match[1]), Number(match[2] || '0'), match[3]);
    const at = match.index;
    return time === undefined ? [] : [{ at, end: at + match[0].length, time }];
  });

/** Every time in the text once, in reading order; where two readings start at
 *  one place, the longer (the one with its minutes) is kept. */
const atomsIn = (text: string): readonly Atom[] =>
  [CLOCK, MERIDIEM_HOUR, CUED_HOUR]
    .flatMap((pattern) => atomsOf(pattern, text))
    .toSorted((a, b) => a.at - b.at || b.end - a.end)
    .filter((atom, i, all) => all.findIndex((other) => other.at === atom.at) === i);

const opensRange = (text: string, atom: Atom | undefined, next: Atom | undefined): boolean =>
  atom !== undefined && next !== undefined && RANGE_GAP.test(text.slice(atom.end, next.at));

const unique = (times: readonly string[]): readonly string[] => [...new Set(times)];

export const clockTimesIn = (raw: string): ClockTimes => {
  const text = fold(raw);
  const atoms = atomsIn(text);
  const ranges = atoms.flatMap((atom, i): readonly ClockRange[] => {
    const next = atoms[i + 1];
    return next !== undefined && opensRange(text, atom, next) ? [{ start: atom.time, end: next.time }] : [];
  });
  const isEnd = (atom: Atom, i: number): boolean =>
    opensRange(text, atoms[i - 1], atom) || END_CUE.test(text.slice(0, atom.at));
  const pick = (end: boolean): readonly string[] =>
    unique(atoms.filter((atom, i) => isEnd(atom, i) === end).map((atom) => atom.time));
  return { starts: pick(false), ends: pick(true), ranges };
};
