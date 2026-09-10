import { ALL_CITIES } from '../domain/city.ts';
import { ALL_REGIONS } from '../domain/region.ts';
import type { CompactEvent } from '../domain/event.ts';

/**
 * Where a reader wants to be told about.
 *
 * Stored as one string so it says what it is: `city:genova`, `region:liguria`,
 * or empty for the whole country. The slugs are the ones the crawler files
 * events under, so a setting can never name a place the index cannot answer.
 */
export const isPlace = (value: unknown): value is string =>
  typeof value === 'string' &&
  (value === '' ||
    ALL_CITIES.some((city) => value === `city:${city.slug}`) ||
    ALL_REGIONS.some((region) => value === `region:${region.slug}`));

/** The events that happen in the chosen place. An empty choice is the whole
 *  country, including events the geocoder never placed — hiding those would
 *  cost a reader a real event over a gap of ours. */
export const eventsInPlace = (
  index: readonly CompactEvent[],
  place: string,
): readonly CompactEvent[] => {
  if (place === '') return index;
  const [kind, slug] = [place.slice(0, place.indexOf(':')), place.slice(place.indexOf(':') + 1)];
  return index.filter((event) => (kind === 'city' ? event.ct : event.rg) === slug);
};
