import { ALL_CITIES } from './city.ts';
import { regionOfCity } from './region.ts';

/** Every city the site recognises, grouped by the region it belongs to. */
export type PlaceIndex = Readonly<Record<string, readonly string[]>>;

/**
 * The canonical places, independent of whether anything is on in them.
 *
 * The site used to derive its cities from the events it held, so a provincial
 * capital with nothing on this week had no page at all and answered 404 — the
 * site telling a visitor that Savona does not exist. This table is what the
 * crawler files events under, which makes it the definition of a city here, and
 * publishing it keeps one source of truth rather than two that drift.
 */
export const placeIndex = (): PlaceIndex =>
  ALL_CITIES.reduce<Record<string, string[]>>((byRegion, city) => {
    const region = regionOfCity(city.slug)?.slug;
    return region === undefined
      ? byRegion
      : { ...byRegion, [region]: [...(byRegion[region] ?? []), city.slug].sort() };
  }, {});
