/**
 * Coordinates for the map — a pass of its own, not a step of the crawl.
 *
 * It used to run inside runCollect, and that was wrong three ways. It resolved
 * a city centre per event in parallel, which put hundreds of concurrent writes
 * on one KV key (KV allows one per second) until KV answered 429 and killed the
 * entire crawl. It budgeted by event, though events share venues — 490 events
 * are ~150 distinct addresses. And it made a slow, rate-limited third-party
 * lookup a load-bearing part of collecting, so Nominatim having a bad minute
 * meant no events at all.
 *
 * So: city centres are a static table (domain/city-centres). We resolve
 * distinct ADDRESSES, cached in KV one key per address — distinct keys, no
 * write contention. The pass runs after the index is committed, under a wall
 * clock budget, and whatever it does not reach this run it reaches the next.
 * It cannot fail the crawl, because the crawl is already done.
 */
import { centreOfCity } from '../domain/city-centres.ts';
import { cityNameOf } from '../domain/city.ts';
import { toCompact } from '../domain/event.ts';
import type { CompactEvent } from '../domain/event.ts';
import { readEventRecord, readIndex, writeEventRecord, writeIndex } from './store.ts';
import type { KvLike } from './store.ts';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'dovego.it events bot (contact: public@dovego.it)';

/** Nominatim's usage policy: at most one request a second from one client. */
const RATE_MS = 1100;

/** Half-width of the search box around the city, in degrees (~70 km). */
const BOX = 0.7;

/** An address resolving further than this from its own city is not that city's
 *  address — it is a name collision elsewhere in Italy. */
const MAX_KM = 90;

export type Point = Readonly<{ lat: number; lng: number }>;

export type GeocodeSummary = Readonly<{
  pending: number;
  resolved: number;
  cleared: number;
  missed: number;
  durationMs: number;
}>;

/** Great-circle distance — enough to tell "same city" from "wrong city". */
export const distanceKm = (a: Point, b: Point): number => {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

const centreOf = (city: string): Point | undefined => {
  const pair = centreOfCity(city);
  return pair === undefined ? undefined : { lat: pair[0], lng: pair[1] };
};

/** A point that cannot belong to the city it is filed under is worse than no
 *  point: it plants a pin in the wrong town and drags the map's opening bounds
 *  across the country. */
export const misplaced = (city: string, point: Point): boolean => {
  const centre = centreOf(city);
  return centre !== undefined && distanceKm(centre, point) > MAX_KM;
};

/** What we can hand Nominatim. The enrichment's address when there is one;
 *  otherwise the venue plus the city — for a village sagra the comune IS the
 *  right precision, and waiting for the LLM to get around to the event would
 *  leave it off the map for days. */
export const addressOf = (event: CompactEvent): string | undefined => {
  const city = cityNameOf(event.ct ?? 'genova');
  const fallback =
    event.v === undefined || city === undefined ? undefined : `${event.v}, ${city}, Italia`;
  return event.a ?? fallback;
};

export const needsPoint = (event: CompactEvent): boolean => {
  const city = event.ct ?? 'genova';
  if (addressOf(event) === undefined) return false;
  return event.g === undefined || misplaced(city, { lat: event.g[0], lng: event.g[1] });
};

// Versioned: a cached miss is never retried, so improving the lookup means
// giving every address that missed under the old one a fresh chance.
const addressKey = (city: string, address: string): string =>
  `geo2:${city}:${address.trim().toLowerCase()}`;

const parsePoint = (value: unknown): Point | undefined => {
  const first = Array.isArray(value) ? value[0] : undefined;
  const lat = Number((first as { lat?: string })?.lat);
  const lng = Number((first as { lon?: string })?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
};

const viewbox = (centre: Point): Record<string, string> => ({
  viewbox: [centre.lng - BOX, centre.lat + BOX, centre.lng + BOX, centre.lat - BOX].join(','),
  bounded: '1',
});

const query = async (
  fetchFn: typeof fetch,
  params: Record<string, string>,
): Promise<Point | undefined> => {
  const search = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'it', ...params });
  try {
    const response = await fetchFn(`${ENDPOINT}?${search.toString()}`, {
      headers: { 'user-agent': USER_AGENT },
    });
    return response.ok ? parsePoint(await response.json()) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Anchored to the city, in two stages. A box around the city with bounded=1 is
 * the safe question, but it is also a strict one — it misses whenever the venue
 * name does not match a feature inside the box. So a miss falls back to the
 * open question and simply refuses an answer that lands in the wrong city: the
 * distance check is what keeps "Città Vecchia, Genova" from becoming Trieste,
 * not the box.
 */
const lookup = async (
  fetchFn: typeof fetch,
  address: string,
  city: string,
): Promise<Point | undefined> => {
  const centre = centreOf(city);
  const boxed =
    centre === undefined ? undefined : await query(fetchFn, { q: address, ...viewbox(centre) });
  if (boxed !== undefined) return boxed;
  await sleep(RATE_MS);
  const open = await query(fetchFn, { q: address });
  return open !== undefined && !misplaced(city, open) ? open : undefined;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type GeocodeDeps = Readonly<{
  kv: KvLike;
  fetchFn: typeof fetch;
  now: () => number;
  /** Wall clock this pass may spend. What it misses, the next run picks up. */
  budgetMs: number;
}>;

type Job = Readonly<{ city: string; address: string; ids: readonly string[] }>;

/** Distinct addresses, each carrying the events waiting on it. */
export const pendingJobs = (index: readonly CompactEvent[]): readonly Job[] => {
  const byAddress = index.filter(needsPoint).reduce((jobs, event) => {
    const city = event.ct ?? 'genova';
    const address = addressOf(event) ?? '';
    const key = addressKey(city, address);
    const job = jobs.get(key);
    return jobs.set(key, {
      city,
      address,
      ids: [...(job?.ids ?? []), event.id],
    });
  }, new Map<string, Job>());
  return [...byAddress.values()];
};

const resolveJob = async (deps: GeocodeDeps, job: Job): Promise<Point | undefined> => {
  const key = addressKey(job.city, job.address);
  const cachedValue = await deps.kv.get(key);
  // A miss is cached as '' as well, so an unplaceable venue is not retried on
  // every run for the rest of its life.
  if (cachedValue !== null) {
    return cachedValue === '' ? undefined : (JSON.parse(cachedValue) as Point);
  }
  const point = await lookup(deps.fetchFn, job.address, job.city);
  await deps.kv.put(key, point === undefined ? '' : JSON.stringify(point));
  await sleep(RATE_MS);
  return point;
};

/** Write the point onto the record (or erase a wrong one) and return the fresh
 *  index projection. */
const applyPoint = async (
  deps: GeocodeDeps,
  id: string,
  point: Point | undefined,
): Promise<CompactEvent | undefined> => {
  const record = await readEventRecord(deps.kv, id);
  if (record === undefined) return undefined;
  const { lat: _lat, lng: _lng, ...rest } = record;
  const next = point === undefined ? rest : { ...rest, lat: point.lat, lng: point.lng };
  await writeEventRecord(deps.kv, next, deps.now());
  return toCompact(next);
};

export const runGeocode = async (deps: GeocodeDeps): Promise<GeocodeSummary> => {
  const startedAt = deps.now();
  const index = await readIndex(deps.kv);
  const jobs = pendingJobs(index);
  const hadPoint = new Set(index.filter((event) => event.g !== undefined).map((e) => e.id));
  const patched = new Map<string, CompactEvent>();
  let resolved = 0;
  let missed = 0;

  for (const job of jobs) {
    if (deps.now() - startedAt > deps.budgetMs) break;
    const point = await resolveJob(deps, job);
    for (const id of job.ids) {
      const next = await applyPoint(deps, id, point);
      if (next !== undefined) patched.set(id, next);
    }
    if (point === undefined) missed += 1;
    else resolved += 1;
  }
  // Only a point we actually took away counts as cleared — an event that never
  // had one has not lost anything.
  const cleared = [...patched.values()].filter(
    (event) => event.g === undefined && hadPoint.has(event.id),
  ).length;

  if (patched.size > 0) {
    await writeIndex(
      deps.kv,
      index.map((event) => patched.get(event.id) ?? event),
    );
  }
  return {
    pending: jobs.length,
    resolved,
    cleared,
    missed,
    durationMs: deps.now() - startedAt,
  };
};
