// T9 — the collection pipeline with fake deps (AC-1.1–1.3, AC-8.2–8.4).
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { runCollect } from '../src/pipeline/collect-run.ts';
import type { CollectDeps } from '../src/pipeline/collect-run.ts';
import { acquireLock, readEventRecord, readIndex } from '../src/pipeline/store.ts';
import { eventIdOf } from '../src/domain/event.ts';
import type { RawEvent } from '../src/domain/event.ts';
import type { Collector } from '../src/collectors/types.ts';
import type { Enrichment } from '../src/llm/enrich.ts';
import { makeKvStub } from './kv-stub.ts';
import type { KvStub } from './kv-stub.ts';

const NOW_MS = Date.parse('2026-07-01T10:00:00Z');

const rawEvent = (overrides: Partial<RawEvent> & Pick<RawEvent, 'title'>): RawEvent => ({
  startDate: '2026-07-10',
  url: 'https://example.org/e',
  source: 'visitgenoa',
  ...overrides,
});

const okCollector =
  (events: readonly RawEvent[]): Collector =>
  async () => ({ source: 'visitgenoa', events, posts: [], failed: false });

const deadCollector: Collector = async () => ({
  source: 'tg:dead',
  events: [],
  posts: [],
  failed: true,
});

const makeDeps = (
  kv: KvStub,
  collectors: readonly Collector[],
  enrichments: ReadonlyMap<string, Enrichment> = new Map(),
): CollectDeps => ({
  kv,
  collectors,
  extract: async () => [],
  enrich: async () => enrichments,
  details: async (events) => events,
  judgeSameEvent: async () => [],
  now: () => NOW_MS,
});

describe('runCollect', () => {
  test('stores fresh events, skips past ones, logs the run (AC-1.1, AC-1.5, AC-8.3)', async () => {
    const kv = makeKvStub();
    const events = [
      rawEvent({ title: 'Fresh Concert', categoryHint: 'music' }),
      rawEvent({ title: 'Long Gone', startDate: '2026-06-01' }),
    ];
    const id = await eventIdOf('Fresh Concert', '2026-07-10');
    const enrichments = new Map([
      [id, { categories: ['music'], description: 'A concert.', unusual: false } satisfies Enrichment],
    ]);
    const summary = await runCollect(makeDeps(kv, [okCollector(events)], enrichments));
    assert.equal(summary.kind, 'done');
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    assert.equal(index[0]?.id, id);
    const stored = await readEventRecord(kv, id);
    assert.ok(stored !== undefined);
    assert.equal(stored.enriched, true);
    assert.equal(stored.description, 'A concert.');
    if (summary.kind === 'done') {
      assert.equal(summary.entry.sources[0]?.fresh, 1);
      assert.equal(summary.entry.sources[0]?.fetched, 2);
    }
  });

  test('re-run merges gaps instead of duplicating (AC-1.2)', async () => {
    const kv = makeKvStub();
    const first = rawEvent({ title: 'Mostra' });
    await runCollect(makeDeps(kv, [okCollector([first])]));
    const second = rawEvent({ title: 'Mostra!', venue: 'Palazzo Ducale' });
    const summary = await runCollect(makeDeps(kv, [okCollector([second])]));
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    const id = await eventIdOf('Mostra', '2026-07-10');
    const stored = await readEventRecord(kv, id);
    assert.equal(stored?.venue, 'Palazzo Ducale');
    if (summary.kind === 'done') {
      assert.equal(summary.entry.sources[0]?.fresh, 0);
      assert.equal(summary.entry.sources[0]?.merged, 1);
    }
  });

  test('failed source does not sink the run (AC-1.3) and enrich failure degrades (AC-2.3)', async () => {
    const kv = makeKvStub();
    const deps: CollectDeps = {
      ...makeDeps(kv, [okCollector([rawEvent({ title: 'Sagra', categoryHint: 'food' })]), deadCollector]),
      enrich: async () => {
        throw new Error('llm down');
      },
    };
    const summary = await runCollect(deps);
    assert.equal(summary.kind, 'done');
    const id = await eventIdOf('Sagra', '2026-07-10');
    const stored = await readEventRecord(kv, id);
    assert.ok(stored !== undefined);
    assert.equal(stored.enriched, false);
    assert.deepEqual(stored.categories, ['food']); // hint survives as the fallback
    if (summary.kind === 'done') {
      assert.equal(summary.entry.sources.some((source) => source.failed), true);
    }
  });

  test('retries enrichment for stored enriched:false records (AC-2.3)', async () => {
    const kv = makeKvStub();
    const raw = rawEvent({ title: 'Workshop' });
    await runCollect({
      ...makeDeps(kv, [okCollector([raw])]),
      enrich: async () => {
        throw new Error('down');
      },
    });
    const id = await eventIdOf('Workshop', '2026-07-10');
    assert.equal((await readEventRecord(kv, id))?.enriched, false);

    const enrichments = new Map([
      [id, { categories: ['workshop'], description: 'Hands-on.', unusual: true } satisfies Enrichment],
    ]);
    await runCollect(makeDeps(kv, [okCollector([raw])], enrichments));
    const stored = await readEventRecord(kv, id);
    assert.equal(stored?.enriched, true);
    assert.deepEqual(stored?.categories, ['workshop']);
    assert.equal(stored?.unusual, true); // gem flag flows through retry (AC-2.6)
    const index = await readIndex(kv);
    assert.equal(index[0]?.x, true);
  });

  test('fuzzy dedupe: LLM-confirmed pair merges, duplicate record dies (AC-1.9)', async () => {
    const kv = makeKvStub();
    const a = rawEvent({
      title: 'FuoriFormato 26. Festival internazionale di danza',
      url: 'https://a.example/1',
    });
    const b = rawEvent({
      title: 'FuoriFormato Festival',
      venue: 'Teatro della Tosse',
      url: 'https://b.example/2',
      source: 'genovateatro',
    });
    const deps: CollectDeps = {
      ...makeDeps(kv, [okCollector([a, b])]),
      judgeSameEvent: async (pairs) => pairs, // confirm everything the filter found
    };
    const summary = await runCollect(deps);
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    assert.equal(index[0]?.v, 'Teatro della Tosse'); // gap filled from duplicate
    assert.deepEqual(index[0]?.l, [{ source: 'genovateatro', url: 'https://b.example/2' }]);
    const idA = await eventIdOf(a.title, a.startDate);
    const idB = await eventIdOf(b.title, b.startDate);
    assert.ok(await readEventRecord(kv, idA) !== undefined);
    assert.equal(await readEventRecord(kv, idB), undefined); // secondary deleted
    if (summary.kind === 'done') {
      assert.equal(summary.entry.fuzzyMerged, 1);
    }

    // Re-collect: the source still lists the duplicate, but its url is an
    // alias of the survivor now — it must NOT resurrect (AC-1.9).
    const again = await runCollect(deps);
    const indexAfter = await readIndex(kv);
    assert.equal(indexAfter.length, 1);
    assert.equal(await readEventRecord(kv, idB), undefined);
    if (again.kind === 'done') {
      assert.equal(again.entry.sources[0]?.fresh, 0);
    }
  });

  test('locked run refuses and leaves state untouched (AC-8.2)', async () => {
    const kv = makeKvStub();
    assert.equal(await acquireLock(kv), true);
    const summary = await runCollect(makeDeps(kv, [okCollector([rawEvent({ title: 'X' })])]));
    assert.equal(summary.kind, 'locked');
    assert.deepEqual(await readIndex(kv), []);
  });

  test('same event from two sources collapses within one run (AC-1.2)', async () => {
    const kv = makeKvStub();
    const a = okCollector([rawEvent({ title: 'Electropark' })]);
    const b: Collector = async () => ({
      source: 'tg:genova',
      events: [
        rawEvent({
          title: 'ELECTROPARK',
          venue: 'Porto Antico',
          source: 'tg:genova',
          url: 'https://example.org/tg',
        }),
      ],
      posts: [],
      failed: false,
    });
    await runCollect(makeDeps(kv, [a, b]));
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    const id = await eventIdOf('Electropark', '2026-07-10');
    const stored = await readEventRecord(kv, id);
    assert.equal(stored?.venue, 'Porto Antico');
    assert.equal(stored?.source, 'visitgenoa'); // first sighting wins
    // …but the second source's link survives the within-run merge (AC-1.8).
    assert.deepEqual(stored?.altLinks, [
      { source: 'tg:genova', url: 'https://example.org/tg' },
    ]);
    assert.deepEqual(index[0]?.l, [{ source: 'tg:genova', url: 'https://example.org/tg' }]);
  });
});
