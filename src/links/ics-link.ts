import { calendarUtm } from './calendar-utm.ts';
import { eventUrl } from './event-url.ts';
import { withUtm } from './with-utm.ts';
import type { CompactEvent, Lang } from '../domain/event.ts';

/** Our page for an event, as a calendar entry links it. The feed is built with
 *  a timestamp, so the campaign's month is the build's — no clock needed here. */
export const icsLink = (
  event: Pick<CompactEvent, 'id' | 't' | 's' | 'v'>,
  lang: Lang,
  today: string,
): string => withUtm(eventUrl(event, lang), calendarUtm(today));
