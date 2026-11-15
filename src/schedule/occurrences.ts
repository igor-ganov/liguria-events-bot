/**
 * The days a recurrence falls on inside a span, and whether a span's own ends
 * agree with it — the check that keeps a misread phrase from rewriting an
 * event: a span that starts and ends on Thursdays is not "every weekend".
 */
import { addDays, daysBetween, daysFrom, weekdayOf } from './weekdays.ts';
import type { MonthlyRule, Recurrence } from './recurrence.ts';

const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;

const nextMonth = (first: string): string => {
  const [year, month] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
};

const monthsFrom = (from: string, to: string): readonly string[] =>
  monthStart(from) > to ? [] : [monthStart(from), ...monthsFrom(nextMonth(monthStart(from)), to)];

/** The day a rule names in the month that starts on `first`, if it has one. */
const dayOfRule = (first: string, rule: MonthlyRule): string | undefined => {
  const month = first.slice(0, 7);
  const matching = daysFrom(first, addDays(nextMonth(first), -1)).filter(
    (day) => weekdayOf(day) === rule.day && day.startsWith(month),
  );
  return rule.nth === -1 ? matching.at(-1) : matching[rule.nth - 1];
};

const monthlyDays = (rules: readonly MonthlyRule[], from: string, to: string): readonly string[] =>
  monthsFrom(from, to)
    .flatMap((first) => rules.map((rule) => dayOfRule(first, rule)))
    .filter((day): day is string => day !== undefined && day >= from && day <= to);

const weeklyDays = (days: readonly number[], every: number, from: string, to: string): readonly string[] =>
  days.flatMap((day) => {
    const first = addDays(from, (day - weekdayOf(from) + 7) % 7);
    return daysFrom(first, to).filter((date) => daysBetween(first, date) % (7 * every) === 0);
  });

/** Every day of the span the recurrence falls on, in order. */
export const occurrencesOf = (recurrence: Recurrence, from: string, to: string): readonly string[] =>
  (recurrence.kind === 'weekly'
    ? weeklyDays(recurrence.days, recurrence.every, from, to)
    : monthlyDays(recurrence.rules, from, to)
  ).toSorted();

/** Whether both ends of the span are days the recurrence falls on. */
export const spanAgrees = (recurrence: Recurrence, from: string, to: string): boolean => {
  const days = occurrencesOf(recurrence, from, to);
  return days[0] === from && days.at(-1) === to;
};
