/**
 * An event on the days, and at the hour, its own words give.
 *
 * The site lists an event without the container flag on every day of its
 * span, so a club that meets on Mondays from October to April was offered on
 * Sunday evenings. A model reads the programme of most events, but it reads a
 * weekly habit as one long run, and it has taken the end of "18:00-19:30" for
 * the start. This is the deterministic second reading: what the text states
 * plainly is applied, anything the text leaves open is left as it was, and a
 * reading the span itself contradicts is not applied at all.
 */
import type { EventRecord, Session } from '../domain/event.ts';
import { withTrueWeekdays } from './article-weekdays.ts';
import { clockTimesIn } from './clock-times.ts';
import type { ClockTimes } from './clock-times.ts';
import { occurrencesOf, spanAgrees } from './occurrences.ts';
import { recurrenceIn } from './recurrence.ts';
import type { Recurrence } from './recurrence.ts';
import { daysBetween } from './weekdays.ts';
import { sameJson } from '../util/json.ts';

/** A recurrence on more days than this is opening hours ("from Tuesday to
 *  Sunday"), and an exhibition open six days a week is left to its run. */
const MAX_WEEKLY_DAYS = 3;
/** Shorter than this, a span has no weekly pattern to keep it to. */
const MIN_SPAN_DAYS = 7;

const WHEN = /## \[when\][^\n]*\n([\s\S]*?)(?=\n## |$)/;

const whenOf = (article: string): string => WHEN.exec(article)?.[1] ?? '';

const NO_TIMES: ClockTimes = { starts: [], ends: [], ranges: [] };

/**
 * The times the record's "When" sections give — or, for an article written
 * without one, its whole text, then the source's. A "When" section that names
 * no time is the answer, not a reason to look further: the rest of an article
 * is full of other hours (a ticket sale opening at 14:00, a fee "at 5 euros").
 * The two languages must name the same starts, or none is trusted.
 */
const timesOf = (record: EventRecord): ClockTimes => {
  const { en, it } = record.descriptions;
  const whens = [whenOf(en), whenOf(it)].filter((text) => text.trim() !== '');
  const tier = whens.length > 0 ? whens : [en, it, record.rawDescription ?? ''].filter((text) => text.trim() !== '');
  const readings = tier.map(clockTimesIn).filter((times) => times.starts.length + times.ends.length > 0);
  const [first] = readings;
  const agree = readings.every((times) => sameJson(times.starts, first?.starts));
  return first !== undefined && agree ? first : NO_TIMES;
};

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The ways a stored start is known wrong when the text gives one start. */
const WRONG_START: ReadonlyArray<(time: string, only: string, times: ClockTimes) => boolean> = [
  // The end of the text's own range was taken for its start.
  (time, _only, times) => times.ends.includes(time),
  // Read on a twelve-hour clock: 07:30 for a presentation at 19:30.
  (time, only) => Math.abs(minutesOf(time) - minutesOf(only)) === 720,
  // Outside the one window the text states ("from 15:30 to 17:30", stored 18:30).
  (time, only, times) => {
    const windows = times.ranges.filter((range) => range.start === only);
    return windows.length > 0 && windows.every((range) => time < range.start || time > range.end);
  },
];

/**
 * The start to store. Only the one start the text gives ever replaces the
 * stored one, and only when the stored one is missing or known wrong: a time
 * the text simply does not mention (an exhibition's hours beside a vernissage)
 * is left as the source gave it.
 */
export const statedStart = (time: string | undefined, times: ClockTimes): string | undefined => {
  const [only, ...others] = times.starts;
  if (only === undefined || others.length > 0) return time;
  if (time === undefined) return only;
  return !times.starts.includes(time) && WRONG_START.some((wrong) => wrong(time, only, times)) ? only : time;
};

const withTime = (record: EventRecord, time: string | undefined): EventRecord => {
  const { time: _stored, ...rest } = record;
  return time === undefined ? rest : { ...rest, time };
};

const usable = (recurrence: Recurrence | undefined): recurrence is Recurrence =>
  recurrence !== undefined &&
  (recurrence.kind === 'monthly' || recurrence.days.length <= MAX_WEEKLY_DAYS);

/** What a tier of texts says: nothing, one reading they share, or a conflict.
 *  The English and Italian articles are two renderings of one source, so a
 *  habit only one of them reads ("Every Saturday" against "il sabato e la
 *  domenica") is a misreading, and nothing is applied. */
type Reading = Readonly<{ found?: Recurrence; conflict: boolean }>;

const readingOf = (texts: readonly string[]): Reading => {
  const found = texts.flatMap((text) => {
    const recurrence = recurrenceIn(text);
    return recurrence === undefined ? [] : [recurrence];
  });
  const [first] = found;
  const agree = found.every((one) => JSON.stringify(one) === JSON.stringify(first));
  return first === undefined ? { conflict: false } : agree ? { found: first, conflict: false } : { conflict: true };
};

/** The "When" sections, then the whole articles, then the source's words:
 *  the first tier that reads a habit decides. */
export const statedRecurrence = (record: EventRecord): Recurrence | undefined => {
  const { en, it } = record.descriptions;
  const tiers = [[whenOf(en), whenOf(it)], [en, it], [record.rawDescription ?? '']];
  const decided = tiers
    .map((texts) => readingOf(texts.filter((text) => text.trim() !== '')))
    .find((reading) => reading.conflict || reading.found !== undefined);
  return decided?.found;
};

/** The recurrence the text states, when the record's span agrees with it. */
export const recurrenceOf = (record: EventRecord): Recurrence | undefined => {
  const end = record.endDate ?? record.startDate;
  const found = statedRecurrence(record);
  return usable(found) &&
    daysBetween(record.startDate, end) >= MIN_SPAN_DAYS &&
    spanAgrees(found, record.startDate, end)
    ? found
    : undefined;
};

/** A day of the programme: what the model read for it when it read that
 *  day, otherwise just the day at the event's hour. */
const sessionOn = (date: string, read: readonly Session[], time: string | undefined): Session =>
  read.find((session) => session.date === date) ?? { date, ...(time === undefined ? {} : { time }) };

const onRecurrence = (record: EventRecord, recurrence: Recurrence): EventRecord => ({
  ...record,
  kind: 'container',
  sessions: occurrencesOf(recurrence, record.startDate, record.endDate ?? record.startDate).map(
    (date) => sessionOn(date, record.sessions ?? [], record.time),
  ),
});

const gapsOf = (dates: readonly string[]): readonly number[] =>
  dates.slice(1).map((date, i) => daysBetween(dates[i] ?? date, date));

/** Every few days on one beat (weekly, fortnightly, every third day), or
 *  weekly with a week skipped here and there. */
const regular = (gaps: readonly number[]): boolean =>
  gaps.length >= 2 && (gaps.every((gap) => gap === gaps[0]) || gaps.every((gap) => gap % 7 === 0));

/**
 * A programme without the container flag is resolved one way: it IS the
 * event when it runs from the span's first day to its last and either fills
 * every day between or keeps a regular beat; anything else is highlights
 * inside a run (an exhibition's guided tours), and the run stays.
 */
export const programmeIsTheEvent = (record: EventRecord): boolean => {
  const dates = [...new Set((record.sessions ?? []).map((session) => session.date))].toSorted();
  const end = record.endDate ?? record.startDate;
  return (
    dates[0] === record.startDate &&
    dates.at(-1) === end &&
    (dates.length === daysBetween(record.startDate, end) + 1 || regular(gapsOf(dates)))
  );
};

const onItsWeekdays = (record: EventRecord): EventRecord => {
  if (record.listedProgramme === true) return record;
  const recurrence = recurrenceOf(record);
  if (recurrence !== undefined) return onRecurrence(record, recurrence);
  return record.kind !== 'container' && programmeIsTheEvent(record)
    ? { ...record, kind: 'container' }
    : record;
};

const sessionsAt = (record: EventRecord, times: ClockTimes): EventRecord =>
  record.sessions === undefined || record.listedProgramme === true
    ? record
    : {
        ...record,
        sessions: record.sessions.map((session) =>
          session.time === undefined || times.ends.includes(session.time) === false
            ? session
            : { ...session, time: statedStart(session.time, times) ?? session.time },
        ),
      };

/** The record on the days and at the hour its own text gives, its articles
 *  naming the real weekday of every date in its span. Idempotent. */
export const withExactSchedule = (record: EventRecord): EventRecord => {
  const times = timesOf(record);
  const timed = sessionsAt(withTime(record, statedStart(record.time, times)), times);
  return withTrueWeekdays(onItsWeekdays(timed));
};
