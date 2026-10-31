import { FACET_PATHS } from './facet-paths.ts';
import type { CompactEvent } from '../domain/event.ts';

const SITE = 'https://dovego.it';
/** One locale, for the reason place-urls gives: the place sitemap advertises
 *  one per page and reaches the other two by hreflang. */
const LANG = 'it';

const placed = (event: CompactEvent): boolean => (event.rg ?? '') !== '' && (event.ct ?? '') !== '';

/**
 * Every city page the corpus has, each with its three time facets, in a stable
 * order so a cursor into the list means the same thing from one hour to the
 * next.
 */
export const cityFacetUrls = (events: readonly CompactEvent[]): readonly string[] => [
  ...new Set(
    events
      .filter(placed)
      .map((event) => `${event.rg ?? ''}/${event.ct ?? ''}/`)
      .flatMap((city) => FACET_PATHS.map((facet) => `${SITE}/${LANG}/${city}${facet}`)),
  ),
];
