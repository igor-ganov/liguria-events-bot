import { monthTag } from './month-tag.ts';
import type { Utm } from './with-utm.ts';

/** How an entry in a subscribed calendar is tagged. Its own source, because a
 *  calendar is the one surface that keeps working when nobody is reading
 *  anything: a click from it arrives weeks after the subscription, from an app
 *  that sends no referrer. */
export const calendarUtm = (today: string): Utm => ({
  source: 'calendar',
  medium: 'ical',
  campaign: monthTag(today, 'calendar'),
});
