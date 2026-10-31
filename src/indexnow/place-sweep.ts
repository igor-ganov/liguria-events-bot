import { cityFacetUrls } from './city-facet-urls.ts';
import type { CompactEvent } from '../domain/event.ts';

type Slice = Readonly<{ urls: readonly string[]; next: number }>;

/**
 * The next few place pages to re-announce, and where to resume.
 *
 * A facet page is a different page every morning with no event added anywhere:
 * "what is on today in Genova" changes because the day changed. Announcing a
 * city only when an event appears in it left those pages unannounced for as
 * long as the city was quiet — and in the ten days after they shipped, neither
 * bingbot nor Googlebot fetched a single one of them.
 *
 * So the hour the crawl finds nothing new is spent on them instead, a slice at
 * a time: the whole list comes round about once a day, which is also how often
 * the pages change, and no submission is ever large enough to be refused.
 */
export const placeSweep = (events: readonly CompactEvent[], cursor: number, size: number): Slice => {
  const all = cityFacetUrls(events);
  if (all.length === 0) return { urls: [], next: 0 };
  const start = ((cursor % all.length) + all.length) % all.length;
  const urls = [...all.slice(start), ...all.slice(0, start)].slice(0, size);
  return { urls, next: (start + urls.length) % all.length };
};
