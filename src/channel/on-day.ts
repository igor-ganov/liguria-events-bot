import type { CompactEvent } from '../domain/event.ts';

/**
 * Is this event on, on this day?
 *
 * A CONTAINER happens only on the dates in its programme — a festival of
 * separate nights, a concert series — and nothing happens in between. Asking
 * `start <= day <= end` would put a three-month festival in every single
 * digest of its run, which is how a daily channel becomes noise.
 */
export const onDay = (event: CompactEvent, day: string): boolean =>
  event.k === true
    ? (event.p ?? []).some((session) => session.date === day)
    : event.s <= day && day <= (event.e ?? event.s);
