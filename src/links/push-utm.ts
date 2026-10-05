import { monthTag } from './month-tag.ts';
import type { Utm } from './with-utm.ts';

/** How the morning notification's link is tagged. `notification` is a medium
 *  the collector reads as its own channel: a push click has no referrer, so
 *  without it the reader is indistinguishable from somebody typing the address. */
export const pushUtm = (today: string): Utm => ({
  source: 'push',
  medium: 'notification',
  campaign: monthTag(today, 'morning'),
});
