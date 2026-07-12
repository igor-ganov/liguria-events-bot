/**
 * A collector for any page that publishes schema.org Events as JSON-LD.
 *
 * Most Italian sites hand-roll their markup and have to be scraped selector by
 * selector, which is a new collector per site. Some publish the events as data
 * — visitlazio.com carries 621 of them, complete with dates, place, price and a
 * cover — and for those the parser is the same one every time. So: one parser,
 * a list of pages, and a new site costs a line rather than a file.
 *
 * The place is what files an event: Italian listings write it as
 * "Monte Terminillo (RI)", and the province code is the whole city dimension.
 * Where a page cannot say which province an event is in, we take the site's own
 * region as the fallback — a regional tourism board is not going to be wrong
 * about its region — but never a default: an event we cannot place is dropped.
 */
import { cityOfProvince } from '../domain/city.ts';
import type { RawEvent } from '../domain/event.ts';
import { asArray, asNonEmptyString, readProp } from '../util/json.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export type JsonLdSite = Readonly<{
  /** Source label the events are stored under. */
  source: string;
  url: string;
  /** The city an event falls back to when its place names no province — the
   *  capital of the region the site covers. */
  fallbackCity: string;
}>;

/** JSON-LD arrives as one script per event, or as a graph, or as an array. */
const eventsIn = (value: unknown): readonly unknown[] => {
  const graph = asArray(readProp(value, '@graph'));
  const items = asArray(value) ?? graph ?? [value];
  return items.filter((item) => String(readProp(item, '@type') ?? '').includes('Event'));
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** schema.org dates may carry a time ("2026-07-10T21:00") — the calendar day is
 *  what the corpus is keyed by. */
const day = (value: string | undefined): string | undefined => value?.slice(0, 10);

const timeOf = (value: string | undefined): string | undefined => {
  const match = value?.match(/T(\d{2}:\d{2})/);
  return match?.[1];
};

/** "Monte Terminillo (RI)" → the venue and the province that files it. */
const placeOf = (name: string | undefined): Readonly<{ venue?: string; city?: string }> => {
  const match = name?.match(/^\s*(.*?)\s*\(([A-Z]{2})\)\s*$/);
  const city = cityOfProvince(match?.[2] ?? '')?.slug;
  const venue = (match?.[1] ?? name)?.trim();
  return {
    ...(venue === undefined || venue === '' ? {} : { venue }),
    ...(city === undefined ? {} : { city }),
  };
};

const imageOf = (event: unknown): string | undefined => {
  const image = readProp(event, 'image');
  return asNonEmptyString(image) ?? asNonEmptyString(readProp(image, 'url'));
};

const urlOf = (event: unknown): string | undefined =>
  asNonEmptyString(readProp(event, 'url')) ??
  asNonEmptyString(readProp(readProp(event, 'offers'), 'url'));

const priceOf = (event: unknown): string | undefined => {
  const offers = readProp(event, 'offers');
  const price = asNonEmptyString(readProp(offers, 'price'));
  const currency = asNonEmptyString(readProp(offers, 'priceCurrency')) ?? 'EUR';
  if (price === undefined) return undefined;
  return price === '0' ? 'Ingresso libero' : `${price} ${currency}`;
};

export const parseJsonLdEvent = (event: unknown, site: JsonLdSite): readonly RawEvent[] => {
  const title = asNonEmptyString(readProp(event, 'name'));
  const startDate = day(asNonEmptyString(readProp(event, 'startDate')));
  const endDate = day(asNonEmptyString(readProp(event, 'endDate')));
  const url = urlOf(event);
  const place = placeOf(asNonEmptyString(readProp(readProp(event, 'location'), 'name')));
  const description = asNonEmptyString(readProp(event, 'description'));
  const image = imageOf(event);
  const price = priceOf(event);
  const time = timeOf(asNonEmptyString(readProp(event, 'startDate')));
  const city = place.city ?? site.fallbackCity;

  if (title === undefined || startDate === undefined || url === undefined) return [];
  return [
    {
      title,
      startDate,
      url,
      source: site.source,
      city,
      ...(endDate === undefined || endDate < startDate ? {} : { endDate }),
      ...(time === undefined ? {} : { time }),
      ...(place.venue === undefined ? {} : { venue: place.venue }),
      ...(description === undefined ? {} : { rawDescription: description.slice(0, 800) }),
      ...(image === undefined ? {} : { image }),
      ...(price === undefined ? {} : { priceInfo: price }),
    },
  ];
};

/**
 * A run of the same event, one JSON-LD block per day it is on, collapsed into
 * the one event it is. visitlazio publishes "Sapori della Maremma a Pescia"
 * twenty-five times — once per day of its run — and taken literally that is
 * twenty-five events in the feed. They share a url, which is what says they are
 * one thing; the dates they carry are its span.
 */
export const collapseRuns = (events: readonly RawEvent[]): readonly RawEvent[] => {
  const byUrl = events.reduce((runs, event) => {
    const first = runs.get(event.url);
    if (first === undefined) return runs.set(event.url, event);
    const startDate = event.startDate < first.startDate ? event.startDate : first.startDate;
    const firstEnd = first.endDate ?? first.startDate;
    const nextEnd = event.endDate ?? event.startDate;
    const endDate = firstEnd > nextEnd ? firstEnd : nextEnd;
    return runs.set(event.url, {
      ...first,
      startDate,
      ...(endDate === startDate ? {} : { endDate }),
    });
  }, new Map<string, RawEvent>());
  return [...byUrl.values()];
};

const SCRIPT = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export const parseJsonLdHtml = (html: string, site: JsonLdSite): readonly RawEvent[] =>
  collapseRuns(
    [...html.matchAll(SCRIPT)]
      .flatMap((match) => eventsIn(parseJson(match[1] ?? '')))
      .flatMap((event) => parseJsonLdEvent(event, site)),
  );

export const makeJsonLdCollector =
  (fetchFn: FetchFn, site: JsonLdSite): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const response = await fetchFn(site.url, { headers: { 'user-agent': USER_AGENT } });
      if (!response.ok) return { source: site.source, events: [], posts: [], failed: true };
      const events = parseJsonLdHtml(await response.text(), site);
      return { source: site.source, events, posts: [], failed: false };
    } catch {
      return { source: site.source, events: [], posts: [], failed: true };
    }
  };
