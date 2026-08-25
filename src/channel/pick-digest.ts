import { onDay } from './on-day.ts';
import type { CompactEvent } from '../domain/event.ts';

export type DigestLimits = Readonly<{ total: number; perCity: number }>;

export const DIGEST_LIMITS: DigestLimits = { total: 12, perCity: 3 };

const cityOf = (event: CompactEvent): string => event.ct ?? '';

const byStartThenTitle = (a: CompactEvent, b: CompactEvent): number =>
  (a.h ?? '99:99').localeCompare(b.h ?? '99:99') || a.t.localeCompare(b.t);

/** Cities with the most on today first, so the digest opens where the reader
 *  is most likely to be. */
const citiesByWeight = (events: readonly CompactEvent[]): readonly string[] => {
  const counts = new Map<string, number>();
  events.forEach((event) => counts.set(cityOf(event), (counts.get(cityOf(event)) ?? 0) + 1));
  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([city]) => city);
};

/**
 * What today's digest is made of.
 *
 * Capped per city as well as in total: without that, one big city fills the
 * post and the channel reads as a Milan channel. Anything already sent stays
 * out — a months-long exhibition is on every day of its run, and repeating it
 * daily is what gets a channel muted.
 */
export const pickDigest = (
  index: readonly CompactEvent[],
  today: string,
  posted: readonly string[],
  limits: DigestLimits = DIGEST_LIMITS,
): readonly CompactEvent[] => {
  const candidates = index.filter(
    (event) =>
      onDay(event, today) &&
      event.d !== undefined &&
      cityOf(event) !== '' &&
      !posted.includes(event.id),
  );
  const byCity = citiesByWeight(candidates).map((city) =>
    candidates.filter((event) => cityOf(event) === city).toSorted(byStartThenTitle).slice(0, limits.perCity),
  );
  return byCity.flat().slice(0, limits.total);
};
