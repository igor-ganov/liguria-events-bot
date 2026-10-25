import { dedupeLinks, linkOf, normalizeTitle } from '../domain/event.ts';
import type { RawEvent, Session } from '../domain/event.ts';
import { slugify } from '../domain/slugify.ts';

// One entry, one date: an entry that is a run of its own is an event already.
const oneDay = (raw: RawEvent): boolean => raw.endDate === undefined || raw.endDate === raw.startDate;

const seriesKey = (raw: RawEvent): string =>
  [raw.source, raw.city ?? '', slugify(raw.venue ?? ''), normalizeTitle(raw.title)].join('|');

const sessionOf = (raw: RawEvent): Session => ({
  date: raw.startDate,
  ...(raw.time === undefined ? {} : { time: raw.time }),
});

const byDate = (a: RawEvent, b: RawEvent): number =>
  a.startDate.localeCompare(b.startDate) || (a.time ?? '').localeCompare(b.time ?? '');

// The first date leads: its page is the event's address, and every other
// date's page becomes one of its links. A later crawl, after the first date
// has passed, leads with a page the record already knows, which is how it
// finds the same record instead of starting a new one.
const seriesOf = (lead: RawEvent, later: readonly RawEvent[]): RawEvent => {
  const all = [lead, ...later];
  const altLinks = dedupeLinks([...later.map(linkOf), ...all.flatMap((entry) => entry.altLinks ?? [])], lead.url);
  const filled = later.reduce<RawEvent>((acc, entry) => ({ ...entry, ...acc }), lead);
  return {
    ...filled,
    startDate: lead.startDate,
    endDate: later.at(-1)?.startDate ?? lead.startDate,
    sessions: all.map(sessionOf),
    kind: 'container',
    ...(altLinks.length === 0 ? {} : { altLinks }),
  };
};

const folded = (entries: readonly RawEvent[]): readonly RawEvent[] => {
  const [lead, ...later] = entries.toSorted(byDate);
  const dates = new Set(entries.map((entry) => entry.startDate));
  return lead === undefined || dates.size < 2 ? entries : [seriesOf(lead, later)];
};

/**
 * Fold the entries a source lists once per date into one event per show.
 *
 * Ticketmaster sells every date of a show as a listing of its own: 84 entries
 * for one exhibition, 26 for one residency, each stored as an event, each a
 * card of its own and a page of its own. The same source, town, venue and
 * title on several single dates is one show with a programme, and the
 * programme is exactly the dates it is sold on — a container.
 */
export const groupSeries = (events: readonly RawEvent[]): readonly RawEvent[] => {
  const series = new Map<string, readonly RawEvent[]>();
  events.filter(oneDay).forEach((raw) => series.set(seriesKey(raw), [...(series.get(seriesKey(raw)) ?? []), raw]));
  return [...[...series.values()].flatMap(folded), ...events.filter((raw) => !oneDay(raw))];
};
