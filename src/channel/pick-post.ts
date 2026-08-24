import type { CompactEvent } from '../domain/event.ts';

/** How far ahead the channel looks. A post about something three months out is
 *  not "what's on", and it burns the one slot today had. */
const HORIZON_DAYS = 21;

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

const postable = (today: string, posted: readonly string[]) => (event: CompactEvent): boolean => {
  const ahead = daysBetween(today, event.s);
  const runsOn = (event.e ?? event.s) >= today;
  return (
    event.img !== undefined &&
    event.d !== undefined &&
    runsOn &&
    ahead <= HORIZON_DAYS &&
    !posted.includes(event.id)
  );
};

/** What the channel says today: the soonest thing worth looking at that it has
 *  not said already. Nothing to say is an answer — a channel that posts filler
 *  is a channel nobody reads. */
export const pickPost = (
  index: readonly CompactEvent[],
  today: string,
  posted: readonly string[],
): CompactEvent | undefined =>
  index
    .filter(postable(today, posted))
    .toSorted((a, b) => a.s.localeCompare(b.s))
    .at(0);
