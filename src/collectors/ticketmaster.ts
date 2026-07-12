/**
 * Ticketmaster Discovery API — the one source that reaches every Italian region
 * at once. TicketOne, Italy's dominant ticketing company, is Ticketmaster's, so
 * its concerts, theatre, sport and festivals come through here.
 *
 * Unlike every scraped source, it answers in JSON and hands us the venue's
 * COORDINATES: these events never touch the geocoder. It gives no province, but
 * the comune's point resolves to the nearest province capital, and the region it
 * rolls up to is right regardless (Assago -> Milano -> Lombardia).
 *
 * Free key, 5 requests/second, and deep paging is capped at 1000 results — so
 * the crawl walks pages of 200 until it has them or the cap stops it.
 */
import { nearestCity } from '../domain/city-centres.ts';
import { citySlug } from '../domain/city.ts';
import { centreOfCity } from '../domain/city-centres.ts';
import type { Category, RawEvent } from '../domain/event.ts';
import { asArray, asNonEmptyString, asNumber, readProp } from '../util/json.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

export const TICKETMASTER_SOURCE = 'ticketmaster';
const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
const PAGE_SIZE = 200;
/** Discovery refuses page*size beyond 1000, whatever the total says. */
const MAX_PAGES = 5;

/** Their top-level segment is close enough to our categories to seed one; the
 *  LLM refines it during enrichment like every other source's hint. */
const SEGMENTS: Readonly<Record<string, Category>> = {
  Music: 'music',
  'Arts & Theatre': 'theatre',
  Sports: 'sport',
  Film: 'culture',
  Miscellaneous: 'other',
};

// Without a start filter the API answers from the beginning of its calendar —
// hundreds of events that have already happened, eating the 1000-result cap
// before a single upcoming one appears.
const pageUrl = (key: string, page: number, today: string): string =>
  `${ENDPOINT}?${new URLSearchParams({
    countryCode: 'IT',
    size: String(PAGE_SIZE),
    page: String(page),
    sort: 'date,asc',
    startDateTime: `${today}T00:00:00Z`,
    apikey: key,
  }).toString()}`;

/** The widest image they offer — the listing gets a cover worth showing. */
const coverOf = (event: unknown): string | undefined => {
  const images = asArray(readProp(event, 'images')) ?? [];
  const widest = images
    .map((image) => ({
      url: asNonEmptyString(readProp(image, 'url')),
      width: asNumber(readProp(image, 'width')) ?? 0,
    }))
    .filter((image) => image.url !== undefined)
    .toSorted((a, b) => b.width - a.width)[0];
  return widest?.url;
};

const priceOf = (event: unknown): string | undefined => {
  const range = (asArray(readProp(event, 'priceRanges')) ?? [])[0];
  const min = asNumber(readProp(range, 'min'));
  const max = asNumber(readProp(range, 'max'));
  const currency = asNonEmptyString(readProp(range, 'currency')) ?? 'EUR';
  if (min === undefined) return undefined;
  return max === undefined || max === min
    ? `${min} ${currency}`
    : `${min}–${max} ${currency}`;
};

const categoryOf = (event: unknown): Category | undefined => {
  const classification = (asArray(readProp(event, 'classifications')) ?? [])[0];
  const segment = asNonEmptyString(readProp(readProp(classification, 'segment'), 'name')) ?? '';
  return SEGMENTS[segment];
};

export const parseTicketmasterEvent = (event: unknown): readonly RawEvent[] => {
  const title = asNonEmptyString(readProp(event, 'name'));
  const url = asNonEmptyString(readProp(event, 'url'));
  const dates = readProp(event, 'dates');
  const start = readProp(dates, 'start');
  const startDate = asNonEmptyString(readProp(start, 'localDate'));
  const endDate = asNonEmptyString(readProp(readProp(dates, 'end'), 'localDate'));
  const localTime = asNonEmptyString(readProp(start, 'localTime'));

  const venue = (asArray(readProp(readProp(event, '_embedded'), 'venues')) ?? [])[0];
  const venueName = asNonEmptyString(readProp(venue, 'name'));
  const comune = asNonEmptyString(readProp(readProp(venue, 'city'), 'name'));
  const line1 = asNonEmptyString(readProp(readProp(venue, 'address'), 'line1'));
  const location = readProp(venue, 'location');
  const lat = Number(asNonEmptyString(readProp(location, 'latitude')) ?? NaN);
  const lng = Number(asNonEmptyString(readProp(location, 'longitude')) ?? NaN);
  // Some venues carry a 0,0 placeholder — a point in the Gulf of Guinea is not
  // a coordinate, it is a missing one.
  const located = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  // No coordinates (or a 0,0 placeholder — a point in the Gulf of Guinea is a
  // missing coordinate, not a coordinate): fall back to the comune's name, which
  // is a capital often enough to be worth trying. Neither → the event has no
  // region, and an event with no region has nowhere to be shown.
  const named = comune === undefined ? undefined : citySlug(comune);
  const byName = named !== undefined && centreOfCity(named) !== undefined ? named : undefined;
  const city = located ? nearestCity(lat, lng) : byName;
  const category = categoryOf(event);
  const image = coverOf(event);
  const price = priceOf(event);

  if (title === undefined || url === undefined || startDate === undefined) return [];
  if (city === undefined) return [];
  return [
    {
      title,
      startDate,
      url,
      source: TICKETMASTER_SOURCE,
      ...(endDate === undefined || endDate < startDate ? {} : { endDate }),
      ...(localTime === undefined ? {} : { time: localTime.slice(0, 5) }),
      ...(venueName === undefined ? {} : { venue: venueName }),
      ...(city === undefined ? {} : { city }),
      ...(located ? { lat, lng } : {}),
      ...(venueName === undefined || comune === undefined
        ? {}
        : { address: [venueName, line1, comune].filter(Boolean).join(', ') }),
      ...(category === undefined ? {} : { categoryHint: category }),
      ...(image === undefined ? {} : { image }),
      ...(price === undefined ? {} : { priceInfo: price }),
    },
  ];
};

const parsePage = async (response: Response): Promise<readonly RawEvent[]> => {
  const body: unknown = await response.json();
  const events = asArray(readProp(readProp(body, '_embedded'), 'events')) ?? [];
  return events.flatMap(parseTicketmasterEvent);
};

export const makeTicketmasterCollector =
  (fetchFn: FetchFn, apiKey: string, today: () => string): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const from = today();
      const pages = await Promise.all(
        Array.from({ length: MAX_PAGES }, (_, page) => page).map(async (page) => {
          const response = await fetchFn(pageUrl(apiKey, page, from));
          return response.ok ? parsePage(response) : [];
        }),
      );
      return { source: TICKETMASTER_SOURCE, events: pages.flat(), posts: [], failed: false };
    } catch {
      return { source: TICKETMASTER_SOURCE, events: [], posts: [], failed: true };
    }
  };
