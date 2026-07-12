/**
 * The collection pipeline (design §6) — a pure function of injected
 * dependencies (AC-8.4): lock → collect → extract → dedupe/merge → details →
 * enrich → store → prune → log → unlock.
 */
import {
  eventIdOf,
  freeFromPrice,
  localized,
  mergeEvent,
  mergeRaw,
  toCompact,
} from '../domain/event.ts';
import type { CompactEvent, EventRecord, RawEvent } from '../domain/event.ts';
import { mergeDuplicates, orderByAge } from '../domain/merge-duplicates.ts';
import type { Collector, FetchFn, RawPost } from '../collectors/types.ts';
import type { Enrichment, PendingEnrich } from '../llm/enrich.ts';
import { dedupeCandidates, urlDuplicates } from './dedupe-candidates.ts';
import { dropSharedArtwork } from './shared-artwork.ts';
import type { CandidatePair } from './dedupe-candidates.ts';
import {
  acquireLock,
  appendRunLog,
  eventKey,
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
  /** Cross-source duplicates merged by the LLM judge (AC-1.9). */
  fuzzyMerged?: number;
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
  /** LLM judge: which candidate pairs are the same real event (AC-1.9). */
  judgeSameEvent: (pairs: readonly CandidatePair[]) => Promise<readonly CandidatePair[]>;
  /** HEAD-only fetch, used to spot one poster reused across several events. */
  fetchFn: FetchFn;
  now: () => number;
}>;

type Identified = Readonly<{ id: string; raw: RawEvent }>;

const identify = async (events: readonly RawEvent[]): Promise<readonly Identified[]> =>
  Promise.all(
    events.map(async (raw) => ({ id: await eventIdOf(raw.title, raw.startDate), raw })),
  );

/** Bounded-concurrency map. KV reads are network round trips: doing 1300 of
 *  them one after another cost minutes and blew the run's HTTP budget, while
 *  firing all 1300 at once risks tripping KV's rate limits. */
const CONCURRENCY = 32;

const mapBounded = async <T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
): Promise<readonly R[]> => {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
  }
  return out;
};

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
  const address = raw.address ?? enrichment?.address;
  return {
    id: item.id,
    title: raw.title,
    startDate: raw.startDate,
    categories:
      enrichment?.categories ?? (raw.categoryHint === undefined ? ['other'] : [raw.categoryHint]),
    descriptions: enrichment?.descriptions ?? localized(raw.rawDescription ?? raw.title),
    url: raw.url,
    source: raw.source,
    ...(raw.city === undefined ? {} : { city: raw.city }),
    ...(raw.lat === undefined || raw.lng === undefined ? {} : { lat: raw.lat, lng: raw.lng }),
    enriched: enrichment !== undefined,
    addedAt: nowSeconds,
    ...(raw.endDate === undefined ? {} : { endDate: raw.endDate }),
    ...(raw.time === undefined ? {} : { time: raw.time }),
    ...(raw.venue === undefined ? {} : { venue: raw.venue }),
    ...(address === undefined ? {} : { address }),
    ...(raw.priceInfo === undefined ? {} : { priceInfo: raw.priceInfo }),
    ...(raw.rawDescription === undefined ? {} : { rawDescription: raw.rawDescription }),
    ...(raw.image === undefined ? {} : { image: raw.image }),
    ...(raw.altLinks === undefined || raw.altLinks.length === 0
      ? {}
      : { altLinks: raw.altLinks }),
    ...(enrichment?.titles === undefined ? {} : { titles: enrichment.titles }),
    ...(enrichment?.unusual === true ? { unusual: true } : {}),
    ...(free ? { free: true } : {}),
  };
};

const pendingOf = (item: Identified): PendingEnrich => ({
  id: item.id,
  title: item.raw.title,
  dates:
    item.raw.startDate +
    (item.raw.endDate === undefined ? '' : `..${item.raw.endDate}`),
  ...(item.raw.venue === undefined ? {} : { venue: item.raw.venue }),
  ...(item.raw.city === undefined ? {} : { city: item.raw.city }),
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
  ...(record.venue === undefined ? {} : { venue: record.venue }),
  ...(record.city === undefined ? {} : { city: record.city }),
  ...(record.rawDescription === undefined
    ? {}
    : { raw: record.rawDescription.slice(0, 500) }),
});

type FuzzyOutcome = Readonly<{
  droppedIds: ReadonlySet<string>;
  replacements: ReadonlyMap<string, CompactEvent>;
}>;

/** Judge candidate pairs, merge confirmed ones in KV, report index edits. */
const mergeFuzzyDuplicates = async (
  deps: CollectDeps,
  index: readonly CompactEvent[],
  nowMs: number,
): Promise<FuzzyOutcome> => {
  const dropped = new Set<string>();
  const replacements = new Map<string, CompactEvent>();
  const candidates = dedupeCandidates(index).filter(
    (pair) => !dropped.has(pair.a.id) && !dropped.has(pair.b.id),
  );
  const judged =
    candidates.length === 0 ? [] : await deps.judgeSameEvent(candidates).catch(() => []);
  // Shared-url pairs are certain duplicates — no judge needed.
  const confirmed = [...urlDuplicates(index), ...judged];
  for (const pair of confirmed) {
    if (dropped.has(pair.a.id) || dropped.has(pair.b.id)) continue;
    const recordA = await readEventRecord(deps.kv, pair.a.id);
    const recordB = await readEventRecord(deps.kv, pair.b.id);
    if (recordA === undefined || recordB === undefined) continue;
    const merged = mergeDuplicates(recordA, recordB);
    const { secondary } = orderByAge(recordA, recordB);
    await writeEventRecord(deps.kv, merged, nowMs);
    await deps.kv.delete(eventKey(secondary.id));
    dropped.add(secondary.id);
    replacements.set(merged.id, toCompact(merged));
  }
  return { droppedIds: dropped, replacements };
};

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
    const index = await readIndex(deps.kv);
    // URL → record alias map: a fuzzy-merged duplicate's url lives in the
    // survivor's links, so the next collection maps that sighting back onto
    // the survivor instead of resurrecting the deleted record (AC-1.9).
    const urlToId = new Map(
      index.flatMap((event): readonly (readonly [string, string])[] => [
        [event.u, event.id],
        ...(event.l ?? []).map((link): readonly [string, string] => [link.url, event.id]),
      ]),
    );
    const identified = dedupeWithinRun(
      (await identify(upcoming)).map((item) => ({
        ...item,
        id: urlToId.get(item.raw.url) ?? item.id,
      })),
    );

    const knownIds = new Set(index.map((event) => event.id));
    const freshItems = identified.filter((item) => !knownIds.has(item.id));
    const knownItems = identified.filter((item) => knownIds.has(item.id));

    // Merge re-sightings into stored records; collect enrichment retries.
    const mergedIds = new Set<string>();
    const retryRecords: EventRecord[] = [];
    const updatedRecords: EventRecord[] = [];
    const stored = await mapBounded(knownItems, async (item) => ({
      item,
      record: await readEventRecord(deps.kv, item.id),
    }));
    for (const { item, record } of stored) {
      if (record === undefined) continue;
      const { event, changed } = mergeEvent(record, item.raw);
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

    // Bound LLM work per run: the whole run must fit the 30s waitUntil window
    // AND stay under the Gemini fallback's ~15 req/min rate limit (enrich
    // batches run concurrently). Un-enriched fresh events are still stored
    // (enriched:false) and drain across later runs. ENRICH_PER_RUN * 1/BATCH
    // concurrent Gemini calls must stay well under the RPM ceiling.
    const ENRICH_PER_RUN = 24;
    const pending = [...freshDetailed.map(pendingOf), ...retryRecords.map(pendingOfRecord)].slice(
      0,
      ENRICH_PER_RUN,
    );
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
            descriptions: enrichment.descriptions,
            enriched: true,
            ...(enrichment.titles === undefined ? {} : { titles: enrichment.titles }),
            ...(record.address === undefined && enrichment.address !== undefined
              ? { address: enrichment.address }
              : {}),
            ...(enrichment.unusual === true ? { unusual: true } : {}),
          };
    });

    // Content-policy gate (same rules as user submissions): the enrichment
    // flags violations; drop them from storage AND the index, never publish.
    const blockedIds = new Set(
      [...enrichments].filter(([, enrichment]) => enrichment.blocked === true).map(([id]) => id),
    );
    await Promise.all([...blockedIds].map((id) => deps.kv.delete(eventKey(id)).catch(() => undefined)));

    const toWrite = [...freshRecords, ...updatedRecords, ...retried].filter(
      (record) => !blockedIds.has(record.id),
    );
    const written = new Map(toWrite.map((record) => [record.id, record]));
    await mapBounded([...written.values()], (record) =>
      writeEventRecord(deps.kv, record, startedAt),
    );

    // Rebuild the index: untouched entries survive, touched ones re-project.
    const compactById = new Map<string, CompactEvent>(
      index.map((event) => [event.id, event]),
    );
    for (const id of blockedIds) compactById.delete(id);
    for (const record of written.values()) compactById.set(record.id, toCompact(record));
    const prunedIndex = pruneIndex([...compactById.values()], today);

    // Fuzzy cross-source dedupe (AC-1.9): sources title the same event
    // differently, so the exact-id dedupe misses them. Cheap candidate
    // pre-filter → LLM judge → merge, drop the newer record.
    const fuzzyMerged = await mergeFuzzyDuplicates(deps, prunedIndex, startedAt);
    const merged = prunedIndex
      .filter((event) => !fuzzyMerged.droppedIds.has(event.id))
      .map((event) => fuzzyMerged.replacements.get(event.id) ?? event)
      .toSorted((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : a.t.localeCompare(b.t)));
    // Distinct events sharing one poster look like duplicates on a map pin.
    const nextIndex = await dropSharedArtwork(deps.fetchFn, merged);
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
      fuzzyMerged: fuzzyMerged.droppedIds.size,
    };
    await appendRunLog(deps.kv, entry);
    return { kind: 'done', entry };
  } finally {
    await releaseLock(deps.kv);
  }
};
