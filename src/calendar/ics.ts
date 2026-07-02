/**
 * Public iCalendar feed rendering (public-calendar design §2). Pure function
 * over the compact index — one KV read serves the whole feed. RFC 5545:
 * escaped text, ≤75-octet folded lines, CRLF endings, VTIMEZONE for the
 * timed events.
 */
import type { Category, CompactEvent } from '../domain/event.ts';
import { isCategory } from '../domain/event.ts';
import { CATEGORY_EMOJI } from '../delivery/render.ts';
import { addDays } from '../pipeline/clock.ts';

export type CalendarFilter = Readonly<{
  categories?: readonly Category[];
  freeOnly?: boolean;
}>;

/** AC-2.x: category/free filters compose; empty category list = no filter. */
export const filterEvents = (
  index: readonly CompactEvent[],
  filter: CalendarFilter,
): readonly CompactEvent[] =>
  index
    .filter(
      (event) =>
        filter.categories === undefined ||
        filter.categories.length === 0 ||
        filter.categories.includes(event.c),
    )
    .filter((event) => filter.freeOnly !== true || event.f === true);

/** Parse `?cat=music,art&free=1` into a filter; unknown tokens are ignored. */
export const filterFromQuery = (params: URLSearchParams): CalendarFilter => {
  const categories = (params.get('cat') ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(isCategory);
  return {
    ...(categories.length === 0 ? {} : { categories }),
    ...(params.get('free') === '1' ? { freeOnly: true } : {}),
  };
};

// ────────────────────────────────────────────────────── RFC 5545 plumbing ──

/** §3.3.11 TEXT escaping (AC-1.5). */
export const escapeIcsText = (text: string): string =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** Fold at 74 chars — continuation lines start with a single space (AC-1.5). */
export const foldIcsLine = (line: string): readonly string[] => {
  if (line.length <= 74) return [line];
  const parts: string[] = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) {
    parts.push(` ${line.slice(i, i + 73)}`);
  }
  return parts;
};

const dateValue = (isoDate: string): string => isoDate.replace(/-/g, '');

const dtStamp = (nowMs: number): string =>
  `${new Date(nowMs).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;

const DEFAULT_EVENT_HOURS = 2;

const timedValue = (isoDate: string, time: string, addHours = 0): string => {
  const [hourPart, minutePart] = time.split(':');
  const hour = Number(hourPart) + addHours;
  if (hour <= 23) {
    return `${dateValue(isoDate)}T${String(hour).padStart(2, '0')}${minutePart ?? '00'}00`;
  }
  return `${dateValue(addDays(isoDate, 1))}T${String(hour - 24).padStart(2, '0')}${minutePart ?? '00'}00`;
};

/** Standard Europe/Rome VTIMEZONE (CET/CEST, EU transition rules). */
const VTIMEZONE: readonly string[] = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Rome',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  music: 'Music',
  theatre: 'Theatre',
  art: 'Art',
  food: 'Food',
  sport: 'Sport',
  family: 'Family',
  market: 'Market',
  nightlife: 'Nightlife',
  culture: 'Culture',
  workshop: 'Workshop',
  other: 'Other',
};

const eventLines = (event: CompactEvent, stamp: string): readonly string[] => {
  const lastDay = event.e ?? event.s;
  const timing =
    event.h === undefined
      ? [
          `DTSTART;VALUE=DATE:${dateValue(event.s)}`,
          // iCal DTEND is exclusive → day after the last covered day (AC-1.3).
          `DTEND;VALUE=DATE:${dateValue(addDays(lastDay, 1))}`,
        ]
      : [
          `DTSTART;TZID=Europe/Rome:${timedValue(event.s, event.h)}`,
          `DTEND;TZID=Europe/Rome:${timedValue(event.s, event.h, DEFAULT_EVENT_HOURS)}`,
        ];
  const description = [
    CATEGORY_LABEL[event.c],
    ...(event.f === true ? ['free entry'] : []),
    event.u,
  ].join(' · ');
  return [
    'BEGIN:VEVENT',
    `UID:${event.id}@event-collecter`,
    `DTSTAMP:${stamp}`,
    ...timing,
    `SUMMARY:${escapeIcsText(`${CATEGORY_EMOJI[event.c]} ${event.t}`)}`,
    ...(event.v === undefined ? [] : [`LOCATION:${escapeIcsText(event.v)}`]),
    `DESCRIPTION:${escapeIcsText(description)}`,
    `URL:${event.u}`,
    `CATEGORIES:${CATEGORY_LABEL[event.c].toUpperCase()}`,
    'END:VEVENT',
  ];
};

export const buildIcs = (events: readonly CompactEvent[], nowMs: number): string => {
  const stamp = dtStamp(nowMs);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//event-collecter//Genoa Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Genoa Events',
    'X-WR-TIMEZONE:Europe/Rome',
    ...VTIMEZONE,
    ...events.flatMap((event) => eventLines(event, stamp)),
    'END:VCALENDAR',
  ];
  return `${lines.flatMap(foldIcsLine).join('\r\n')}\r\n`;
};
