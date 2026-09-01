import { eventSlug } from '../domain/event-slug.ts';
import type { CompactEvent } from '../domain/event.ts';

const SITE = 'https://dovego.it';

/** Every locale an event page is built in. English lives at the root.
 *  Announcing a bare id would announce a redirect: search engines are told the
 *  address the page actually answers at. */
export const eventUrls = (event: Pick<CompactEvent, 'id' | 't' | 's' | 'v'>): readonly string[] => {
  const slug = eventSlug(event);
  return [`${SITE}/event/${slug}/`, `${SITE}/it/event/${slug}/`, `${SITE}/ru/event/${slug}/`];
};
