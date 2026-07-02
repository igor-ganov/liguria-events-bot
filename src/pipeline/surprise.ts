/**
 * "Surprise me" pick (AC-6.1): one upcoming event, weighted ×3 toward the
 * user's preferred categories; injectable rng keeps it deterministic in tests.
 */
import type { Category, CompactEvent } from '../domain/event.ts';
import { eventsInWindow, upcomingWindow } from './windows.ts';

const PREFERRED_WEIGHT = 3;
const HORIZON_DAYS = 14;

export const pickSurprise = (
  index: readonly CompactEvent[],
  today: string,
  preferred: readonly Category[],
  rng: () => number,
  excludeId?: string,
): CompactEvent | undefined => {
  const candidates = eventsInWindow(index, upcomingWindow(today, HORIZON_DAYS)).filter(
    (event) => event.id !== excludeId,
  );
  if (candidates.length === 0) return undefined;
  const weightOf = (event: CompactEvent): number =>
    event.c.some((category) => preferred.includes(category)) ? PREFERRED_WEIGHT : 1;
  const total = candidates.reduce((sum, event) => sum + weightOf(event), 0);
  let roll = rng() * total;
  for (const event of candidates) {
    roll -= weightOf(event);
    if (roll < 0) return event;
  }
  return candidates.at(-1);
};
