/**
 * Pure date-window queries over the compact index (design §6, AC-3.x).
 * An event covers a day when startDate ≤ day ≤ (endDate ?? startDate).
 */
import { addDays, weekdayOf } from './clock.ts';
import type { Category, CompactEvent } from '../domain/event.ts';

export type DateWindow = Readonly<{ from: string; to: string }>;

export const todayWindow = (today: string): DateWindow => ({ from: today, to: today });

export const tomorrowWindow = (today: string): DateWindow => {
  const tomorrow = addDays(today, 1);
  return { from: tomorrow, to: tomorrow };
};

/** Current weekend while it lasts (Sat/Sun), the upcoming one otherwise (AC-3.2). */
export const weekendWindow = (today: string): DateWindow => {
  const dow = weekdayOf(today);
  if (dow === 6) return { from: today, to: addDays(today, 1) };
  if (dow === 0) return { from: today, to: today };
  const saturday = addDays(today, 6 - dow);
  return { from: saturday, to: addDays(saturday, 1) };
};

export const upcomingWindow = (today: string, days: number): DateWindow => ({
  from: today,
  to: addDays(today, days),
});

const endOf = (event: CompactEvent): string => event.e ?? event.s;

export const coversDay = (event: CompactEvent, day: string): boolean =>
  event.s <= day && day <= endOf(event);

export const inWindow = (event: CompactEvent, window: DateWindow): boolean =>
  event.s <= window.to && endOf(event) >= window.from;

const byStartThenTitle = (a: CompactEvent, b: CompactEvent): number =>
  a.s < b.s ? -1 : a.s > b.s ? 1 : a.t.localeCompare(b.t);

export const eventsInWindow = (
  index: readonly CompactEvent[],
  window: DateWindow,
): readonly CompactEvent[] =>
  index.filter((event) => inWindow(event, window)).toSorted(byStartThenTitle);

/** Today's evening picks: starts 18:00+, or nightlife/music running today (AC-3.3). */
export const tonightEvents = (
  index: readonly CompactEvent[],
  today: string,
): readonly CompactEvent[] =>
  index
    .filter(
      (event) =>
        coversDay(event, today) &&
        ((event.h !== undefined && event.h >= '18:00') ||
          event.c.includes('nightlife') ||
          event.c.includes('music')),
    )
    .toSorted(byStartThenTitle);

export const freeEvents = (
  index: readonly CompactEvent[],
  today: string,
  days = 30,
): readonly CompactEvent[] =>
  eventsInWindow(index, upcomingWindow(today, days)).filter((event) => event.f === true);

/** Upcoming hidden-gem / unusual picks (AC-2.6). */
export const gemEvents = (
  index: readonly CompactEvent[],
  today: string,
  days = 30,
): readonly CompactEvent[] =>
  eventsInWindow(index, upcomingWindow(today, days)).filter((event) => event.x === true);

export const categoryEvents = (
  index: readonly CompactEvent[],
  category: Category,
  today: string,
  days = 14,
): readonly CompactEvent[] =>
  eventsInWindow(index, upcomingWindow(today, days)).filter((event) =>
    event.c.includes(category),
  );

/** Drop events fully in the past (AC-1.5). */
export const pruneIndex = (
  index: readonly CompactEvent[],
  today: string,
): readonly CompactEvent[] => index.filter((event) => endOf(event) >= today);
