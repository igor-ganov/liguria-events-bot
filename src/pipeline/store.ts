/**
 * KV storage layer (design §3). One compact index key serves every browse and
 * Q&A read; full records live per-id with a TTL that outlives the event by
 * three days (AC-1.5).
 */
import { parseEventRecord, parseIndex } from '../domain/event.ts';
import type { CompactEvent, EventRecord } from '../domain/event.ts';
import { asArray, parseJson } from '../util/json.ts';

export type KvListResult = Readonly<{
  keys: readonly Readonly<{ name: string }>[];
  list_complete: boolean;
  cursor?: string;
}>;

/** Structural subset of KVNamespace — lets tests plug an in-memory stub. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: Readonly<{ expirationTtl?: number }>,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: Readonly<{ prefix: string; cursor?: string }>): Promise<KvListResult>;
}

const INDEX_KEY = 'events:index';
const RUNLOG_KEY = 'runlog';
const LOCK_KEY = 'lock:collect';
const RUNLOG_CAP = 20;
// Short enough that a run killed mid-flight (e.g. slow LLM fallback exceeding
// the waitUntil budget) self-heals in a few minutes instead of blocking the
// next collection for 10.
export const LOCK_TTL_SECONDS = 180;

export const eventKey = (id: string): string => `event:${id}`;

/** The archived copy of a record, read only when the working one has expired. */
export const archiveKey = (id: string): string => `archive:${id}`;

export const readIndex = async (kv: KvLike): Promise<readonly CompactEvent[]> => {
  const raw = await kv.get(INDEX_KEY);
  if (raw === null) return [];
  return parseIndex(raw) ?? [];
};

/** List every stored EventRecord by scanning `event:` keys — used to rebuild
 *  a lost index without re-collecting (and without clobbering enrichment). */
export const readAllRecords = async (kv: KvLike): Promise<readonly EventRecord[]> => {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({
      prefix: 'event:',
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const key of page.keys) ids.push(key.name.slice('event:'.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
  const records = await Promise.all(ids.map((id) => readEventRecord(kv, id)));
  return records.flatMap((record) => (record === undefined ? [] : [record]));
};

export const writeIndex = async (
  kv: KvLike,
  index: readonly CompactEvent[],
): Promise<void> => kv.put(INDEX_KEY, JSON.stringify(index));

export const readEventRecord = async (
  kv: KvLike,
  id: string,
): Promise<EventRecord | undefined> => {
  const raw = await kv.get(eventKey(id));
  return raw === null ? undefined : parseEventRecord(raw);
};

export const readEventRecords = async (
  kv: KvLike,
  ids: readonly string[],
): Promise<readonly EventRecord[]> => {
  const records = await Promise.all(ids.map((id) => readEventRecord(kv, id)));
  return records.flatMap((record) => (record === undefined ? [] : [record]));
};

const DAY_SECONDS = 86_400;

/** Seconds until three days past the event's last day — the record's TTL. */
export const recordTtlSeconds = (event: EventRecord, nowMs: number): number => {
  const lastDay = event.endDate ?? event.startDate;
  const expiresAtMs = Date.parse(`${lastDay}T23:59:59Z`) + 3 * DAY_SECONDS * 1000;
  return Math.max(3600, Math.floor((expiresAtMs - nowMs) / 1000));
};

// A shared link must outlive the evening it points at. The working record still
// expires days after the event — that keeps the pipeline's key scan small — so
// the page is kept alive by a second copy that nothing but the single-event
// lookup ever reads. Before this, three days after an event its page 404'd, and
// Search Console had counted 15 806 of those.
const ARCHIVE_DAYS = 400;

/** Seconds until the archived copy expires: over a year past the event. */
export const archiveTtlSeconds = (event: EventRecord, nowMs: number): number => {
  const lastDay = event.endDate ?? event.startDate;
  const expiresAtMs = Date.parse(`${lastDay}T23:59:59Z`) + ARCHIVE_DAYS * DAY_SECONDS * 1000;
  return Math.max(3600, Math.floor((expiresAtMs - nowMs) / 1000));
};

export const writeEventRecord = async (
  kv: KvLike,
  event: EventRecord,
  nowMs: number,
): Promise<void> => {
  const body = JSON.stringify(event);
  await kv.put(eventKey(event.id), body, { expirationTtl: recordTtlSeconds(event, nowMs) });
  await kv.put(archiveKey(event.id), body, { expirationTtl: archiveTtlSeconds(event, nowMs) });
};

/** A record by id, falling back to the archive once the working copy has gone —
 *  what keeps a link to a past event resolving instead of 404ing. */
export const readAnyEventRecord = async (
  kv: KvLike,
  id: string,
): Promise<EventRecord | undefined> => {
  const live = await readEventRecord(kv, id);
  return live ?? parseEventRecord((await kv.get(archiveKey(id))) ?? '') ?? undefined;
};

/** Best-effort KV lock (AC-8.2) — same read-then-put idiom as the reference. */
export const acquireLock = async (kv: KvLike): Promise<boolean> => {
  const held = await kv.get(LOCK_KEY);
  if (held !== null) return false;
  await kv.put(LOCK_KEY, '1', { expirationTtl: LOCK_TTL_SECONDS });
  return true;
};

export const releaseLock = async (kv: KvLike): Promise<void> => kv.delete(LOCK_KEY);

export const appendRunLog = async (kv: KvLike, entry: unknown): Promise<void> => {
  const raw = await kv.get(RUNLOG_KEY);
  const existing = raw === null ? [] : (asArray(parseJson(raw)) ?? []);
  await kv.put(RUNLOG_KEY, JSON.stringify([entry, ...existing].slice(0, RUNLOG_CAP)));
};

export const readRunLog = async (kv: KvLike): Promise<readonly unknown[]> => {
  const raw = await kv.get(RUNLOG_KEY);
  return raw === null ? [] : (asArray(parseJson(raw)) ?? []);
};
