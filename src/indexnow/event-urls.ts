import { LANGS } from '../domain/event.ts';
import { eventUrl } from '../links/event-url.ts';
import type { CompactEvent } from '../domain/event.ts';

/** Every locale an event page is built in, spelled by the one builder the rest
 *  of the worker publishes with — so a submission cannot drift from a link.
 *  Announcing a bare id would announce a redirect: search engines are told the
 *  address the page actually answers at. */
export const eventUrls = (event: Pick<CompactEvent, 'id' | 't' | 's' | 'v'>): readonly string[] =>
  LANGS.map((lang) => eventUrl(event, lang));
