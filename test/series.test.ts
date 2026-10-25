// A source that sells every date of one show as its own listing (Ticketmaster:
// 84 "BANKSY - STREET IS THE MUSEUM" entries, one per day) is ONE event with a
// programme of dates, not 84 events.
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { groupSeries } from '../src/pipeline/group-series.ts';
import { runCollect } from '../src/pipeline/collect-run.ts';
import type { CollectDeps } from '../src/pipeline/collect-run.ts';
import { readEventRecord, readIndex, writeEventRecord, writeIndex } from '../src/pipeline/store.ts';
import { eventIdOf, toCompact } from '../src/domain/event.ts';
import type { EventRecord, RawEvent } from '../src/domain/event.ts';
import type { Collector } from '../src/collectors/types.ts';
import { makeKvStub } from './kv-stub.ts';
import type { KvStub } from './kv-stub.ts';

const NOW_MS = Date.parse('2026-10-25T10:00:00Z');

const night = (date: string, overrides: Partial<RawEvent> = {}): RawEvent => ({
  title: 'MARCO MENGONI - RESIDENCY ALLO SBAGLIATO',
  startDate: date,
  time: '21:00',
  url: `https://www.ticketmaster.it/event/mengoni-${date}`,
  source: 'ticketmaster',
  city: 'milano',
  venue: 'Allo Sbagliato - Teatro Principe',
  ...overrides,
});

const collector =
  (events: readonly RawEvent[]): Collector =>
  async () => ({ source: 'ticketmaster', events, posts: [], failed: false });

const deps = (kv: KvStub, events: readonly RawEvent[], nowMs = NOW_MS): CollectDeps => ({
  kv,
  collectors: [collector(events)],
  extract: async () => [],
  enrich: async () => new Map(),
  details: async (raws) => raws,
  judgeSameEvent: async () => [],
  fetchFn: async () => new Response('', { status: 404 }),
  now: () => nowMs,
});

describe('groupSeries', () => {
  test('one show on several dates is one event with those dates as its programme', () => {
    const grouped = groupSeries([night('2026-11-07'), night('2026-11-05'), night('2026-11-06', { time: '20:30' })]);
    assert.equal(grouped.length, 1);
    const [series] = grouped;
    assert.equal(series?.startDate, '2026-11-05');
    assert.equal(series?.endDate, '2026-11-07');
    assert.equal(series?.kind, 'container');
    assert.deepEqual(series?.sessions, [
      { date: '2026-11-05', time: '21:00' },
      { date: '2026-11-06', time: '20:30' },
      { date: '2026-11-07', time: '21:00' },
    ]);
    assert.equal(series?.url, 'https://www.ticketmaster.it/event/mengoni-2026-11-05');
    assert.deepEqual(
      series?.altLinks?.map((link) => link.url),
      ['https://www.ticketmaster.it/event/mengoni-2026-11-06', 'https://www.ticketmaster.it/event/mengoni-2026-11-07'],
    );
  });

  test('a show on one date stays as it was', () => {
    const single = night('2026-11-05');
    assert.deepEqual(groupSeries([single]), [single]);
  });

  test('the same title elsewhere, at another venue or from another source is another event', () => {
    const grouped = groupSeries([
      night('2026-11-05'),
      night('2026-11-06', { city: 'roma' }),
      night('2026-11-07', { venue: 'Unipol Forum' }),
      night('2026-11-08', { source: 'mentelocale' }),
    ]);
    assert.equal(grouped.length, 4);
  });

  test('an entry that is itself a run is not folded into a series', () => {
    const grouped = groupSeries([night('2026-11-05'), night('2026-11-06', { endDate: '2026-11-30' })]);
    assert.equal(grouped.length, 2);
  });
});

describe('a series through the pipeline', () => {
  test('is stored once, on the days of its programme', async () => {
    const kv = makeKvStub();
    await runCollect(deps(kv, [night('2026-11-05'), night('2026-11-06'), night('2026-11-07')]));
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    assert.equal(index[0]?.k, true);
    assert.deepEqual(index[0]?.p?.map((session) => session.date), ['2026-11-05', '2026-11-06', '2026-11-07']);
  });

  test('keeps its record when its first date has passed', async () => {
    const kv = makeKvStub();
    await runCollect(deps(kv, [night('2026-11-05'), night('2026-11-06'), night('2026-11-07')]));
    const [before] = await readIndex(kv);
    await runCollect(deps(kv, [night('2026-11-06'), night('2026-11-07'), night('2026-11-08')], Date.parse('2026-11-06T10:00:00Z')));
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    assert.equal(index[0]?.id, before?.id);
    assert.deepEqual(index[0]?.p?.map((session) => session.date), ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  });

  test('absorbs the one-date records stored before series existed', async () => {
    const kv = makeKvStub();
    const dates = ['2026-11-05', '2026-11-06', '2026-11-07'];
    const legacy = await Promise.all(
      dates.map(async (date, i): Promise<EventRecord> => ({
        id: await eventIdOf('MARCO MENGONI - RESIDENCY ALLO SBAGLIATO', date),
        title: 'MARCO MENGONI - RESIDENCY ALLO SBAGLIATO',
        startDate: date,
        time: '21:00',
        url: `https://www.ticketmaster.it/event/mengoni-${date}`,
        source: 'ticketmaster',
        city: 'milano',
        venue: 'Allo Sbagliato - Teatro Principe',
        categories: ['music'],
        descriptions: { en: 'Mengoni.', it: 'Mengoni.', ru: 'Менгони.' },
        enriched: true,
        enrichVersion: 12,
        addedAt: 1_790_000_000 + i,
      })),
    );
    await Promise.all(legacy.map((record) => writeEventRecord(kv, record, NOW_MS)));
    await writeIndex(kv, legacy.map(toCompact));
    await runCollect(deps(kv, dates.map((date) => night(date))));
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    assert.equal(index[0]?.id, legacy[0]?.id);
    assert.equal(index[0]?.k, true);
    assert.deepEqual(index[0]?.p?.map((session) => session.date), dates);
    assert.equal(await readEventRecord(kv, legacy[1]?.id ?? ''), undefined);
    assert.equal(await readEventRecord(kv, legacy[2]?.id ?? ''), undefined);
  });

  test('absorbs them whichever of them was stored first', async () => {
    const kv = makeKvStub();
    const dates = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
    // The record the series lands on (its first date) is the NEWEST one: the
    // oldest of the others is the one that stays, and it has to end up with
    // every date, not just its own.
    const legacy = await Promise.all(
      dates.map(async (date, i): Promise<EventRecord> => ({
        id: await eventIdOf('MARCO MENGONI - RESIDENCY ALLO SBAGLIATO', date),
        title: 'MARCO MENGONI - RESIDENCY ALLO SBAGLIATO',
        startDate: date,
        url: `https://www.ticketmaster.it/event/mengoni-${date}`,
        source: 'ticketmaster',
        city: 'milano',
        venue: 'Allo Sbagliato - Teatro Principe',
        categories: ['music'],
        descriptions: { en: 'Mengoni.', it: 'Mengoni.', ru: 'Менгони.' },
        enriched: true,
        enrichVersion: 12,
        addedAt: 1_790_000_000 - i,
      })),
    );
    await Promise.all(legacy.map((record) => writeEventRecord(kv, record, NOW_MS)));
    await writeIndex(kv, legacy.map(toCompact));
    await runCollect(deps(kv, dates.map((date) => night(date))));
    const index = await readIndex(kv);
    assert.equal(index.length, 1);
    assert.equal(index[0]?.k, true);
    assert.equal(index[0]?.s, '2026-11-05');
    assert.equal(index[0]?.e, '2026-11-08');
    assert.deepEqual(index[0]?.p?.map((session) => session.date), dates);
  });
});
