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
  category: Category;
  /** Canonical 1–2 sentence English description (AC-2.2). */
  description: string;
  rawDescription?: string;
  priceInfo?: string;
  free?: boolean;
  url: string;
  source: string;
  /** false → enrichment failed, retry next run (AC-2.3). */
  enriched: boolean;
  addedAt: number;
}>;

/** Index projection: t=title s=start e=end c=category f=free v=venue h=time u=url. */
export type CompactEvent = Readonly<{
  id: string;
  t: string;
  s: string;
  e?: string;
  c: Category;
  f?: boolean;
  v?: string;
  h?: string;
  u: string;
}>;

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
  };
  const changed =
    event.endDate !== existing.endDate ||
    event.time !== existing.time ||
    event.venue !== existing.venue ||
    event.address !== existing.address ||
    event.priceInfo !== existing.priceInfo ||
    event.rawDescription !== existing.rawDescription;
  return { event, changed };
};

/** Merge two raw sightings of the same event within one run: first wins, gaps fill. */
export const mergeRaw = (first: RawEvent, second: RawEvent): RawEvent => ({
  ...second,
  ...first,
});

export const toCompact = (event: EventRecord): CompactEvent => ({
  id: event.id,
  t: event.title,
  s: event.startDate,
  c: event.category,
  u: event.url,
  ...(event.endDate === undefined ? {} : { e: event.endDate }),
  ...(event.free === true ? { f: true } : {}),
  ...(event.venue === undefined ? {} : { v: event.venue }),
  ...(event.time === undefined ? {} : { h: event.time }),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: string): boolean =>
  ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

export const parseEventRecord = (text: string): EventRecord | undefined => {
  const value = parseJson(text);
  const id = asNonEmptyString(readProp(value, 'id'));
  const title = asNonEmptyString(readProp(value, 'title'));
  const startDate = asNonEmptyString(readProp(value, 'startDate'));
  const category = readProp(value, 'category');
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
    !isCategory(category) ||
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
  return {
    id,
    title,
    startDate,
    category,
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
  };
};

const parseCompact = (value: unknown): CompactEvent | undefined => {
  const id = asNonEmptyString(readProp(value, 'id'));
  const t = asNonEmptyString(readProp(value, 't'));
  const s = asNonEmptyString(readProp(value, 's'));
  const c = readProp(value, 'c');
  const u = asNonEmptyString(readProp(value, 'u'));
  if (id === undefined || t === undefined || s === undefined || !isCategory(c) || u === undefined) {
    return undefined;
  }
  const e = asNonEmptyString(readProp(value, 'e'));
  const f = asBoolean(readProp(value, 'f'));
  const v = asNonEmptyString(readProp(value, 'v'));
  const h = asNonEmptyString(readProp(value, 'h'));
  return {
    id,
    t,
    s,
    c,
    u,
    ...(e === undefined ? {} : { e }),
    ...(f === true ? { f: true } : {}),
    ...(v === undefined ? {} : { v }),
    ...(h === undefined ? {} : { h }),
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
