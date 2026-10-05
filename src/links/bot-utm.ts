import { monthTag } from './month-tag.ts';
import type { Utm } from './with-utm.ts';

/** How a link the bot sends in a chat is tagged. Same source as the channel —
 *  both are Telegram, and the parser reads the source — with its own campaign,
 *  because a conversation and a broadcast are two different things to judge. */
export const botUtm = (today: string): Utm => ({
  source: 'telegram',
  medium: 'social',
  campaign: monthTag(today, 'bot'),
});
