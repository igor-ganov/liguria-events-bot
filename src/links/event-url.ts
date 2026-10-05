import { eventSlug } from '../domain/event-slug.ts';
import type { CompactEvent, Lang } from '../domain/event.ts';

const SITE = 'https://dovego.it';

/** The site path for a locale: English lives at the root, the others under a
 *  prefix, exactly as the site builds them. Takes the event, not its id: an
 *  address is made of the event's own words, and a bare id only redirects. */
export const eventUrl = (event: Pick<CompactEvent, 'id' | 't' | 's' | 'v'>, lang: Lang): string =>
  lang === 'en'
    ? `${SITE}/event/${eventSlug(event)}/`
    : `${SITE}/${lang}/event/${eventSlug(event)}/`;
