/**
 * portoantico.it collector (design §4.5). The HTML site has no listing page,
 * but WordPress exposes an open REST API with an `eventi` custom post type
 * (verified 2026-07-02: ~1500 records, newest first). Event date/time live in
 * the post body text ("Martedì 21 luglio 2026 – ore 21.30"); the venue is a
 * `location-eventi` taxonomy term resolved via a second request.
 */
import type { RawEvent } from '../domain/event.ts';
import { decodeEntities, parseItalianDateInfo } from './italian-dates.ts';
import type { CollectOutcome, Collector, FetchFn } from './types.ts';
import { asArray, asNonEmptyString, asNumber, parseJson, readProp } from '../util/json.ts';

export const PORTOANTICO_SOURCE = 'portoantico';
const API_BASE = 'https://portoantico.it/wp-json/wp/v2';
const EVENTS_URL =
  `${API_BASE}/eventi?per_page=50&orderby=date&order=desc` +
  '&_fields=title,link,content,location-eventi';
const LOCATIONS_URL = `${API_BASE}/location-eventi?per_page=100&_fields=id,name`;
const USER_AGENT = 'Mozilla/5.0 (compatible; event-collecter/0.0)';
const DESCRIPTION_CAP = 400;

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, ' '));

const IMG_SRC = /<img[^>]+src="(https?:[^"]+)"/;

const firstImage = (html: string): string | undefined => IMG_SRC.exec(html)?.[1];

export const parseLocations = (payload: unknown): ReadonlyMap<number, string> =>
  new Map(
    (asArray(payload) ?? []).flatMap((term): readonly (readonly [number, string])[] => {
      const id = asNumber(readProp(term, 'id'));
      const name = asNonEmptyString(readProp(term, 'name'));
      return id === undefined || name === undefined ? [] : [[id, decodeEntities(name)]];
    }),
  );

export const parsePortoanticoPosts = (
  payload: unknown,
  locations: ReadonlyMap<number, string>,
): readonly RawEvent[] =>
  (asArray(payload) ?? []).flatMap((post): readonly RawEvent[] => {
    const title = asNonEmptyString(readProp(readProp(post, 'title'), 'rendered'));
    const link = asNonEmptyString(readProp(post, 'link'));
    const contentHtml = asNonEmptyString(readProp(readProp(post, 'content'), 'rendered'));
    if (title === undefined || link === undefined || contentHtml === undefined) return [];
    const text = stripTags(contentHtml);
    // The first dated line in the body is the event header; posts without a
    // parseable date (venue presentations, press notes) are skipped.
    const info = parseItalianDateInfo(text);
    if (info === undefined) return [];
    const locationId = asNumber((asArray(readProp(post, 'location-eventi')) ?? [])[0]);
    const venue = locationId === undefined ? undefined : locations.get(locationId);
    const image = firstImage(contentHtml);
    return [
      {
        title: decodeEntities(title),
        startDate: info.startDate,
        url: link,
        source: PORTOANTICO_SOURCE,
        rawDescription: text.slice(0, DESCRIPTION_CAP).trim(),
        ...(info.endDate === undefined ? {} : { endDate: info.endDate }),
        ...(info.time === undefined ? {} : { time: info.time }),
        ...(venue === undefined ? {} : { venue }),
        ...(image === undefined ? {} : { image }),
      },
    ];
  });

const fetchJson = async (fetchFn: FetchFn, url: string): Promise<unknown> => {
  const response = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) return undefined;
  return parseJson(await response.text());
};

export const makePortoanticoCollector =
  (fetchFn: FetchFn): Collector =>
  async (): Promise<CollectOutcome> => {
    try {
      const [posts, locationTerms] = await Promise.all([
        fetchJson(fetchFn, EVENTS_URL),
        fetchJson(fetchFn, LOCATIONS_URL),
      ]);
      if (posts === undefined) {
        return { source: PORTOANTICO_SOURCE, events: [], posts: [], failed: true };
      }
      const events = parsePortoanticoPosts(posts, parseLocations(locationTerms));
      return { source: PORTOANTICO_SOURCE, events, posts: [], failed: false };
    } catch {
      return { source: PORTOANTICO_SOURCE, events: [], posts: [], failed: true };
    }
  };
