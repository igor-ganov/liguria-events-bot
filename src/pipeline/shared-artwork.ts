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

/** Byte-identity of the image without downloading it. Different URLs can serve
 *  the very same file (2186_half.jpg and 2188_half.jpg are one 39974-byte
 *  JPEG), so the URL is not the identity — the payload is. */
const artworkKey = async (fetchFn: FetchFn, url: string): Promise<string | undefined> => {
  try {
    const response = await fetchFn(url, { method: 'HEAD' });
    const length = response.headers.get('content-length');
    const etag = response.headers.get('etag');
    return length === null && etag === null ? undefined : `${length ?? ''}|${etag ?? ''}`;
  } catch {
    return undefined;
  }
};

const venueKey = (event: CompactEvent): string => (event.v ?? '').trim().toLowerCase();

/** Events whose venue hosts more than one illustrated event — the only place a
 *  shared poster is visible as a duplicate, and the only place worth a HEAD. */
const contested = (index: readonly CompactEvent[]): readonly CompactEvent[] => {
  const illustrated = index.filter((event) => event.img !== undefined && venueKey(event) !== '');
  const perVenue = illustrated.reduce(
    (counts, event) => counts.set(venueKey(event), (counts.get(venueKey(event)) ?? 0) + 1),
    new Map<string, number>(),
  );
  return illustrated.filter((event) => (perVenue.get(venueKey(event)) ?? 0) > 1);
};

// exactOptionalPropertyTypes: the key must go, not become `undefined`.
const withoutImage = ({ img, ...rest }: CompactEvent): CompactEvent => rest;

const earlier = (a: CompactEvent, b: CompactEvent): CompactEvent =>
  a.s < b.s || (a.s === b.s && a.id <= b.id) ? a : b;

export const dropSharedArtwork = async (
  fetchFn: FetchFn,
  index: readonly CompactEvent[],
): Promise<readonly CompactEvent[]> => {
  const keyed = await Promise.all(
    contested(index).map(async (event) => ({
      event,
      key: `${venueKey(event)}#${await artworkKey(fetchFn, event.img ?? '')}`,
    })),
  );
  const owner = keyed
    .filter((item) => !item.key.endsWith('#undefined'))
    .reduce(
      (owners, item) =>
        owners.set(item.key, earlier(owners.get(item.key) ?? item.event, item.event)),
      new Map<string, CompactEvent>(),
    );
  const stripped = new Set(
    keyed
      .filter((item) => {
        const keeper = owner.get(item.key);
        return keeper !== undefined && keeper.id !== item.event.id;
      })
      .map((item) => item.event.id),
  );
  return index.map((event) => (stripped.has(event.id) ? withoutImage(event) : event));
};
