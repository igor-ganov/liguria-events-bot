/**
 * Sources reuse one poster across several events: Teatro della Tosse hands
 * Gothica's artwork to "I lunedì nel parco", the free family cinema running
 * alongside it. The two are genuinely different events — one is a paid
 * immersive horror play, the other free open-air cinema — so the deduper must
 * NOT merge them. But on a map pin at the same venue they render as two
 * identical cards, which reads as a duplicate. Only the earliest event keeps a
 * shared poster; the others fall back to the category placeholder.
 */
import type { CompactEvent } from '../domain/event.ts';
import type { FetchFn } from '../collectors/types.ts';

/** Identity is the payload, not the URL: 2186_half.jpg and 2188_half.jpg are
 *  one 39974-byte JPEG. Nor is it the ETag — Apache derives it from the mtime,
 *  so identical bytes uploaded minutes apart carry different ETags. Size is a
 *  free first pass (HEAD); the bytes settle it, and only for a collision. */
const sizeOf = async (fetchFn: FetchFn, url: string): Promise<string | undefined> => {
  try {
    const response = await fetchFn(url, { method: 'HEAD' });
    return response.headers.get('content-length') ?? undefined;
  } catch {
    return undefined;
  }
};

const hashOf = async (fetchFn: FetchFn, url: string): Promise<string | undefined> => {
  try {
    const response = await fetchFn(url);
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
};

const venueKey = (event: CompactEvent): string => (event.v ?? '').trim().toLowerCase();

/** Events whose venue hosts more than one illustrated event — the only place a
 *  shared poster is visible as a duplicate, and the only place worth a fetch. */
const contested = (index: readonly CompactEvent[]): readonly CompactEvent[] => {
  const illustrated = index.filter((event) => event.img !== undefined && venueKey(event) !== '');
  const perVenue = illustrated.reduce(
    (counts, event) => counts.set(venueKey(event), (counts.get(venueKey(event)) ?? 0) + 1),
    new Map<string, number>(),
  );
  return illustrated.filter((event) => (perVenue.get(venueKey(event)) ?? 0) > 1);
};

type Keyed = Readonly<{ event: CompactEvent; key: string }>;

const groupByKey = (items: readonly Keyed[]): ReadonlyMap<string, readonly CompactEvent[]> =>
  items.reduce(
    (groups, item) => groups.set(item.key, [...(groups.get(item.key) ?? []), item.event]),
    new Map<string, readonly CompactEvent[]>(),
  );

// exactOptionalPropertyTypes: the key must go, not become `undefined`.
const withoutImage = ({ img, ...rest }: CompactEvent): CompactEvent => rest;

const earliest = (events: readonly CompactEvent[]): CompactEvent =>
  events.reduce((best, event) => (event.s < best.s || (event.s === best.s && event.id < best.id) ? event : best));

/** Same venue, same byte size — the only pairs worth downloading. */
const collisions = async (
  fetchFn: FetchFn,
  index: readonly CompactEvent[],
): Promise<readonly CompactEvent[]> => {
  const sized = await Promise.all(
    contested(index).map(async (event) => ({
      event,
      key: `${venueKey(event)}#${await sizeOf(fetchFn, event.img ?? '')}`,
    })),
  );
  return [...groupByKey(sized.filter((item) => !item.key.endsWith('#undefined'))).values()]
    .filter((group) => group.length > 1)
    .flat();
};

export const dropSharedArtwork = async (
  fetchFn: FetchFn,
  index: readonly CompactEvent[],
): Promise<readonly CompactEvent[]> => {
  const hashed = await Promise.all(
    (await collisions(fetchFn, index)).map(async (event) => ({
      event,
      key: `${venueKey(event)}#${await hashOf(fetchFn, event.img ?? '')}`,
    })),
  );
  const duplicates = [...groupByKey(hashed.filter((item) => !item.key.endsWith('#undefined'))).values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.filter((event) => event.id !== earliest(group).id));
  const stripped = new Set(duplicates.map((event) => event.id));
  return index.map((event) => (stripped.has(event.id) ? withoutImage(event) : event));
};
