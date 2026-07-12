/**
 * Coordinates for the map. Until now they were applied in bulk from outside
 * (/apply-translations), which only ever covered Genoa — a Milan event would
 * have landed in the feed with no pin. Nominatim resolves the address the
 * enrichment already produces.
 *
 * Nominatim's usage policy allows one request per second from one client, so a
 * run geocodes a bounded slice and the rest catch up on the next one. Every
 * lookup is cached in KV by address: a venue is geocoded once, ever.
 */
import type { KvLike } from './store.ts';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'dovego.it events bot (contact: public@dovego.it)';
const RATE_MS = 1100;

/** Enough to work through a fresh region over a few runs without ever nearing
 *  the request budget the crawl has left. */
const PER_RUN = 40;

export type Point = Readonly<{ lat: number; lng: number }>;
export type GeocodeFn = (address: string) => Promise<Point | undefined>;

const cacheKey = (address: string): string => `geo:${address.trim().toLowerCase()}`;

const parsePoint = (value: unknown): Point | undefined => {
  const first = Array.isArray(value) ? value[0] : undefined;
  const lat = Number((first as { lat?: string })?.lat);
  const lng = Number((first as { lon?: string })?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
};

const lookup = async (fetchFn: typeof fetch, address: string): Promise<Point | undefined> => {
  try {
    const url = `${ENDPOINT}?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(address)}`;
    const response = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
    return response.ok ? parsePoint(await response.json()) : undefined;
  } catch {
    return undefined;
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A cached, rate-limited geocoder. A miss is cached too (as ''), so a venue
 *  Nominatim cannot place is not retried on every single run. */
export const makeGeocoder =
  (kv: KvLike, fetchFn: typeof fetch): GeocodeFn =>
  async (address: string): Promise<Point | undefined> => {
    const key = cacheKey(address);
    const cached = await kv.get(key);
    if (cached !== null) {
      const parsed: unknown = cached === '' ? undefined : JSON.parse(cached);
      return parsed === undefined ? undefined : (parsed as Point);
    }
    const point = await lookup(fetchFn, address);
    await kv.put(key, point === undefined ? '' : JSON.stringify(point));
    return point;
  };

export type Locatable = Readonly<{ id: string; address?: string; lat?: number; lng?: number }>;

/** Coordinates for the events that still lack them, newest addresses first.
 *  Serial by design — the policy is one request per second, not per run. */
export const geocodeMissing = async (
  geocode: GeocodeFn,
  events: readonly Locatable[],
): Promise<ReadonlyMap<string, Point>> => {
  const pending = events
    .filter((event) => event.lat === undefined || event.lng === undefined)
    .filter((event) => (event.address ?? '') !== '')
    .slice(0, PER_RUN);
  const found = new Map<string, Point>();
  for (const [index, event] of pending.entries()) {
    if (index > 0) await sleep(RATE_MS);
    const point = await geocode(event.address ?? '');
    if (point !== undefined) found.set(event.id, point);
  }
  return found;
};
