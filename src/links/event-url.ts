import { eventSlug } from '../domain/event-slug.ts';
import type { CompactEvent, Lang } from '../domain/event.ts';

const SITE = 'https://dovego.it';

/** The site path for a locale. Every language carries its prefix, English
 *  included: it was the site with no prefix until the site evened the three
 *  out, and everything published from here kept the old spelling, so every
 *  English link answered a redirect. Takes the event, not its id: an address is
 *  made of the event's own words, and a bare id only redirects. */
export const eventUrl = (event: Pick<CompactEvent, 'id' | 't' | 's' | 'v'>, lang: Lang): string =>
  `${SITE}/${lang}/event/${eventSlug(event)}/`;
