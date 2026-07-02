/**
 * The collection pipeline (design §6) — a pure function of injected
 * dependencies (AC-8.4): lock → collect → extract → dedupe/merge → details →
 * enrich → store → prune → log → unlock.
 */
import {
  eventIdOf,
  freeFromPrice,
  mergeEvent,
  mergeRaw,
  toCompact,
} from '../domain/event.ts';
import type { CompactEvent, EventRecord, RawEvent } from '../domain/event.ts';
import type { Collector, RawPost } from '../collectors/types.ts';
import type { Enrichment, PendingEnrich } from '../llm/enrich.ts';
import {
  acquireLock,
  appendRunLog,
  readEventRecord,
  readIndex,
  releaseLock,
  writeEventRecord,
  writeIndex,
} from './store.ts';
import type { KvLike } from './store.ts';
import { romeDate } from './clock.ts';
import { pruneIndex } from './windows.ts';

export type SourceStat = Readonly<{
  source: string;
  fetched: number;
  fresh: number;
  merged: number;
  failed: boolean;
}>;

export type RunLogEntry = Readonly<{
  at: number;
  durationMs: number;
  sources: readonly SourceStat[];
  extractedFromPosts: number;
  enrichedOk: number;
  enrichFailed: number;
}>;

export type RunSummary =
  | Readonly<{ kind: 'done'; entry: RunLogEntry }>
  | Readonly<{ kind: 'locked' }>;

export type CollectDeps = Readonly<{
  kv: KvLike;
  collectors: readonly Collector[];
  extract: (posts: readonly RawPost[], today: string) => Promise<readonly RawEvent[]>;
  enrich: (events: readonly PendingEnrich[]) => Promise<ReadonlyMap<string, Enrichment>>;
  details: (events: readonly RawEvent[]) => Promise<readonly RawEvent[]>;
  now: () => number;
}>;

type Identified = Readonly<{ id: string; raw: RawEvent }>;

const identify = async (events: readonly RawEvent[]): Promise<readonly Identified[]> =>
  Promise.all(
    events.map(async (raw) => ({ id: await eventIdOf(raw.title, raw.startDate), raw })),
  );

/** Collapse same-id sightings within one run: first wins, gaps fill (AC-1.2). */
const dedupeWithinRun = (identified: readonly Identified[]): readonly Identified[] => {
  const byId = new Map<string, Identified>();
  for (const item of identified) {
    const existing = byId.get(item.id);
    byId.set(
      item.id,
      existing === undefined ? item : { id: item.id, raw: mergeRaw(existing.raw, item.raw) },
    );
  }
  return [...byId.values()];
};

const toRecord = (
  item: Identified,
  enrichment: Enrichment | undefined,
  nowSeconds: number,
): EventRecord => {
  const { raw } = item;
  const free = freeFromPrice(raw.priceInfo);
  return {
    id: item.id,
    title: raw.title,
    startDate: raw.startDate,
    categories:
      enrichment?.categories ?? (raw.categoryHint === undefined ? ['other'] : [raw.categoryHint]),
    description: enrichment?.description ?? raw.rawDescription ?? raw.title,
    url: raw.url,
    source: raw.source,
    enriched: enrichment !== undefined,
    addedAt: nowSeconds,
    ...(raw.endDate === undefined ? {} : { endDate: raw.endDate }),
    ...(raw.time === undefined ? {} : { time: raw.time }),
    ...(raw.venue === undefined ? {} : { venue: raw.venue }),
    ...(raw.address === undefined ? {} : { address: raw.address }),
    ...(raw.priceInfo === undefined ? {} : { priceInfo: raw.priceInfo }),
    ...(raw.rawDescription === undefined ? {} : { rawDescription: raw.rawDescription }),
    ...(raw.image === undefined ? {} : { image: raw.image }),
    ...(free ? { free: true } : {}),
  };
};

const pendingOf = (item: Identified): PendingEnrich => ({
  id: item.id,
  title: item.raw.title,
  dates:
    item.raw.startDate +
    (item.raw.endDate === undefined ? '' : `..${item.raw.endDate}`),
  ...(item.raw.categoryHint === undefined ? {} : { categoryHint: item.raw.categoryHint }),
  ...(item.raw.rawDescription === undefined
    ? {}
    : { raw: item.raw.rawDescription.slice(0, 500) }),
});

const pendingOfRecord = (record: EventRecord): PendingEnrich => ({
  id: record.id,
  title: record.title,
  dates:
    record.startDate + (record.endDate === undefined ? '' : `..${record.endDate}`),
  ...(record.rawDescription === undefined
    ? {}
    : { raw: record.rawDescription.slice(0, 500) }),
});

export const runCollect = async (deps: CollectDeps): Promise<RunSummary> => {
  if (!(await acquireLock(deps.kv))) return { kind: 'locked' };
  const startedAt = deps.now();
  try {
    const today = romeDate(startedAt);
    const failedOutcome = { source: 'unknown', events: [], posts: [], failed: true };
    const outcomes = await Promise.all(
      deps.collectors.map((collector) => collector().catch(() => failedOutcome)),
    );

    const posts = outcomes.flatMap((outcome) => outcome.posts);
    const extracted = posts.length === 0 ? [] : await deps.extract(posts, today);

    const collected = [...outcomes.flatMap((outcome) => outcome.events), ...extracted];
    const upcoming = collected.filter(
      (raw) => (raw.endDate ?? raw.startDate) >= today, // AC-1.5
    );
    const identified = dedupeWithinRun(await identify(upcoming));

    const index = await readIndex(deps.kv);
    const knownIds = new Set(index.map((event) => event.id));
    const freshItems = identified.filter((item) => !knownIds.has(item.id));
    const knownItems = identified.filter((item) => knownIds.has(item.id));

    // Merge re-sightings into stored records; collect enrichment retries.
    const mergedIds = new Set<string>();
    const retryRecords: EventRecord[] = [];
    const updatedRecords: EventRecord[] = [];
    for (const item of knownItems) {
      const stored = await readEventRecord(deps.kv, item.id);
      if (stored === undefined) continue;
      const { event, changed } = mergeEvent(stored, item.raw);
      if (changed) {
        mergedIds.add(item.id);
        updatedRecords.push(event);
      }
      if (!event.enriched) retryRecords.push(event);
    }

    const detailed = await deps.details(freshItems.map((item) => item.raw));
    const freshDetailed = freshItems.map((item, i): Identified => {
      const raw = detailed[i];
      return raw === undefined ? item : { id: item.id, raw };
    });

    // Bound LLM work per run: the whole run must fit the 30s waitUntil
    // window, so a large retry backlog drains across several runs instead
    // of killing this one mid-flight (which would strand the lock).
    const RETRY_CAP = 60;
    const pending = [
      ...freshDetailed.map(pendingOf),
      ...retryRecords.slice(0, RETRY_CAP).map(pendingOfRecord),
    ];
    const enrichments =
      pending.length === 0
        ? new Map<string, Enrichment>()
        : await deps.enrich(pending).catch(() => new Map<string, Enrichment>());

    const nowSeconds = Math.floor(deps.now() / 1000);
    const freshRecords = freshDetailed.map((item) =>
      toRecord(item, enrichments.get(item.id), nowSeconds),
    );
    const retried = retryRecords.map((record): EventRecord => {
      const enrichment = enrichments.get(record.id);
      return enrichment === undefined
        ? record
        : {
            ...record,
            categories: enrichment.categories,
            description: enrichment.description,
            enriched: true,
          };
    });

    const toWrite = [...freshRecords, ...updatedRecords, ...retried];
    const written = new Map(toWrite.map((record) => [record.id, record]));
    await Promise.all(
      [...written.values()].map((record) => writeEventRecord(deps.kv, record, startedAt)),
    );

    // Rebuild the index: untouched entries survive, touched ones re-project.
    const compactById = new Map<string, CompactEvent>(
      index.map((event) => [event.id, event]),
    );
    for (const record of written.values()) compactById.set(record.id, toCompact(record));
    const nextIndex = pruneIndex([...compactById.values()], today).toSorted((a, b) =>
      a.s < b.s ? -1 : a.s > b.s ? 1 : a.t.localeCompare(b.t),
    );
    await writeIndex(deps.kv, nextIndex);

    const freshIds = new Set(freshItems.map((item) => item.id));
    const statFor = async (
      outcome: (typeof outcomes)[number],
      sourceEvents: readonly RawEvent[],
    ): Promise<SourceStat> => {
      const ids = await Promise.all(
        sourceEvents.map((raw) => eventIdOf(raw.title, raw.startDate)),
      );
      return {
        source: outcome.source,
        fetched: sourceEvents.length,
        fresh: ids.filter((id) => freshIds.has(id)).length,
        merged: ids.filter((id) => mergedIds.has(id)).length,
        failed: outcome.failed,
      };
    };
    const sources = await Promise.all(
      outcomes.map((outcome) => statFor(outcome, outcome.events)),
    );

    const entry: RunLogEntry = {
      at: Math.floor(startedAt / 1000),
      durationMs: deps.now() - startedAt,
      sources,
      extractedFromPosts: extracted.length,
      enrichedOk: enrichments.size,
      enrichFailed: pending.length - enrichments.size,
    };
    await appendRunLog(deps.kv, entry);
    return { kind: 'done', entry };
  } finally {
    await releaseLock(deps.kv);
  }
};
