/**
 * Domain model (design §2). An EventRecord is the canonical stored form of a
 * collected event; a CompactEvent is its index projection — one KV key holds
 * the whole upcoming corpus for cheap window queries.
 */
import {
  asArray,
  asBoolean,
  asNonEmptyString,
  asNumber,
  parseJson,
  readProp,
} from '../util/json.ts';

export const CATEGORIES = [
  'music',
  'theatre',
  'art',
  'food',
  'sport',
  'family',
  'market',
  'nightlife',
  'culture',
  'workshop',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: unknown): value is Category =>
  CATEGORIES.some((category) => category === value);

export type EventRecord = Readonly<{
  id: string;
  title: string;
  /** 'YYYY-MM-DD', Europe/Rome calendar date. */
  startDate: string;
  endDate?: string;
  /** 'HH:MM' when the source exposes it. */
  time?: string;
  venue?: string;
  address?: string;
  /** 1–3 categories, most specific first; [0] is the primary (AC-2.1). */
  categories: readonly Category[];
  /** Canonical 1–2 sentence English description (AC-2.2). */
  description: string;
  /** Poster/cover image from the source, when the listing exposes one. */
  image?: string;
  /** Links from other sources that resighted this event (AC-1.8). */
  altLinks?: readonly SourceLink[];
  rawDescription?: string;
  priceInfo?: string;
  free?: boolean;
  /** LLM-flagged offbeat / non-touristy "hidden gem" (AC-2.6). */
  unusual?: boolean;
  url: string;
  source: string;
  /** false → enrichment failed, retry next run (AC-2.3). */
  enriched: boolean;
  addedAt: number;
}>;

export type SourceLink = Readonly<{ source: string; url: string }>;

/** Index projection: t=title s=start e=end c=categories f=free v=venue
 *  h=time u=url img=image d=description l=alt links x=unusual/hidden-gem. */
export type CompactEvent = Readonly<{
  id: string;
  t: string;
  s: string;
  e?: string;
  c: readonly Category[];
  f?: boolean;
  v?: string;
  h?: string;
  u: string;
  img?: string;
  d?: string;
  l?: readonly SourceLink[];
  x?: boolean;
}>;

export const primaryCategory = (categories: readonly Category[]): Category =>
  categories[0] ?? 'other';

/** Raw event as produced by a collector, before dedupe and enrichment. */
export type RawEvent = Readonly<{
  title: string;
  startDate: string;
  endDate?: string;
  time?: string;
  venue?: string;
  address?: string;
  priceInfo?: string;
  rawDescription?: string;
  url: string;
  source: string;
  categoryHint?: Category;
  image?: string;
  /** Links of other sources that saw this event in the same run (AC-1.8). */
  altLinks?: readonly SourceLink[];
}>;

export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Dedupe key (AC-1.2): stable hash of normalized title + start date. */
export const eventIdOf = async (title: string, startDate: string): Promise<string> => {
  const bytes = new TextEncoder().encode(`${normalizeTitle(title)}|${startDate}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
};

export const freeFromPrice = (priceInfo: string | undefined): boolean =>
  priceInfo !== undefined &&
  /gratuit|ingresso libero|free entry|free admission|бесплатно/i.test(priceInfo);

const mergedAltLinks = (
  existing: EventRecord,
  incoming: RawEvent,
): Readonly<{ altLinks?: readonly SourceLink[] }> => {
  const next = unionLinks(
    existing.url,
    existing.altLinks,
    incoming.altLinks,
    [{ source: incoming.source, url: incoming.url }],
  );
  const changed = next.length !== (existing.altLinks ?? []).length;
  return changed && next.length > 0 ? { altLinks: next } : {};
};

/**
 * Merge a re-collected raw event into the stored record: fill gaps only,
 * never overwrite what we already know (AC-1.2).
 */
export const mergeEvent = (
  existing: EventRecord,
  incoming: RawEvent,
): Readonly<{ event: EventRecord; changed: boolean }> => {
  const event: EventRecord = {
    ...existing,
    ...(existing.endDate === undefined && incoming.endDate !== undefined
      ? { endDate: incoming.endDate }
      : {}),
    ...(existing.time === undefined && incoming.time !== undefined
      ? { time: incoming.time }
      : {}),
    ...(existing.venue === undefined && incoming.venue !== undefined
      ? { venue: incoming.venue }
      : {}),
    ...(existing.address === undefined && incoming.address !== undefined
      ? { address: incoming.address }
      : {}),
    ...(existing.priceInfo === undefined && incoming.priceInfo !== undefined
      ? { priceInfo: incoming.priceInfo, free: freeFromPrice(incoming.priceInfo) }
      : {}),
    ...(existing.rawDescription === undefined && incoming.rawDescription !== undefined
      ? { rawDescription: incoming.rawDescription }
      : {}),
    ...(existing.image === undefined && incoming.image !== undefined
      ? { image: incoming.image }
      : {}),
    // Other sources resighted this event → keep every link (AC-1.8).
    ...mergedAltLinks(existing, incoming),
  };
  const changed =
    event.endDate !== existing.endDate ||
    event.time !== existing.time ||
    event.venue !== existing.venue ||
    event.address !== existing.address ||
    event.priceInfo !== existing.priceInfo ||
    event.rawDescription !== existing.rawDescription ||
    event.image !== existing.image ||
    event.altLinks !== existing.altLinks;
  return { event, changed };
};

/** Union of source links, first-wins deduped by url, excluding `primaryUrl`. */
const unionLinks = (
  primaryUrl: string,
  ...groups: readonly (readonly SourceLink[] | undefined)[]
): readonly SourceLink[] =>
  groups
    .flatMap((group) => group ?? [])
    .reduce<readonly SourceLink[]>(
      (kept, link) =>
        link.url === primaryUrl || kept.some((existing) => existing.url === link.url)
          ? kept
          : [...kept, link],
      [],
    );

/** Merge two raw sightings of the same event within one run: first wins,
 *  gaps fill, and the second source's link is preserved (AC-1.8). */
export const mergeRaw = (first: RawEvent, second: RawEvent): RawEvent => {
  const altLinks = unionLinks(first.url, first.altLinks, second.altLinks, [
    { source: second.source, url: second.url },
  ]);
  return {
    ...second,
    ...first,
    ...(altLinks.length === 0 ? {} : { altLinks }),
  };
};

export const toCompact = (event: EventRecord): CompactEvent => ({
  id: event.id,
  t: event.title,
  s: event.startDate,
  c: event.categories,
  u: event.url,
  ...(event.endDate === undefined ? {} : { e: event.endDate }),
  ...(event.free === true ? { f: true } : {}),
  ...(event.venue === undefined ? {} : { v: event.venue }),
  ...(event.time === undefined ? {} : { h: event.time }),
  ...(event.image === undefined ? {} : { img: event.image }),
  ...(event.description === '' ? {} : { d: event.description }),
  ...(event.altLinks === undefined || event.altLinks.length === 0
    ? {}
    : { l: event.altLinks }),
  ...(event.unusual === true ? { x: true } : {}),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: string): boolean =>
  ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

/** Accepts the multi-category array AND the legacy single `category` field. */
const parseCategories = (value: unknown): readonly Category[] => {
  const many = (asArray(readProp(value, 'categories')) ?? []).filter(isCategory);
  const legacy = readProp(value, 'category');
  const fallback = isCategory(legacy) ? [legacy] : [];
  const merged = [...many, ...fallback];
  return merged.length === 0 ? ['other'] : merged.slice(0, 3);
};

const parseSourceLinks = (value: unknown): readonly SourceLink[] =>
  (asArray(value) ?? []).flatMap((item): readonly SourceLink[] => {
    const source = asNonEmptyString(readProp(item, 'source'));
    const url = asNonEmptyString(readProp(item, 'url'));
    return source === undefined || url === undefined ? [] : [{ source, url }];
  });

export const parseEventRecord = (text: string): EventRecord | undefined => {
  const value = parseJson(text);
  const id = asNonEmptyString(readProp(value, 'id'));
  const title = asNonEmptyString(readProp(value, 'title'));
  const startDate = asNonEmptyString(readProp(value, 'startDate'));
  const description = asNonEmptyString(readProp(value, 'description'));
  const url = asNonEmptyString(readProp(value, 'url'));
  const source = asNonEmptyString(readProp(value, 'source'));
  const enriched = asBoolean(readProp(value, 'enriched'));
  const addedAt = asNumber(readProp(value, 'addedAt'));
  if (
    id === undefined ||
    title === undefined ||
    startDate === undefined ||
    !isIsoDate(startDate) ||
    description === undefined ||
    url === undefined ||
    source === undefined ||
    enriched === undefined ||
    addedAt === undefined
  ) {
    return undefined;
  }
  const endDate = asNonEmptyString(readProp(value, 'endDate'));
  const time = asNonEmptyString(readProp(value, 'time'));
  const venue = asNonEmptyString(readProp(value, 'venue'));
  const address = asNonEmptyString(readProp(value, 'address'));
  const priceInfo = asNonEmptyString(readProp(value, 'priceInfo'));
  const rawDescription = asNonEmptyString(readProp(value, 'rawDescription'));
  const free = asBoolean(readProp(value, 'free'));
  const unusual = asBoolean(readProp(value, 'unusual'));
  const image = asNonEmptyString(readProp(value, 'image'));
  const altLinks = parseSourceLinks(readProp(value, 'altLinks'));
  return {
    id,
    title,
    startDate,
    categories: parseCategories(value),
    description,
    url,
    source,
    enriched,
    addedAt,
    ...(endDate === undefined ? {} : { endDate }),
    ...(time === undefined ? {} : { time }),
    ...(venue === undefined ? {} : { venue }),
    ...(address === undefined ? {} : { address }),
    ...(priceInfo === undefined ? {} : { priceInfo }),
    ...(rawDescription === undefined ? {} : { rawDescription }),
    ...(free === undefined ? {} : { free }),
    ...(unusual === undefined ? {} : { unusual }),
    ...(image === undefined ? {} : { image }),
    ...(altLinks.length === 0 ? {} : { altLinks }),
  };
};

/** `c` was a single category before the multi-category revision — accept both. */
const compactCategories = (value: unknown): readonly Category[] => {
  const many = (asArray(value) ?? []).filter(isCategory);
  const single = isCategory(value) ? [value] : [];
  const merged = [...many, ...single];
  return merged.length === 0 ? ['other'] : merged;
};

const parseCompact = (value: unknown): CompactEvent | undefined => {
  const id = asNonEmptyString(readProp(value, 'id'));
  const t = asNonEmptyString(readProp(value, 't'));
  const s = asNonEmptyString(readProp(value, 's'));
  const u = asNonEmptyString(readProp(value, 'u'));
  if (id === undefined || t === undefined || s === undefined || u === undefined) {
    return undefined;
  }
  const e = asNonEmptyString(readProp(value, 'e'));
  const f = asBoolean(readProp(value, 'f'));
  const v = asNonEmptyString(readProp(value, 'v'));
  const h = asNonEmptyString(readProp(value, 'h'));
  const img = asNonEmptyString(readProp(value, 'img'));
  const d = asNonEmptyString(readProp(value, 'd'));
  const l = parseSourceLinks(readProp(value, 'l'));
  const x = asBoolean(readProp(value, 'x'));
  return {
    id,
    t,
    s,
    c: compactCategories(readProp(value, 'c')),
    u,
    ...(e === undefined ? {} : { e }),
    ...(f === true ? { f: true } : {}),
    ...(v === undefined ? {} : { v }),
    ...(h === undefined ? {} : { h }),
    ...(img === undefined ? {} : { img }),
    ...(d === undefined ? {} : { d }),
    ...(l.length === 0 ? {} : { l }),
    ...(x === true ? { x: true } : {}),
  };
};

export const parseIndex = (text: string): readonly CompactEvent[] | undefined => {
  const value = asArray(parseJson(text));
  if (value === undefined) return undefined;
  return value.flatMap((item) => {
    const compact = parseCompact(item);
    return compact === undefined ? [] : [compact];
  });
};
