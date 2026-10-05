import { monthTag } from './month-tag.ts';
import type { Utm } from './with-utm.ts';

/** How a link in the channel's own posts is tagged. `social` is the medium the
 *  collector's parser accepts; it reads the source first, so these land in
 *  `telegram` rather than in the social bucket with Instagram. */
export const channelUtm = (today: string): Utm => ({
  source: 'telegram',
  medium: 'social',
  campaign: monthTag(today, 'channel'),
});
