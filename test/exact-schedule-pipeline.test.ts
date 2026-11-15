// The stored corpus is repaired, not only what is collected from now on: a
// record a listing shows again is put on its real weekdays by the next run,
// and the rebuild pass repairs every stored record, sighted or not.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEventRecord, parseIndex, toCompact } from '../src/domain/event.ts';
import type { CompactEvent, EventRecord } from '../src/domain/event.ts';
import { runCollect } from '../src/pipeline/collect-run.ts';
import type { CollectDeps } from '../src/pipeline/collect-run.ts';
import { rebuildCorpus } from '../src/pipeline/rebuild-corpus.ts';
import { eventKey, readIndex, writeEventRecord, writeIndex } from '../src/pipeline/store.ts';
import { makeKvStub } from './kv-stub.ts';
import type { KvStub } from './kv-stub.ts';

const corpus: readonly CompactEvent[] =
  parseIndex(readFileSync(join(import.meta.dirname, 'fixtures', 'recurring-events.json'), 'utf8')) ?? [];

const NOW = Date.parse('2026-11-15T10:00:00Z');

const recordOf = (title: string): EventRecord => {
  const event = corpus.find((one) => one.t.startsWith(title));
  assert.ok(event, title);
  return {
    id: event.id,
    title: event.t,
    startDate: event.s,
    ...(event.e === undefined ? {} : { endDate: event.e }),
    ...(event.h === undefined ? {} : { time: event.h }),
    ...(event.p === undefined ? {} : { sessions: event.p }),
    categories: event.c,
    descriptions: event.d ?? { en: '', it: '', ru: '' },
    url: event.u,
    source: 'visitgenoa',
    city: 'genova',
    enriched: true,
    enrichVersion: 13,
    addedAt: event.cr ?? 0,
  };
};

const seeded = async (records: readonly EventRecord[]): Promise<KvStub> => {
  const kv = makeKvStub();
  await Promise.all(records.map((record) => writeEventRecord(kv, record, NOW)));
  await writeIndex(kv, records.map(toCompact));
  return kv;
};

const stored = async (kv: KvStub, id: string): Promise<EventRecord | undefined> =>
  parseEventRecord(kv.data.get(eventKey(id)) ?? '');

const collecting = (kv: KvStub, listed: readonly EventRecord[]): CollectDeps => ({
  kv,
  collectors: [
    async () => ({
      source: 'visitgenoa',
      events: listed.map((record) => ({
        title: record.title,
        startDate: record.startDate,
        ...(record.endDate === undefined ? {} : { endDate: record.endDate }),
        url: record.url,
        source: 'visitgenoa',
        city: 'genova',
      })),
      posts: [],
      failed: false,
    }),
  ],
  extract: async () => [],
  enrich: async () => new Map(),
  details: async (raws) => raws,
  judgeSameEvent: async () => [],
  fetchFn: async () => new Response('', { status: 404 }),
  now: () => NOW,
});

describe('the next run repairs a record its listing shows again', () => {
  test('Scacchi in Biblio is stored and indexed on Mondays only', async () => {
    const scacchi = recordOf('Scacchi in Biblio');
    const kv = await seeded([scacchi]);
    await runCollect(collecting(kv, [scacchi]));
    const [entry] = await readIndex(kv);
    assert.equal(entry?.k, true);
    assert.equal((entry?.p ?? []).some((session) => session.date === '2026-11-15'), false);
    assert.equal((await stored(kv, scacchi.id))?.kind, 'container');
  });

  test('Startup Social Club is stored at 18:00', async () => {
    const club = recordOf('Startup Social Club');
    const kv = await seeded([club]);
    await runCollect(collecting(kv, [club]));
    assert.equal((await stored(kv, club.id))?.time, '18:00');
  });
});

describe('the rebuild pass repairs every stored record', () => {
  test('records no listing shows are repaired, and the index follows', async () => {
    const records = ['Scacchi in Biblio', 'Maglia insieme', 'Korn'].map(recordOf);
    const kv = await seeded(records);
    const result = await rebuildCorpus(kv, NOW);
    assert.equal(result.repaired, 3);
    const index = await readIndex(kv);
    assert.equal(index.find((entry) => entry.t === 'Scacchi in Biblio')?.k, true);
    assert.equal(index.find((entry) => entry.t === 'Maglia insieme')?.k, true);
    assert.match((await stored(kv, records[2]?.id ?? ''))?.descriptions.en ?? '', /Saturday 21 November 2026/);
  });

  test('a second pass finds nothing left to repair', async () => {
    const kv = await seeded(['Scacchi in Biblio', 'Startup Social Club'].map(recordOf));
    await rebuildCorpus(kv, NOW);
    assert.equal((await rebuildCorpus(kv, NOW)).repaired, 0);
  });

  test('the writes of one pass are bounded, and the rest wait for the next', async () => {
    const kv = await seeded(['Scacchi in Biblio', 'Maglia insieme', 'Korn'].map(recordOf));
    const first = await rebuildCorpus(kv, NOW, 2);
    assert.equal(first.repaired, 2);
    assert.equal(first.pending, 1);
    const second = await rebuildCorpus(kv, NOW, 2);
    assert.equal(second.repaired, 1);
    assert.equal(second.pending, 0);
  });
});
