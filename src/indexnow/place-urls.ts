import { slugify } from '../domain/slugify.ts';
import type { CompactEvent } from '../domain/event.ts';

const SITE = 'https://dovego.it';

/**
 * The language the place pages are submitted in.
 *
 * The site's own place sitemap advertises one locale per page and reaches the
 * other two by hreflang, because the events are in Italy and the audience reads
 * Italian. Submitting all three would spend the same crawl three times over for
 * pages that say the same thing.
 */
const LANG = 'it';

/** A city page and the three time facets that share its programme. */
const FACETS: readonly string[] = ['', 'today/', 'tomorrow/', 'this-weekend/'];

/** Enough for a crawl's worth of new events; 900 URLs in one submission came
 *  back 429, and a city's pages are offered again the next time it changes. */
const LIMIT = 60;

const cityOf = (event: CompactEvent): string => `${event.rg ?? ''}/${event.ct ?? ''}/`;

const located = (event: CompactEvent): boolean => (event.rg ?? '') !== '' && (event.ct ?? '') !== '';

// A venue named after its own city is the crawler filling the field in — 55
// events in one snapshot said venue "Milano" in city Milano — and a venue whose
// slug is a facet word would announce a facet as if it were a place.
const venueSlug = (event: CompactEvent): readonly string[] =>
  [slugify(event.v ?? '')]
    .filter((slug) => slug !== 'x')
    .filter((slug) => slug !== slugify(event.ct ?? ''))
    .filter((slug) => !FACETS.includes(`${slug}/`));

/**
 * The pages a batch of new events changed, beyond the events' own.
 *
 * IndexNow was offered event pages and nothing else, so the pages that answer
 * "what is on in Genova" — the city, its facets, the venue with a programme —
 * were never announced at all. They are the pages worth ranking, and this is
 * the one channel that reaches Bing without an account.
 */
export const placeUrls = (events: readonly CompactEvent[], limit = LIMIT): readonly string[] => {
  const paths = events
    .filter(located)
    .flatMap((event) => [
      ...FACETS.map((facet) => `${cityOf(event)}${facet}`),
      ...venueSlug(event).map((slug) => `${cityOf(event)}${slug}/`),
    ]);
  return [...new Set(paths)].slice(0, limit).map((path) => `${SITE}/${LANG}/${path}`);
};
