import { botUtm } from './bot-utm.ts';
import { eventUrl } from './event-url.ts';
import { romeDate } from '../pipeline/clock.ts';
import { withUtm } from './with-utm.ts';
import type { CompactEvent, Lang } from '../domain/event.ts';

/**
 * Our page for an event, as the bot links it in a chat.
 *
 * The bot used to link the source — a comune's page, a theatre's own site — so
 * it sent its readers away from the site it exists to fill. Telegram brought
 * one visit a week, and that was the design rather than a measurement problem.
 * The source is still named on the card and on the page it opens; what changes
 * is which of the two the reader lands on.
 *
 * `today` has a default because the renderers it is called from take a reader
 * and a language, not a clock, and threading one through four layers to stamp
 * a campaign month would be the tail wagging the dog. Tests pass it.
 */
export const siteLink = (
  event: Pick<CompactEvent, 'id' | 't' | 's' | 'v'>,
  lang: Lang,
  today: string = romeDate(Date.now()),
): string => withUtm(eventUrl(event, lang), botUtm(today));
