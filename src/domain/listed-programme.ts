import type { EventRecord, RawEvent, Session } from './event.ts';

const keyOf = (session: Session): string => `${session.date}|${session.time ?? ''}`;

/** Two programmes as one: every date of either, the first's reading of a date
 *  kept (it may carry a title the other lacks), in date order. */
export const unionSessions = (
  first: readonly Session[],
  second: readonly Session[],
): readonly Session[] =>
  [...first, ...second]
    .filter((session, i, all) => all.findIndex((other) => keyOf(other) === keyOf(session)) === i)
    .toSorted((a, b) => keyOf(a).localeCompare(keyOf(b)));

/**
 * What a sighting that lists its own dates does to the stored programme: the
 * dates are added, never taken away (a date that has passed is still a date
 * the show was on), and the event becomes what a list of dates makes it — a
 * container, its programme the source's own. A sighting without dates leaves
 * the record's programme as it was.
 */
export const listedProgrammeOf = (
  existing: EventRecord,
  incoming: RawEvent,
): Partial<Pick<EventRecord, 'sessions' | 'kind' | 'listedProgramme'>> =>
  incoming.sessions === undefined
    ? {}
    : {
        sessions: unionSessions(existing.sessions ?? [], incoming.sessions),
        kind: incoming.kind ?? existing.kind ?? 'container',
        listedProgramme: true,
      };
